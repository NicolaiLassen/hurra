// The engine's decisions as one pure function (docs/engine-v2.md, 3.3).
// netlify/lib/engine.ts only does I/O around it (game_load, then game_commit,
// with retries), and the tests and simulateParty() run exactly the same code.
import { createGameContext, emptyEffects, hasEffects, type GameEffects } from './context'
import {
  GameError,
  type Actor,
  type Answer,
  type AnswerPayload,
  type AnyGame,
  type GameData,
  type GameInfo,
  type GamePlayer,
  type PlayerId,
  type Prompt,
  type PromptSpec,
} from './Game'
import { jsonbKeyOrder } from './testing'

/** What game_load returns (section 2.8), typed. Every time is epoch ms, database clock, or null. */
export type Loaded = {
  now: number
  claimed: boolean
  game: {
    id: string
    session_id: string
    game_type: string
    title: string
    status: 'pending' | 'active' | 'finished'
    archived_at: number | null
    wake_at: number | null
  }
  settings: Record<string, unknown>
  current: { state: unknown; version: number; round: number; config: unknown; members: PlayerId[] } | null
  session: { id: string; name: string; data: GameData; spotlight_game_id: string | null }
  players: GamePlayer[]
  caller: { player_id: PlayerId | null; is_host: boolean; is_screen: boolean }
  scoreboard: Record<PlayerId, number>
  /** This round's score_events for this game: host awards and game bonuses. */
  awards: Record<PlayerId, number>
  prompts: Record<
    string,
    {
      spec: PromptSpec
      opened_at: number
      closes_at: number | null
      closed_at: number | null
      revealed_at: number | null
      submissions:
        | { player_id: PlayerId; answer: AnswerPayload; first_at: number; at: number; ms: number; changes: number }[]
        | null
    }
  >
}

export type EngineRequest =
  | { type: 'start'; gameId: string; requestId: string; stage?: boolean }
  | { type: 'end'; gameId: string; requestId: string }
  | { type: 'action'; gameId: string; requestId: string; action: unknown }
  | { type: 'host-action'; gameId: string; requestId: string; action: unknown; close?: string[] }
  | { type: 'sync'; gameId: string; requestId: string }

/** What game_commit takes (section 2.8). */
export type CommitPayload = {
  game_id: string
  request: {
    id: string
    user_id: string
    type: EngineRequest['type']
    actor: 'player' | 'host' | 'timer' | 'system'
    player_id: PlayerId | null
    action?: unknown
    close?: string[]
  }
  expected_version: number | null // null on start
  expected_round: number | null // null on start
  status: 'active' | 'finished' | null
  finished_by: 'game' | 'host' | null
  winners?: PlayerId[] // on finish
  stage: 'take' | 'keep' | null // start only
  state: unknown
  config?: unknown // start only: the frozen settings
  members: PlayerId[]
  public_state?: unknown // left out: keep the stored one (End's fail-open path)
  player_views?: Record<PlayerId, unknown>
  scores?: Record<PlayerId, number>
  wake_at: number | null
  effects: GameEffects
  log: { joined: PlayerId[]; left: PlayerId[]; woke: number; wake_stuck?: true }
}

export type ErrorCode =
  | 'bad_request'
  | 'rule'
  | 'not_signed_in'
  | 'not_host'
  | 'not_player'
  | 'not_found'
  | 'already_running'
  | 'not_running'
  | 'archived'
  | 'restarted'
  | 'busy'
  | 'unknown_game_type'
  | 'unavailable'
  | 'internal'

export type StepEnv = {
  userId: string
  /** The first attempt's loaded.now, kept for every retry. */
  now: number
  random: () => number
  /** The first attempt's loaded.current.round, kept for every retry; null on the first attempt and on a start. */
  round: number | null
}

export type Step =
  | { kind: 'commit'; commit: CommitPayload; view?: unknown }
  /** Nothing changed (an early sync, a no-op): no save, no log row, no ping. */
  | { kind: 'skip'; view?: unknown }
  | { kind: 'refuse'; status: 400 | 403 | 409; code: ErrorCode; message: string }

/** At most this many onWake calls per sync. */
export const MAX_WAKES = 10

const refuse = (status: 400 | 403 | 409, code: ErrorCode, message: string): Step => ({ kind: 'refuse', status, code, message })

