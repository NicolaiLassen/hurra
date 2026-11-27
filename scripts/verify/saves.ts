// Old saves (docs/developing.md, "The game mechanic verifier"): what
// game_load gave older versions of the games, captured by playing each one
// with its own bot at that version (make-saves.ts), loaded by today's games
// through the real step(): the TV's sync, the host's steps, a guest leaving
// and one joining, a move, End, and the recap of the ended round. None of it
// may throw, and End always ends.
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { gameLogic } from '../../src/games/logic'
import type { AnyGame, PlayerId, RecapRound } from '../../src/games/core/Game'
import { project, step, type EngineRequest, type Loaded } from '../../src/games/core/runtime'
import { jsonbRoundTrip } from '../../src/games/core/testing'

export type OldSave = {
  /** The commit that saved it, and its date. */
  version: string
  game: string
  /** What the round was doing: its status and phase. */
  label: string
  loaded: Omit<Loaded, 'claimed' | 'caller'>
}

export const SAVES_FILE = new URL('./saves.json.gz', import.meta.url)

/** A request without its ids, which the check adds. */
type Bare = EngineRequest extends infer R ? (R extends unknown ? Omit<R, 'requestId' | 'gameId'> : never) : never

export function readSaves(): OldSave[] {
  try {
    return JSON.parse(gunzipSync(readFileSync(SAVES_FILE)).toString('utf8')) as OldSave[]
  } catch {
    return []
  }
}

/** Host steps worth trying on a round saved mid-way, by game. */
function hostSteps(game: string, state: Record<string, unknown> | null): unknown[] {
  const n = (value: unknown, fallback = 0) => (typeof value === 'number' ? value : fallback)
  switch (game) {
    case 'quiz':
      return [
        { type: 'next', from: n(state?.index, -1) },
        { type: 'reveal', index: Math.max(0, n(state?.index)) },
        { type: 'leaderboard', index: Math.max(0, n(state?.index)) },
        { type: 'finish' },
      ]
    case 'fusion':
      return [
        { type: 'wall', from: 'lobby' },
        { type: 'ask', n: 1 },
        { type: 'ask', n: 2 },
        { type: 'reveal', n: n(state?.current, 1) || 1 },
        { type: 'wall', from: 'reveal', n: n(state?.current, 1) || 1 },
        { type: 'setKey', n: 1, people: ['Ana', 'Bo'] },
        { type: 'finish' },
      ]
    case 'soundtrack': {
      const played = Array.isArray(state?.playedAt) ? state.playedAt.length : 0
      return [
        { type: 'play', index: played },
        { type: 'lastCall', after: played },
        { type: 'more', n: 1 },
        { type: 'lock' },
        { type: 'reveal', index: n(state?.revealed) },
        { type: 'accept', index: 0, part: 'title', key: 'paperlanterns', accepted: true },
        { type: 'standings', after: n(state?.revealed) },
        { type: 'sitOut', names: ['Guest 2'] },
        { type: 'crown' },
      ]
    }
    case 'elimination':
      return [
        { type: 'dealIn', open: true },
        { type: 'dealIn', open: false },
      ]
    default:
      return [{ type: 'next' }]
  }
}

export function checkOldSaves(only: string | null): Map<string, { runs: number; failures: string[] }> {
  const out = new Map<string, { runs: number; failures: string[] }>()
  const saves = readSaves()
  for (const type of gameLogic.keys()) if (only === null || only === type) out.set(type, { runs: 0, failures: [] })
  if (saves.length === 0) {
    for (const result of out.values()) result.failures.push(`No old saves found at ${SAVES_FILE.pathname}: run node scripts/verify/make-saves.ts`)
    return out
  }
  for (const save of saves) {
    if (only !== null && save.game !== only) continue
    const logic = gameLogic.get(save.game)
    const result = out.get(save.game)
    if (!logic || !result) continue
    result.runs++
    for (const problem of checkSave(logic, save)) result.failures.push(`${save.version} ${save.game} (${save.label}): ${problem}`)
  }
  return out
}

