import { describe, expect, it, vi } from 'vitest'
import { Game, GameError, type AnyGame, type GameContext, type GamePlayer, type PlayerId } from './Game'
import { ProbeGame, type ProbeState } from './probe'
import { canonicalJson, defaultWinners, MAX_WAKES, step, type EngineRequest, type Loaded, type Step } from './runtime'
import { seededRandom } from './testing'

const probe = new ProbeGame()
const PLAYERS: GamePlayer[] = ['ana', 'bo', 'cy'].map((id) => ({ id, name: id, profile: {} }))
const HOST = { player_id: null, is_host: true, is_screen: false }
const SCREEN = { player_id: null, is_host: false, is_screen: true }
const OUTSIDER = { player_id: null, is_host: false, is_screen: false }
const guest = (id: PlayerId) => ({ player_id: id, is_host: false, is_screen: false })

function pending(overrides: Partial<Loaded> = {}): Loaded {
  return {
    now: 10_000,
    claimed: false,
    game: { id: 'g1', session_id: 's1', game_type: 'probe', title: 'Probe', status: 'pending', archived_at: null, wake_at: null },
    settings: {},
    current: null,
    session: { id: 's1', name: 'Party', data: {}, spotlight_game_id: null },
    players: PLAYERS,
    caller: HOST,
    scoreboard: {},
    awards: {},
    prompts: {},
    ...overrides,
  }
}

const env = (overrides: Partial<Parameters<typeof step>[3]> = {}) => ({
  userId: 'host-user',
  now: 10_000,
  random: seededRandom(),
  round: null,
  ...overrides,
})

const start: EngineRequest = { type: 'start', gameId: 'g1', requestId: 'r-start' }
const move: EngineRequest = { type: 'action', gameId: 'g1', requestId: 'r-move', action: { type: 'move' } }
const sync: EngineRequest = { type: 'sync', gameId: 'g1', requestId: 'r-sync' }
const end: EngineRequest = { type: 'end', gameId: 'g1', requestId: 'r-end' }
const hostAction = (action: unknown, close?: string[]): EngineRequest => ({
  type: 'host-action',
  gameId: 'g1',
  requestId: 'r-host',
  action,
  close,
})

function commitOf(result: Step) {
  if (result.kind !== 'commit') throw new Error(`Expected a commit, got ${JSON.stringify(result)}`)
  return result.commit
}

/** The game running after a start, as game_load would return it next. */
function running(logic: AnyGame = probe, settings: Record<string, unknown> = {}, overrides: Partial<Loaded> = {}): Loaded {
  const commit = commitOf(step(logic, pending({ settings }), start, env()))
  return pending({
    game: { id: 'g1', session_id: 's1', game_type: logic.type, title: 'Probe', status: 'active', archived_at: null, wake_at: commit.wake_at },
    current: { state: commit.state, version: 1, round: 1, config: commit.config, members: commit.members },
    ...overrides,
  })
}

describe('who may', () => {
  it('lets only hosts start, end and send host actions', () => {
    for (const request of [start, end, hostAction({ type: 'ask', step: 0 })]) {
      const base = request.type === 'start' ? pending() : running()
      for (const caller of [guest('ana'), SCREEN, OUTSIDER]) {
        expect(step(probe, { ...base, caller }, request, env())).toEqual({
          kind: 'refuse',
          status: 403,
          code: 'not_host',
          message: 'Only hosts can do that',
        })
      }
    }
  })

  it('lets only players move, and a paired screen only sync', () => {
    for (const caller of [HOST, SCREEN, OUTSIDER]) {
      expect(step(probe, { ...running(), caller }, move, env())).toMatchObject({ kind: 'refuse', status: 403, code: 'not_player' })
    }
    expect(step(probe, { ...running(), caller: OUTSIDER }, sync, env())).toMatchObject({ status: 403, code: 'not_player' })
    for (const caller of [HOST, SCREEN, guest('ana')]) {
      expect(step(probe, { ...running(), caller }, sync, env()).kind).toBe('skip')
    }
  })
})

describe('status', () => {
  it('refuses to start an archived or running game, and anything else on one that is not running', () => {
    const archived = pending({ game: { ...pending().game, archived_at: 1 } })
    expect(step(probe, archived, start, env())).toMatchObject({ status: 409, code: 'archived' })
    expect(step(probe, running(), start, env())).toMatchObject({ status: 409, code: 'already_running' })
    expect(step(probe, { ...pending(), caller: guest('ana') }, move, env())).toMatchObject({ status: 409, code: 'not_running' })
    expect(step(probe, pending(), end, env())).toMatchObject({ status: 409, code: 'not_running' })
    // A sync on a game that isn't live is answered as skipped.
    expect(step(probe, pending(), sync, env())).toEqual({ kind: 'skip' })
  })

  it('refuses a request held across a restart', () => {
    const loaded = { ...running(), caller: guest('ana') }
    expect(step(probe, loaded, move, env({ round: 2 }))).toEqual({
      kind: 'refuse',
      status: 409,
      code: 'restarted',
      message: 'The game was restarted',
    })
    expect(commitOf(step(probe, loaded, move, env({ round: 1 }))).expected_round).toBe(1)
  })
})