export function step(logic: AnyGame, loaded: Loaded, request: EngineRequest, env: StepEnv): Step {
  const { game, caller, current } = loaded
  const starting = request.type === 'start'

  // 1. Who may. A paired screen may only sync.
  if (request.type === 'start' || request.type === 'end' || request.type === 'host-action') {
    if (!caller.is_host) return refuse(403, 'not_host', 'Only hosts can do that')
  } else if (request.type === 'action') {
    if (!caller.player_id) return refuse(403, 'not_player', "You're not a player in this party")
  } else if (!caller.is_host && !caller.player_id && !caller.is_screen) {
    return refuse(403, 'not_player', "You're not a player in this party")
  }

  // 2. Status.
  if (starting) {
    if (game.archived_at !== null) return refuse(409, 'archived', 'Unarchive this game before starting it')
    if (game.status === 'active') return refuse(409, 'already_running', 'This game is already running')
  } else {
    if (request.type === 'sync' && game.status !== 'active') return { kind: 'skip' }
    if (game.status !== 'active' || !current) return refuse(409, 'not_running', 'This game is not running')
    // A restart came in between two attempts of this request: nothing from round 1 lands in round 2.
    if (env.round !== null && env.round !== current.round) return refuse(409, 'restarted', 'The game was restarted')
  }

  const actor: Actor =
    request.type === 'action'
      ? { kind: 'player', playerId: caller.player_id! }
      : request.type === 'sync'
        ? { kind: 'timer' }
        : { kind: 'host' }
  const presentIds = loaded.players.map((p) => p.id)

  let config: unknown
  let state: unknown = current?.state
  let action: unknown
  let status: 'active' | 'finished' | null = null
  let finishedBy: 'game' | 'host' | null = null
  let woke = 0
  let wakeStuck = false
  let joined: PlayerId[] = []
  let left: PlayerId[] = []
  let info: GameInfo<unknown>
  let effects: GameEffects
  let failedEnd = false

  try {
    // 3. Settings: checked once, at start, and frozen for the round.
    if (starting) {
      const merged = { ...asObject(logic.defaultConfig), ...loaded.settings }
      config = logic.parseConfig ? logic.parseConfig(merged) : merged
    } else {
      config = current!.config
    }

    // 4. Info. A new round starts with no prompts (game_commit deletes the old ones).
    info = {
      gameId: game.id,
      round: starting ? (current?.round ?? 0) + 1 : current!.round,
      session: { id: loaded.session.id, name: loaded.session.name, data: loaded.session.data },
      players: loaded.players,
      scoreboard: loaded.scoreboard,
      config,
      now: env.now,
      prompts: starting ? {} : toPrompts(loaded.prompts),
      answers: starting ? {} : toAnswers(loaded.prompts),
    }

    // 5. Context.
    const main = createGameContext(info, env.random, { actor, unknownPlayers: 'skip' })
    const ctx = main.ctx
    effects = main.effects

    // 6. Membership: who left and who joined since the last save, as actor
    //    system in a second context that shares the request's effects. These
    //    hooks fail open: a throw keeps the state from before it.
    if (!starting) {
      const known = new Set(current!.members)
      const present = new Set(presentIds)
      left = current!.members.filter((id) => !present.has(id))
      joined = presentIds.filter((id) => !known.has(id))
      if ((left.length > 0 && logic.onPlayerLeave) || (joined.length > 0 && logic.onPlayerJoin)) {
        const system = createGameContext(info, env.random, { actor: { kind: 'system' }, unknownPlayers: 'skip', effects })
        for (const id of left) {
          if (!logic.onPlayerLeave) break
          state = failOpen(effects, state, (s) => logic.onPlayerLeave!(s, id, system.ctx), `${logic.type}.onPlayerLeave`)
        }
        for (const id of joined) {
          if (!logic.onPlayerJoin) break
          const player = loaded.players.find((p) => p.id === id)!
          state = failOpen(effects, state, (s) => logic.onPlayerJoin!(s, player, system.ctx), `${logic.type}.onPlayerJoin`)
        }
      }
    }

    // 7. The hook.
    switch (request.type) {
      case 'start':
        state = logic.setup(ctx)
        status = 'active'
        break
      case 'end': {
        const stored = state
        try {
          if (logic.onEnd) state = logic.onEnd(state, ctx, 'host')
        } catch (error) {
          // End always ends (9): the stored state, without projections or effects.
          console.error(`${logic.type}: onEnd failed while the host ended it; ending without it`, error)
          state = stored
          failedEnd = true
        }
        status = 'finished'
        finishedBy = 'host'
        break
      }
      case 'action':
        action = logic.parseAction(request.action)
        state = logic.handleAction(state, action, caller.player_id!, ctx)
        break
      case 'host-action':
        if (!logic.parseHostAction || !logic.handleHostAction) {
          return refuse(400, 'bad_request', 'This game has no host controls')
        }
        action = logic.parseHostAction(request.action)
        state = logic.handleHostAction(state, action, ctx)
        break
      case 'sync':
        // Early or repeated syncs find nothing due and change nothing (a skip).
        if (game.wake_at !== null && game.wake_at <= env.now) {
          if (logic.onWake && logic.wakeAt) {
            while (woke < MAX_WAKES) {
              const at = logic.wakeAt(state, info)
              if (at === null || at > env.now) break
              state = logic.onWake(state, ctx)
              woke++
            }
          }
          const after = logic.wakeAt ? logic.wakeAt(state, info) : null
          // The game stops asking for syncs until a later save gives it a new wakeAt.
          if (after !== null && after <= env.now) wakeStuck = true
        }
        break
    }

    // 8. Self-finish, in the same save. If onEnd throws, the game still
    //    finishes: the deciding change's own effects stay, onEnd's are dropped.
    if (status === null && logic.isFinished?.(state, info)) {
      if (logic.onEnd) state = failOpen(effects, state, (s) => logic.onEnd!(s, ctx, 'game'), `${logic.type}.onEnd`)
      status = 'finished'
      finishedBy = 'game'
    }
  } catch (error) {
    // 11. Refusals. Anything else is a bug and propagates (500).
    if (error instanceof GameError) return refuse(400, 'rule', error.message)
    throw error
  }

  // 10. Projections, winners, wake. End's fail-open path (9) keeps the stored projections.
  let projected: ReturnType<typeof project> | null = null
  if (!failedEnd) {
    try {
      projected = project(logic, info, state)
    } catch (error) {
      if (request.type !== 'end') {
        if (error instanceof GameError) return refuse(400, 'rule', error.message)
        throw error
      }
      console.error(`${logic.type}: projections failed while the host ended it; ending without them`, error)
      state = current!.state
      failedEnd = true
    }
  }
  if (failedEnd) effects = emptyEffects()

  let winners: PlayerId[] | undefined
  if (status === 'finished') {
    winners = failedEnd
      ? safeWinners(logic, state, info, loaded.awards)
      : finishWinners(logic, state, info, projected!.scores, loaded.awards, effects.points)
  }
  let wakeAt = status === 'finished' || wakeStuck ? null : wholeMs(logic.wakeAt?.(state, info) ?? null)
  // A sync never re-arms a wake that is already past: after a stuck wake the
  // game stays quiet until a move or a host action gives it a new wakeAt.
  if (request.type === 'sync' && wakeAt !== null && wakeAt <= env.now) wakeAt = null
  const view = caller.player_id && projected ? projected.playerViews[caller.player_id] : undefined

  // 12. Skip: nothing changed at all.
  const members = presentIds
  if (
    !starting &&
    status === null &&
    !wakeStuck &&
    !hasEffects(effects) &&
    wakeAt === game.wake_at &&
    sameSet(members, current!.members) &&
    canonicalJson(state) === canonicalJson(current!.state)
  ) {
    return { kind: 'skip', ...(view !== undefined ? { view } : {}) }
  }

  // 13. Commit.
  const stage = starting ? ((request.stage ?? logic.presentation !== 'background') ? 'take' : 'keep') : null
  const commit: CommitPayload = {
    game_id: game.id,
    request: {
      id: request.requestId,
      user_id: env.userId,
      type: request.type,
      actor: actor.kind,
      player_id: request.type === 'action' ? caller.player_id : null,
      ...(action !== undefined ? { action } : {}),
      ...(request.type === 'host-action' ? { close: request.close ?? [] } : {}),
    },
    expected_version: starting ? null : current!.version,
    expected_round: starting ? null : (env.round ?? current!.round),
    status,
    finished_by: finishedBy,
    ...(winners ? { winners } : {}),
    stage,
    state,
    ...(starting ? { config } : {}),
    members,
    ...(projected
      ? { public_state: projected.publicState, player_views: projected.playerViews, scores: projected.scores }
      : {}),
    wake_at: wakeAt,
    effects,
    log: { joined, left, woke, ...(wakeStuck ? { wake_stuck: true as const } : {}) },
  }
  return { kind: 'commit', commit, ...(view !== undefined ? { view } : {}) }
}