function checkSave(logic: AnyGame, save: OldSave): string[] {
  const problems: string[] = []
  const base = save.loaded
  const current = base.current
  const host: Loaded['caller'] = { player_id: null, is_host: true, is_screen: false }
  let n = 0
  const run = (label: string, loaded: Omit<Loaded, 'claimed' | 'caller'>, request: Bare, caller = host) => {
    try {
      const full = { ...request, gameId: loaded.game.id, requestId: `old-${++n}` } as EngineRequest
      const result = step(logic, { ...structuredClone(loaded), claimed: false, caller }, full, { userId: 'host', now: loaded.now, random: () => 0.5, round: null })
      if (result.kind === 'commit') jsonbRoundTrip(result.commit)
      if (result.kind === 'refuse' && !['rule', 'bad_request', 'not_running', 'already_running'].includes(result.code)) {
        problems.push(`${label} was refused with ${result.code}: ${result.message}`)
      }
      return result
    } catch (error) {
      problems.push(`${label} threw: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }
  if (!current) return problems
  const state = (current.state ?? null) as Record<string, unknown> | null

  // What every screen reads: the projections, for every player and a stranger.
  try {
    const info = {
      gameId: base.game.id,
      round: current.round,
      session: { id: base.session.id, name: base.session.name, data: base.session.data },
      players: base.players.map((p) => ({ id: p.id, name: p.name, profile: p.profile })),
      guests: base.guests ?? base.players.map((p) => ({ id: p.id, name: p.name, joined: true })),
      scoreboard: base.scoreboard,
      config: current.config,
      now: base.now,
      prompts: {},
      answers: {},
    }
    jsonbRoundTrip(project(logic, info, current.state))
    jsonbRoundTrip(logic.playerView(current.state, '00000000-0000-4000-8000-00000000beef', info))
    logic.wakeAt?.(current.state, info)
  } catch (error) {
    problems.push(`its projections threw: ${error instanceof Error ? error.message : String(error)}`)
  }

  // The TV's sync, on time and long after.
  run('a sync', base, { type: 'sync' })
  run('a late sync', { ...base, now: base.now + 120_000, game: { ...base.game, wake_at: base.now } }, { type: 'sync' })
  // The host's steps.
  for (const action of hostSteps(save.game, state)) run(`the host's ${JSON.stringify(action)}`, base, { type: 'host-action', action })
  // A guest leaves and a new one joins, then a move from a guest.
  const [first, ...rest] = base.players
  if (first) {
    const moved = { ...base, players: [...rest, { id: '00000000-0000-4000-8000-0000000000aa', name: 'Late Guest', profile: {}, joined_at: base.now }] }
    run('a leave and a join', moved, { type: 'sync' })
    const target = rest[0]?.id ?? first.id
    const guest = { player_id: first.id, is_host: false, is_screen: false }
    run('a tag', base, { type: 'action', action: { type: 'tag', target } }, guest)
    run('a join tap', base, { type: 'action', action: { type: 'join' } }, guest)
  }
  // End always ends, and the recap reads the ended round.
  if (base.game.status === 'active') {
    const ended = run('End', base, { type: 'end' })
    if (!ended || ended.kind !== 'commit' || ended.commit.status !== 'finished') problems.push(`End did not end it (${ended?.kind ?? 'threw'})`)
    else if (logic.recap) {
      try {
        const round: RecapRound<unknown, unknown> = {
          gameId: base.game.id,
          title: base.game.title,
          round: current.round,
          finished: true,
          startedAt: base.now - 3_600_000,
          finishedAt: base.now,
          finishedBy: 'host',
          config: current.config,
          state: ended.commit.state,
          winners: (ended.commit.winners ?? []) as PlayerId[],
          players: base.players.map((p) => ({ id: p.id, name: p.name })),
          points: ended.commit.scores ?? {},
          log: [],
        }
        logic.recap(round)
      } catch (error) {
        problems.push(`the recap threw: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  return problems
}
