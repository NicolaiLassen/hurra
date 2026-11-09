// The contract every game keeps (docs/engine-v2.md, 3.4): checkGameContract
// plays an example round through simulateParty and reports what breaks.
// Each game's own test calls it with its example; src/games/registry.test.ts
// runs it over every registered game with a round its bot plays (botExample).
import type { BotSight, GameBot, HostBotSight } from './bot'
import type { AnswerPayload, AnyGame, GameContext, GameInfo, PlayerId } from './Game'
import { canonicalJson, project } from './runtime'
import { deepFreeze, FakeDbError, simulateParty, type FakeParty } from './simulate'
import { jsonbRoundTrip, seededRandom } from './testing'

export type ContractExample = {
  config: Record<string, unknown>
  players: number
  steps: ContractStep[]
}

export type ContractStep =
  | { kind: 'action'; player: number; action: unknown }
  | { kind: 'host'; action: unknown; close?: string[] }
  | { kind: 'answer'; player: number; key: string; answer: AnswerPayload; afterMs?: number }
  | { kind: 'tick'; ms: number }
  | { kind: 'sync' }
  /** A new guest joins the party, then a sync runs, so onPlayerJoin runs. */
  | { kind: 'join' }
  /** The host removes this player, then a sync runs (as the host page does), so onPlayerLeave runs. */
  | { kind: 'leave'; player: number }
  | { kind: 'end' }

const GAME_ID = 'contract'
/** A player the game never knew. */
const STRANGER = '00000000-0000-4000-8000-00000000beef'

/**
 * Runs the example through simulateParty() and returns the problems found
 * (empty when fine). Player numbers index everyone who was ever in the party:
 * the example's players first, then each joiner.
 *
 * After every step: projections are identical before and after a strict
 * jsonb round trip of the state; the state, publicState, every playerView and
 * scores survive a strict round trip; playerView works for a stranger and for
 * a player who joined mid-round; scores are whole numbers; hooks don't mutate
 * their input (it is deep-frozen); after every sync, wakeAt is null or later
 * than now; while the round runs, recap() returns []; a finished game refuses
 * further actions with 409 not_running.
 */