/** The projections for every audience. Scores only for present players, whole numbers only. */
export function project(
  logic: AnyGame,
  info: GameInfo<unknown>,
  state: unknown,
): { publicState: unknown; playerViews: Record<PlayerId, unknown>; scores: Record<PlayerId, number> } {
  const present = new Set(info.players.map((p) => p.id))
  const scores: Record<PlayerId, number> = {}
  for (const [playerId, points] of Object.entries(logic.scores(state, info))) {
    if (!Number.isInteger(points)) throw new Error(`${logic.type}: the score for ${playerId} isn't a whole number (${points})`)
    // Players who left are dropped: their rows would break the foreign key.
    if (points !== 0 && present.has(playerId)) scores[playerId] = points
  }
  return {
    publicState: logic.publicState(state, info),
    playerViews: Object.fromEntries(info.players.map((p) => [p.id, logic.playerView(state, p.id, info)])),
    scores,
  }
}

/** JSON with object keys in jsonb order, for "did anything change" comparisons. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(reorder(value)) ?? 'null'
}

function reorder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorder)
  if (value !== null && typeof value === 'object') {
    const json = (value as { toJSON?: () => unknown }).toJSON
    if (typeof json === 'function') return reorder(json.call(value))
    const record = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort(jsonbKeyOrder)
        .map((key) => [key, reorder(record[key])]),
    )
  }
  return value
}

/**
 * The default winners: the players with the most points this round (its
 * scores, its awards and this save's own bonuses), all tied ones. Nobody when
 * that top is 0 or below: an in-person round scores only through awards, and
 * a round ended before anyone scored crowns nobody.
 */