describe('settings', () => {
  it('checks them once at start and freezes them for the round', () => {
    const commit = commitOf(step(probe, pending({ settings: { movesToWin: 2 } }), start, env()))
    expect(commit.config).toEqual({ movesToWin: 2, seconds: 10 })

    // Settings saved later don't touch the running round.
    const loaded = { ...running(probe, { movesToWin: 2 }), settings: { movesToWin: 1 }, caller: guest('ana') }
    expect(commitOf(step(probe, loaded, move, env())).status).toBeNull()
  })

  it('turns a GameError from parseConfig into a refusal', () => {
    expect(step(probe, pending({ settings: { movesToWin: 0 } }), start, env())).toMatchObject({
      status: 400,
      code: 'rule',
      message: 'movesToWin must be a whole number from 1 to 100',
    })
  })
})

describe('moves and refusals', () => {
  it("saves a move with the caller's own view, and refuses a broken rule", () => {
    const result = step(probe, { ...running(), caller: guest('ana') }, move, env())
    const commit = commitOf(result)
    expect(commit.request).toMatchObject({ type: 'action', actor: 'player', player_id: 'ana', action: { type: 'move' } })
    expect(commit.expected_version).toBe(1)
    expect(commit.scores).toEqual({ ana: 1 })
    expect(result).toMatchObject({ view: { moves: 1, lastAnswer: null } })

    const bad = { ...move, action: { type: 'steal' } }
    expect(step(probe, { ...running(), caller: guest('ana') }, bad, env())).toEqual({
      kind: 'refuse',
      status: 400,
      code: 'rule',
      message: 'Unknown action',
    })
  })

  it('lets a bug propagate', () => {
    class Broken extends ProbeGame {
      handleAction(): ProbeState {
        throw new Error('oops')
      }
    }
    expect(() => step(new Broken(), { ...running(), caller: guest('ana') }, move, env())).toThrow('oops')
  })

  it('refuses host actions for a game without host controls', () => {
    class NoControls extends Game<object, never, object, object, object> {
      readonly type = 'plain'
      readonly defaultConfig = {}
      setup() {
        return {}
      }
      parseAction(): never {
        throw new GameError('No moves')
      }
      handleAction(state: object) {
        return state
      }
      scores() {
        return {}
      }
      publicState() {
        return {}
      }
      playerView() {
        return {}
      }
    }
    const logic = new NoControls()
    expect(step(logic, running(logic), hostAction({}), env())).toMatchObject({
      status: 400,
      code: 'bad_request',
      message: 'This game has no host controls',
    })
  })
})

describe('skips', () => {
  it('skips a stale host action: a double tap or a race with the timer', () => {
    const asked = commitOf(step(probe, running(), hostAction({ type: 'ask', step: 0 }), env()))
    const loaded = running(probe, {}, {
      current: { state: asked.state, version: 2, round: 1, config: asked.config ?? { movesToWin: 3, seconds: 10 }, members: asked.members },
      game: { ...running().game, wake_at: asked.wake_at },
    })
    // The second tap still says step 0, but the game is at step 1.
    expect(step(probe, loaded, hostAction({ type: 'ask', step: 0 }), env())).toEqual({ kind: 'skip' })
  })

  it('skips an early or repeated sync', () => {
    expect(step(probe, { ...running(), caller: SCREEN }, sync, env())).toEqual({ kind: 'skip' })
  })
})