export function checkGameContract(logic: AnyGame, example: ContractExample): string[] {
  const problems: string[] = []
  const note = (problem: string) => {
    if (!problems.includes(problem)) problems.push(problem)
  }
  if (!example.steps.some((s) => s.kind === 'join')) note('The example needs a join step')
  if (!example.steps.some((s) => s.kind === 'leave')) note('The example needs a leave step')

  const party = simulateParty({ games: [instrument(logic, note)], players: example.players })
  party.addGame(GAME_ID, logic.type, 'Contract round', example.config)
  const roster = party.players.map((p) => p.id)
  let refusalChecked = false

  /** Runs one part of a step; a throw (a bug) becomes a problem. */
  function attempt<T>(label: string, fn: () => T): T | undefined {
    try {
      return fn()
    } catch (error) {
      note(`${label}: ${describe(error)}`)
      return undefined
    }
  }

  const started = attempt('start', () => party.send(party.hostUser, { type: 'start', gameId: GAME_ID }))
  if (!started) return problems
  if (started.kind === 'refuse') {
    note(`start was refused: ${started.message}`)
    return problems
  }
  checkState('after the start')

  example.steps.forEach((s, i) => {
    const label = `step ${i + 1} (${s.kind})`
    const playerOf = (n: number) => {
      const id = roster[n]
      if (id === undefined || !party.players.some((p) => p.id === id)) {
        note(`${label}: there is no player ${n} in the party`)
        return null
      }
      return id
    }
    switch (s.kind) {
      case 'action': {
        const id = playerOf(s.player)
        if (id) checkAnswerOf(label, attempt(label, () => party.send(party.userOf(id), { type: 'action', gameId: GAME_ID, action: s.action })))
        break
      }
      case 'host':
        checkAnswerOf(
          label,
          attempt(label, () =>
            party.send(party.hostUser, { type: 'host-action', gameId: GAME_ID, action: s.action, close: s.close }),
          ),
        )
        break
      case 'answer': {
        const id = playerOf(s.player)
        if (id) {
          attempt(label, () => {
            try {
              party.submit(GAME_ID, s.key, id, s.answer, s.afterMs)
            } catch (error) {
              // The database refusing an answer (too late, already answered) is fine.
              if (!(error instanceof FakeDbError)) throw error
            }
          })
        }
        break
      }
      case 'tick':
        party.tick(s.ms)
        break
      case 'sync':
        checkAnswerOf(label, attempt(label, () => party.sync(GAME_ID)))
        checkWake(label)
        break
      case 'join': {
        const player = party.addPlayer(`Guest ${roster.length + 1}`)
        roster.push(player.id)
        checkAnswerOf(label, attempt(label, () => party.sync(GAME_ID)))
        checkWake(label)
        const game = party.game(GAME_ID)
        if (game.status === 'active' && !(player.id in game.views)) note(`${label}: the new player got no view`)
        break
      }
      case 'leave': {
        const id = playerOf(s.player)
        if (id) {
          party.removePlayer(id)
          checkAnswerOf(label, attempt(label, () => party.sync(GAME_ID)))
          checkWake(label)
        }
        break
      }
      case 'end':
        checkAnswerOf(label, attempt(label, () => party.send(party.hostUser, { type: 'end', gameId: GAME_ID })))
        break
    }
    checkState(`after ${label}`)
  })
  return problems

  /** A request's answer: refusals the game or the status explain are fine. */
  function checkAnswerOf(label: string, result: ReturnType<FakeParty['send']> | undefined) {
    if (!result || result.kind !== 'refuse') return
    const ok = result.code === 'rule' || result.code === 'not_running' || result.code === 'bad_request'
    if (!ok) note(`${label}: refused with ${result.status} ${result.code} "${result.message}"`)
  }

  function checkWake(label: string) {
    const game = party.game(GAME_ID)
    if (game.status !== 'active') return
    if (game.wakeAt !== null && game.wakeAt <= party.now) note(`${label}: after a sync, wakeAt is still due`)
    if (party.log.some((row) => row.kind === 'game.wake_stuck')) {
      note(`${label}: onWake didn't move wakeAt forward (game.wake_stuck)`)
    }
  }

  function checkState(label: string) {
    const game = party.game(GAME_ID)
    const info = party.infoOf(GAME_ID)
    const stored = party.stateOf(GAME_ID)
    if (!info || !stored) return
    attempt(`${label}: playerView for a player the game never knew`, () =>
      jsonbRoundTrip(logic.playerView(stored.state, STRANGER, info)),
    )
    if (game.status === 'active') {
      for (const player of party.players) if (!(player.id in game.views)) note(`${label}: ${player.name} has no view`)
      if (logic.recap) {
        for (const round of party.recapRounds(GAME_ID).filter((r) => !r.finished)) {
          const highlights = attempt(`${label}: recap()`, () => logic.recap!(round))
          if (highlights && highlights.length > 0) note(`${label}: recap() returned highlights for a round still running`)
        }
      }
    }
    if (game.status === 'finished' && !refusalChecked) {
      refusalChecked = true
      const someone = party.players[0]
      if (someone) {
        const result = attempt(`${label}: an action after the finish`, () =>
          party.send(party.userOf(someone.id), { type: 'action', gameId: GAME_ID, action: {} }),
        )
        if (result && !(result.kind === 'refuse' && result.status === 409 && result.code === 'not_running')) {
          note(`${label}: a finished game must refuse actions with 409 not_running`)
        }
      }
    }
  }
}

/**
 * The logic, with every hook checked: its input deep-frozen, its new state
 * jsonb-safe, and the projections of that state the same before and after a
 * strict jsonb round trip.
 */
function instrument(logic: AnyGame, note: (problem: string) => void): AnyGame {
  const checked = Object.create(logic) as AnyGame
  const hooks = [
    ['setup', 0],
    ['handleAction', 3],
    ['handleHostAction', 2],
    ['onWake', 1],
    ['onPlayerJoin', 2],
    ['onPlayerLeave', 2],
    ['onEnd', 1],
  ] as const
  for (const [name, ctxAt] of hooks) {
    const original = logic[name] as ((...args: unknown[]) => unknown) | undefined
    if (typeof original !== 'function') continue
    Object.defineProperty(checked, name, {
      value: (...args: unknown[]) => {
        if (name !== 'setup') deepFreeze(args[0])
        const next = original.apply(logic, args)
        checkProjections(`${logic.type}.${name}`, next, args[ctxAt] as GameContext<unknown>)
        return deepFreeze(next)
      },
    })
  }
  return checked

  function checkProjections(hook: string, state: unknown, info: GameInfo<unknown>) {
    let stored: unknown
    try {
      stored = jsonbRoundTrip(state)
    } catch (error) {
      note(`${hook} returned a state jsonb can't store: ${describe(error)}`)
      return
    }
    try {
      const before = project(logic, info, state)
      const after = project(logic, info, stored)
      jsonbRoundTrip(before)
      if (canonicalJson(before) !== canonicalJson(after)) {
        note(`${hook}: the projections change after a jsonb round trip of the state (do they depend on object key order?)`)
      }
    } catch (error) {
      note(`${hook}: the projections fail: ${describe(error)}`)
    }
  }
}