export function defaultWinners(
  scores: Readonly<Record<PlayerId, number>>,
  awards: Readonly<Record<PlayerId, number>>,
  bonuses: readonly { player_id: PlayerId; points: number }[] = [],
): PlayerId[] {
  const totals = new Map<PlayerId, number>()
  const add = (id: PlayerId, points: number) => totals.set(id, (totals.get(id) ?? 0) + points)
  for (const [id, points] of Object.entries(scores)) add(id, points)
  for (const [id, points] of Object.entries(awards)) add(id, points)
  for (const bonus of bonuses) add(bonus.player_id, bonus.points)
  const top = Math.max(0, ...totals.values())
  if (top <= 0) return []
  return [...totals].filter(([, points]) => points === top).map(([id]) => id)
}

/** The game's own winners, or the default ones. A throwing winners() must not keep a game from finishing. */
function finishWinners(
  logic: AnyGame,
  state: unknown,
  info: GameInfo<unknown>,
  scores: Record<PlayerId, number>,
  awards: Record<PlayerId, number>,
  bonuses: GameEffects['points'],
): PlayerId[] {
  if (!logic.winners) return defaultWinners(scores, awards, bonuses)
  try {
    return logic.winners(state, info)
  } catch (error) {
    console.error(`${logic.type}.winners failed; crowning the top of the round instead`, error)
    return defaultWinners(scores, awards, bonuses)
  }
}

/** Winners on End's fail-open path, where the game's own code already failed once. */
function safeWinners(logic: AnyGame, state: unknown, info: GameInfo<unknown>, awards: Record<PlayerId, number>) {
  try {
    if (logic.winners) return logic.winners(state, info)
    return defaultWinners(project(logic, info, state).scores, awards)
  } catch {
    return defaultWinners({}, awards)
  }
}

/** Runs a hook that must not block the request: a throw keeps the state and drops only its effects. */
function failOpen(effects: GameEffects, state: unknown, hook: (state: unknown) => unknown, name: string): unknown {
  const before = structuredClone(effects)
  try {
    return hook(state)
  } catch (error) {
    if (!(error instanceof GameError)) console.error(`${name} failed; going on without it`, error)
    restore(effects, before)
    return state
  }
}

function restore(effects: GameEffects, before: GameEffects) {
  effects.points = before.points
  effects.profiles = before.profiles
  effects.announcements = before.announcements
  effects.records = before.records
  effects.prompts = before.prompts
  if (before.session_data === undefined) delete effects.session_data
  else effects.session_data = before.session_data
}

function toPrompts(prompts: Loaded['prompts']): Record<string, Prompt> {
  return Object.fromEntries(
    Object.entries(prompts).map(([key, p]) => [
      key,
      { key, spec: p.spec, openedAt: p.opened_at, closesAt: p.closes_at, closedAt: p.closed_at, revealedAt: p.revealed_at },
    ]),
  )
}

function toAnswers(prompts: Loaded['prompts']): Record<string, Answer[]> {
  return Object.fromEntries(
    Object.entries(prompts)
      .filter(([, p]) => p.closed_at !== null && p.revealed_at === null && p.submissions)
      .map(([key, p]) => [
        key,
        p.submissions!.map((s) => ({
          playerId: s.player_id,
          answer: s.answer,
          firstAt: s.first_at,
          at: s.at,
          ms: s.ms,
          changes: s.changes,
        })),
      ]),
  )
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function wholeMs(value: number | null): number | null {
  if (value === null) return null
  if (!Number.isFinite(value)) throw new Error(`wakeAt must be a time in ms or null, got ${value}`)
  return Math.round(value)
}

function sameSet(a: readonly string[], b: readonly string[]) {
  if (a.length !== b.length) return false
  const set = new Set(b)
  return a.every((id) => set.has(id))
}