describe('membership', () => {
  /** Records each member hook call and its actor. */
  class Members extends ProbeGame {
    calls: string[] = []
    onPlayerJoin(state: ProbeState, player: GamePlayer, ctx: GameContext<{ movesToWin: number; seconds: number }>) {
      this.calls.push(`join ${player.id} as ${ctx.actor.kind}`)
      ctx.announce(`Welcome ${player.name}`)
      return { ...state, joined: [...state.joined, player.id] }
    }
    onPlayerLeave(state: ProbeState, playerId: PlayerId, ctx: GameContext<{ movesToWin: number; seconds: number }>) {
      this.calls.push(`leave ${playerId} as ${ctx.actor.kind}`)
      return { ...state, left: [...state.left, playerId] }
    }
  }

  it('runs onPlayerLeave, then onPlayerJoin, as system, and keeps the members list', () => {
    const logic = new Members()
    const base = running(logic)
    const loaded = {
      ...base,
      // cy left, dee joined.
      players: [...PLAYERS.filter((p) => p.id !== 'cy'), { id: 'dee', name: 'Dee', profile: {} }],
      caller: SCREEN,
    }
    const commit = commitOf(step(logic, loaded, sync, env()))
    expect(logic.calls).toEqual(['leave cy as system', 'join dee as system'])
    expect(commit.log).toEqual({ joined: ['dee'], left: ['cy'], woke: 0 })
    expect(commit.members).toEqual(['ana', 'bo', 'dee'])
    expect(commit.effects.announcements).toEqual([{ message: 'Welcome Dee' }])
    expect(commit.player_views).toHaveProperty('dee')
    expect(commit.player_views).not.toHaveProperty('cy')
  })

  it('fails open: a throwing hook keeps the state from before it and drops only its effects', () => {
    class Throws extends Members {
      onPlayerJoin(_state: ProbeState, player: GamePlayer, ctx: GameContext<{ movesToWin: number; seconds: number }>): ProbeState {
        ctx.announce('This one is dropped')
        throw new Error(`can't welcome ${player.id}`)
      }
    }
    const logic = new Throws()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const loaded = { ...running(logic), players: [...PLAYERS.filter((p) => p.id !== 'cy'), { id: 'dee', name: 'Dee', profile: {} }], caller: SCREEN }
    const commit = commitOf(step(logic, loaded, sync, env()))
    error.mockRestore()
    expect((commit.state as ProbeState).left).toEqual(['cy'])
    expect((commit.state as ProbeState).joined).toEqual([])
    expect(commit.effects.announcements).toEqual([])
    expect(commit.members).toEqual(['ana', 'bo', 'dee'])
  })
})

describe('finishing', () => {
  it('finishes by itself in the same save, with winners from this round', () => {
    const loaded = { ...running(probe, { movesToWin: 1 }), caller: guest('bo') }
    const commit = commitOf(step(probe, loaded, move, env()))
    expect(commit).toMatchObject({ status: 'finished', finished_by: 'game', winners: ['bo'], wake_at: null })
    expect((commit.state as ProbeState).ended).toBe('game')
  })

  it('still finishes when onEnd throws, keeping the deciding move and dropping only onEnd', () => {
    class LoudEnd extends ProbeGame {
      onEnd(_state: ProbeState, ctx: GameContext<{ movesToWin: number; seconds: number }>): ProbeState {
        ctx.announce('Dropped')
        throw new Error('onEnd broke')
      }
    }
    const logic = new LoudEnd()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const commit = commitOf(step(logic, { ...running(logic, { movesToWin: 1 }), caller: guest('ana') }, move, env()))
    error.mockRestore()
    expect(commit).toMatchObject({ status: 'finished', finished_by: 'game' })
    expect(commit.effects.announcements.map((a) => a.message)).toEqual(['ana made the winning move'])
  })

  it('ends when the host says so; End always ends, even when onEnd throws', () => {
    const commit = commitOf(step(probe, running(), end, env()))
    expect(commit).toMatchObject({ status: 'finished', finished_by: 'host', winners: [] })
    expect(commit.effects.announcements.map((a) => a.message)).toEqual(['The probe is over'])

    class BrokenEnd extends ProbeGame {
      onEnd(): ProbeState {
        throw new Error('onEnd broke')
      }
    }
    const logic = new BrokenEnd()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const loaded = running(logic)
    const failOpen = commitOf(step(logic, loaded, end, env()))
    error.mockRestore()
    expect(failOpen).toMatchObject({ status: 'finished', finished_by: 'host', state: loaded.current!.state })
    // game_commit keeps the stored projections.
    expect(failOpen).not.toHaveProperty('public_state')
    expect(failOpen).not.toHaveProperty('player_views')
    expect(failOpen).not.toHaveProperty('scores')
    expect(failOpen.effects).toEqual({ points: [], profiles: {}, announcements: [], records: [], prompts: { open: [], close: [], reveal: [] } })
  })

  it('ends even when the projections throw', () => {
    class BrokenViews extends ProbeGame {
      publicState(state: ProbeState): never {
        if (state.ended) throw new Error('no public state')
        return super.publicState(state) as never
      }
    }
    const logic = new BrokenViews()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const commit = commitOf(step(logic, running(logic), end, env()))
    error.mockRestore()
    expect(commit.status).toBe('finished')
    expect(commit).not.toHaveProperty('public_state')
  })

  it('crowns the top of the round by default: scores plus awards, all tied, nobody at 0', () => {
    expect(defaultWinners({ ana: 2 }, { bo: 2, cy: 1 })).toEqual(['ana', 'bo'])
    expect(defaultWinners({}, { ana: 3 }, [{ player_id: 'bo', points: 3 }])).toEqual(['ana', 'bo'])
    expect(defaultWinners({}, {})).toEqual([])
    expect(defaultWinners({}, { ana: -2 })).toEqual([])

    // An in-person round ended by the host: the awards decide.
    const loaded = { ...running(), awards: { cy: 4, ana: 1 } }
    expect(commitOf(step(probe, loaded, end, env())).winners).toEqual(['cy'])
  })
})