/** What a guest bot sees in a simulated party. */
export function botSight(party: FakeParty, gameId: string, playerId: PlayerId, random: () => number): BotSight {
  const game = party.game(gameId)
  return {
    playerId,
    players: party.players.map((p) => ({ id: p.id, name: p.name, code: party.codeOf(p.id) })),
    publicState: game.publicState,
    view: game.views[playerId] ?? null,
    prompts: party.promptsOf(gameId),
    myAnswers: party.answersOf(gameId, playerId),
    now: party.now,
    random,
  }
}

/** What the scripted host sees in a simulated party. */
export function hostBotSight(party: FakeParty, gameId: string, random: () => number): HostBotSight {
  const game = party.game(gameId)
  const stored = party.stateOf(gameId)
  return {
    players: party.players.map((p) => ({ id: p.id, name: p.name, code: party.codeOf(p.id) })),
    publicState: game.publicState,
    prompts: party.promptsOf(gameId),
    now: party.now,
    random,
    state: stored?.state ?? null,
    config: stored?.config ?? null,
    tallies: party.talliesOf(gameId),
  }
}

/**
 * A contract example played by the game's bot: its settings, its guests'
 * moves and its host moves, a tick a second with the TV's syncs, a guest who
 * joins and one who leaves, and End if the bot's round hasn't finished.
 * `refused` when the game won't start with the bot's settings.
 */
export function botExample(
  logic: AnyGame,
  bot: GameBot,
  { players = 6, rounds = 150 }: { players?: number; rounds?: number } = {},
): { example: ContractExample } | { refused: string } {
  const party = simulateParty({ games: [logic], players })
  const roster = party.players.map((p) => p.id)
  const config = bot.settings?.(roster) ?? {}
  party.addGame(GAME_ID, logic.type, 'Bot round', config)
  const started = party.send(party.hostUser, { type: 'start', gameId: GAME_ID })
  if (started.kind === 'refuse') return { refused: started.message }

  const random = seededRandom(99)
  const steps: ContractStep[] = []
  const live = () => party.game(GAME_ID).status === 'active'
  const join = () => {
    roster.push(party.addPlayer(`Guest ${roster.length + 1}`).id)
    party.sync(GAME_ID)
    steps.push({ kind: 'join' })
  }
  const leave = () => {
    // The last present player who isn't the first one.
    let index = roster.length - 1
    while (index > 0 && !party.players.some((p) => p.id === roster[index])) index--
    if (index <= 0) return
    party.removePlayer(roster[index])
    party.sync(GAME_ID)
    steps.push({ kind: 'leave', player: index })
  }

  for (let round = 0; round < rounds && live(); round++) {
    if (round === 3) join()
    if (round === 6) leave()
    roster.forEach((id, index) => {
      if (!live() || !party.players.some((p) => p.id === id)) return
      const move = bot.move(botSight(party, GAME_ID, id, random))
      if (move?.kind === 'action') {
        party.send(party.userOf(id), { type: 'action', gameId: GAME_ID, action: move.action })
        steps.push({ kind: 'action', player: index, action: move.action })
      } else if (move?.kind === 'answer') {
        const prompt = party.promptsOf(GAME_ID).find((p) => p.key === move.key)
        const afterMs = prompt ? party.now - prompt.openedAt : undefined
        try {
          party.submit(GAME_ID, move.key, id, move.answer, afterMs)
        } catch (error) {
          if (!(error instanceof FakeDbError)) throw error
        }
        steps.push({ kind: 'answer', player: index, key: move.key, answer: move.answer, afterMs })
      }
    })
    const hostMove = live() ? bot.hostMove?.(hostBotSight(party, GAME_ID, random)) : null
    if (hostMove) {
      party.send(party.hostUser, { type: 'host-action', gameId: GAME_ID, action: hostMove.action, close: hostMove.close })
      steps.push({ kind: 'host', action: hostMove.action, close: hostMove.close })
    }
    party.tick(1000)
    steps.push({ kind: 'tick', ms: 1000 })
    const wake = party.game(GAME_ID).wakeAt
    if (live() && wake !== null && wake <= party.now) {
      party.sync(GAME_ID)
      steps.push({ kind: 'sync' })
    }
  }
  if (!steps.some((s) => s.kind === 'join')) join()
  if (!steps.some((s) => s.kind === 'leave')) leave()
  if (live()) steps.push({ kind: 'end' })
  return { example: { config, players, steps } }
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