describe('timers', () => {
  it('opens a prompt with a deadline and reveals it when the sync comes', () => {
    const asked = commitOf(step(probe, running(), hostAction({ type: 'ask', step: 0 }), env()))
    expect(asked.effects.prompts.open).toEqual([
      { key: 'q1', spec: { kind: 'choice', options: ['yes', 'no'], final: true }, closes_at: 20_000 },
    ])
    expect(asked.wake_at).toBe(20_000)

    const loaded: Loaded = {
      ...running(),
      now: 21_000,
      caller: SCREEN,
      game: { ...running().game, wake_at: 20_000 },
      current: { state: asked.state, version: 2, round: 1, config: { movesToWin: 3, seconds: 10 }, members: asked.members },
      prompts: {
        q1: {
          spec: { kind: 'choice', options: ['yes', 'no'], final: true },
          opened_at: 10_000,
          closes_at: 20_000,
          closed_at: 20_000,
          revealed_at: null,
          submissions: [
            { player_id: 'bo', answer: { choice: ['yes'] }, first_at: 12_000, at: 12_000, ms: 2000, changes: 0 },
            { player_id: 'ana', answer: { choice: ['no'] }, first_at: 13_000, at: 13_000, ms: 3000, changes: 0 },
          ],
        },
      },
    }
    const woke = commitOf(step(probe, loaded, sync, env({ now: 21_000 })))
    expect(woke.request.actor).toBe('timer')
    expect(woke.log.woke).toBe(1)
    expect(woke.wake_at).toBeNull()
    expect(woke.effects.prompts.reveal).toEqual(['q1'])
    expect(woke.effects.points).toEqual([{ player_id: 'bo', points: 1, reason: 'First to say yes' }])
    expect(woke.public_state).toMatchObject({ results: [{ key: 'q1', yes: 1, no: 1 }] })
  })

  it('caps the wake loop and clears a stuck wake_at', () => {
    class Stuck extends ProbeGame {
      wakes = 0
      wakeAt() {
        return 5_000
      }
      onWake(state: ProbeState) {
        this.wakes++
        return { ...state, step: state.step + 1 }
      }
    }
    const logic = new Stuck()
    const loaded = { ...running(logic), caller: SCREEN, game: { ...running(logic).game, wake_at: 5_000 } }
    const commit = commitOf(step(logic, loaded, sync, env()))
    expect(logic.wakes).toBe(MAX_WAKES)
    expect(commit.wake_at).toBeNull()
    expect(commit.log).toMatchObject({ woke: MAX_WAKES, wake_stuck: true })
  })
})

describe('the stage', () => {
  it('takes the TV by default, unless the game runs in the background or the host says so', () => {
    expect(commitOf(step(probe, pending(), start, env())).stage).toBe('take')
    expect(commitOf(step(probe, pending(), { ...start, stage: false }, env())).stage).toBe('keep')
    class Background extends ProbeGame {
      readonly presentation = 'background' as const
    }
    expect(commitOf(step(new Background(), pending(), start, env())).stage).toBe('keep')
    expect(commitOf(step(new Background(), pending(), { ...start, stage: true }, env())).stage).toBe('take')
  })

  it('starts a new round with no prompts and the next round number', () => {
    const restart = pending({
      game: { ...pending().game, status: 'finished' },
      current: { state: {}, version: 7, round: 2, config: {}, members: [] },
      prompts: {
        q1: { spec: { kind: 'text' }, opened_at: 1, closes_at: null, closed_at: 1, revealed_at: null, submissions: [] },
      },
    })
    const commit = commitOf(step(probe, restart, start, env()))
    expect(commit).toMatchObject({ status: 'active', expected_version: null, expected_round: null, members: ['ana', 'bo', 'cy'] })
    expect(commit.effects.announcements[0].message).toBe('The probe has started')
  })
})

describe('canonicalJson', () => {
  it('compares as jsonb does: key order never matters, array order does', () => {
    expect(canonicalJson({ b: 1, a: { d: 1, c: 2 } })).toBe(canonicalJson({ a: { c: 2, d: 1 }, b: 1 }))
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]))
    expect(canonicalJson({ a: undefined })).toBe('{}')
  })
})
