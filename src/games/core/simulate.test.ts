import { describe, expect, it } from 'vitest'
import { Game, GameError, type GameContext } from './Game'
import { ProbeGame, type ProbePublicState, type ProbeState } from './probe'
import { FakeDbError, simulateParty } from './simulate'

const probe = new ProbeGame()

class BackgroundProbe extends ProbeGame {
  readonly type = 'probe-bg'
  readonly presentation = 'background' as const
}

function party(players = 4) {
  const p = simulateParty({ games: [probe, new BackgroundProbe()], players })
  p.addGame('g', 'probe', 'Probe')
  return p
}

describe('requests', () => {
  it('saves a tap once, even when the phone resends it', () => {
    const p = party()
    p.send(p.hostUser, { type: 'start', gameId: 'g' })
    const ana = p.players[0]
    const first = p.send(p.userOf(ana.id), { type: 'action', gameId: 'g', requestId: 'tap-1', action: { type: 'move' } })
    const copy = p.send(p.userOf(ana.id), { type: 'action', gameId: 'g', requestId: 'tap-1', action: { type: 'move' } })
    expect(first).toMatchObject({ kind: 'commit', replayed: false })
    expect(copy).toEqual({ kind: 'skip', replayed: true })
    expect(p.log.filter((row) => row.kind === 'game.action')).toHaveLength(1)
    expect(p.game('g').scores).toEqual({ [ana.id]: 1 })
  })

  it('counts rounds on restart and refuses what the status rules refuse', () => {
    const p = party()
    p.send(p.hostUser, { type: 'start', gameId: 'g' })
    expect(p.send(p.hostUser, { type: 'start', gameId: 'g' })).toMatchObject({ kind: 'refuse', code: 'already_running' })
    p.send(p.hostUser, { type: 'end', gameId: 'g' })
    expect(p.game('g')).toMatchObject({ status: 'finished', finishedBy: 'host', round: 1 })
    expect(p.send(p.hostUser, { type: 'end', gameId: 'g' })).toMatchObject({ kind: 'refuse', status: 409, code: 'not_running' })
    p.send(p.hostUser, { type: 'start', gameId: 'g' })
    expect(p.game('g')).toMatchObject({ status: 'active', finishedBy: null, winners: [], round: 2 })
  })

  it('lets the paired screen sync and nothing else', () => {
    const p = party()
    expect(p.send(p.screenUser, { type: 'start', gameId: 'g' })).toMatchObject({ kind: 'refuse', code: 'not_host' })
    p.send(p.hostUser, { type: 'start', gameId: 'g' })
    expect(p.send(p.screenUser, { type: 'action', gameId: 'g', action: { type: 'move' } })).toMatchObject({ code: 'not_player' })
    expect(p.sync('g')).toEqual({ kind: 'skip' })
  })
})

describe('prompts', () => {
  it('opens a prompt, takes answers until the deadline and reveals by the timer', () => {
    const p = party()
    const [ana, bo, cy] = p.players
    p.send(p.hostUser, { type: 'start', gameId: 'g' })
    p.send(p.hostUser, { type: 'host-action', gameId: 'g', action: { type: 'ask', step: 0 } })
    expect(p.pings.at(-1)).toBe('room')
    expect(p.submit('g', 'q1', bo.id, { choice: ['yes'] })).toEqual({ accepted: true, ms: 0 })
    expect(p.pings.at(-1)).toBe('stage q1')
    p.tick(2000)
    expect(p.submit('g', 'q1', ana.id, { choice: ['no'] })).toEqual({ accepted: true, ms: 2000 })
    // The same answer again counts as success; a different one is refused (final).
    expect(p.submit('g', 'q1', ana.id, { choice: 'no' } as never)).toMatchObject({ accepted: true, replayed: true })
    expect(() => p.submit('g', 'q1', ana.id, { choice: ['yes'] })).toThrow(expect.objectContaining({ code: 'already_answered' }))
    expect(() => p.submit('g', 'q1', cy.id, { choice: ['maybe'] })).toThrow(expect.objectContaining({ code: 'answer_invalid' }))
    expect(p.talliesOf('g')).toEqual({ q1: 2 })

    p.tick(8000)
    expect(() => p.submit('g', 'q1', cy.id, { choice: ['yes'] })).toThrow(expect.objectContaining({ code: 'closed' }))
    expect(p.game('g').wakeAt).toBeLessThanOrEqual(p.now)
    expect(p.sync('g')).toMatchObject({ kind: 'commit' })
    const game = p.game('g')
    expect(game.wakeAt).toBeNull()
    expect((game.publicState as ProbePublicState).results).toEqual([{ key: 'q1', yes: 1, no: 1 }])
    expect(game.scores).toEqual({ [bo.id]: 1 })
    expect(p.promptsOf('g')[0]).toMatchObject({ key: 'q1', revealedAt: p.now })
    // The sync's load closed it at its deadline, and logged that as the timer.
    const closes = p.log.filter((row) => row.kind === 'prompt.closed')
    expect(closes).toEqual([expect.objectContaining({ actor: 'timer', round: 1, data: { key: 'q1', round: 1, closed_at: p.promptsOf('g')[0].closedAt } })])
    expect(closes[0].data.closed_at).toBe(p.promptsOf('g')[0].closesAt)
  })

  it("closes the prompts a host action names, so it sees every answer: and only a host's close counts", () => {
    const p = party()
    const [ana] = p.players
    p.send(p.hostUser, { type: 'start', gameId: 'g' })
    p.send(p.hostUser, { type: 'host-action', gameId: 'g', action: { type: 'ask', step: 0 } })
    p.submit('g', 'q1', ana.id, { choice: ['yes'] })
    // A guest naming the prompt doesn't close it.
    p.send(p.userOf(ana.id), { type: 'host-action', gameId: 'g', action: { type: 'reveal', step: 1 }, close: ['q1'] })
    expect(p.promptsOf('g')[0].closedAt).toBeNull()
    expect(p.log.filter((row) => row.kind === 'prompt.closed')).toEqual([])
    const reveal = p.send(p.hostUser, { type: 'host-action', gameId: 'g', action: { type: 'reveal', step: 1 }, close: ['q1'] })
    expect(reveal.kind).toBe('commit')
    expect((p.game('g').publicState as ProbePublicState).results).toEqual([{ key: 'q1', yes: 1, no: 0 }])
    expect(p.log.filter((row) => row.kind === 'prompt.closed')).toEqual([
      expect.objectContaining({ actor: 'host', data: { key: 'q1', round: 1, closed_at: p.now } }),
    ])
    // A second Reveal now is stale: skipped, no error.
    expect(p.send(p.hostUser, { type: 'host-action', gameId: 'g', action: { type: 'reveal', step: 1 }, close: ['q1'] })).toEqual({
      kind: 'skip',
    })
  })

  it('refuses answers from players who left and to games that are over', () => {
    const p = party()
    const [ana, bo] = p.players
    p.send(p.hostUser, { type: 'start', gameId: 'g' })
    p.send(p.hostUser, { type: 'host-action', gameId: 'g', action: { type: 'ask', step: 0 } })
    p.removePlayer(bo.id)
    expect(() => p.submit('g', 'q1', bo.id, { choice: ['yes'] })).toThrow(FakeDbError)
    p.send(p.hostUser, { type: 'end', gameId: 'g' })
    expect(() => p.submit('g', 'q1', ana.id, { choice: ['yes'] })).toThrow(expect.objectContaining({ code: 'closed' }))
  })
})

describe('members', () => {
  it('runs the member hooks at the next request after a join or a removal', () => {
    const p = party(3)
    p.send(p.hostUser, { type: 'start', gameId: 'g' })
    const late = p.addPlayer('Late')
    const gone = p.players[0]
    p.removePlayer(gone.id)
    p.sync('g')
    const stored = p.stateOf('g')!
    expect((stored.state as ProbeState).joined).toEqual([late.id])
    expect((stored.state as ProbeState).left).toEqual([gone.id])
    expect(stored.members).toEqual(p.players.map((pl) => pl.id))
    expect(p.game('g').views).toHaveProperty(late.id)
    expect(p.game('g').views).not.toHaveProperty(gone.id)
  })
})

describe('the stage', () => {
  it('lets a finishing background game take a free stage, but not a busy one, and frees it after 3 minutes', () => {
    const p = party()
    const [ana] = p.players
    p.addGame('bg', 'probe-bg', 'Background', { movesToWin: 1, seconds: 10 })
    p.addGame('stage', 'probe', 'On stage')

    p.send(p.hostUser, { type: 'start', gameId: 'stage' })
    expect(p.spotlight).toBe('stage')
    p.send(p.hostUser, { type: 'start', gameId: 'bg' })
    expect(p.spotlight).toBe('stage')

    // The background game finishes while the stage game is live: it leaves the stage alone.
    p.send(p.userOf(ana.id), { type: 'action', gameId: 'bg', action: { type: 'move' } })
    expect(p.game('bg')).toMatchObject({ status: 'finished', finishedBy: 'game', winners: [ana.id] })
    expect(p.spotlight).toBe('stage')

    // The stage game ends: it keeps the stage for its final screen...
    p.send(p.hostUser, { type: 'end', gameId: 'stage' })
    expect(p.spotlight).toBe('stage')
    // ...and a game finishing inside those 3 minutes doesn't take it.
    p.send(p.hostUser, { type: 'start', gameId: 'bg' })
    p.send(p.userOf(ana.id), { type: 'action', gameId: 'bg', action: { type: 'move' } })
    expect(p.spotlight).toBe('stage')

    // After the 3 minutes, the stage is free again.
    p.tick(181_000)
    p.send(p.hostUser, { type: 'start', gameId: 'bg' })
    p.send(p.userOf(ana.id), { type: 'action', gameId: 'bg', action: { type: 'move' } })
    expect(p.spotlight).toBe('bg')
    expect(p.log.filter((row) => row.kind === 'stage.changed').map((row) => row.data.reason)).toEqual(['start', 'finish'])
  })

  it('clears the spotlight when its game restarts in the background', () => {
    const p = party()
    p.send(p.hostUser, { type: 'start', gameId: 'g' })
    p.send(p.hostUser, { type: 'end', gameId: 'g' })
    p.send(p.hostUser, { type: 'start', gameId: 'g', stage: false })
    expect(p.spotlight).toBeNull()
  })

  it('logs the TV leaving the recap when a start takes the stage, also for the game already on it', () => {
    const p = party()
    const scenes = () => p.log.filter((row) => row.kind === 'session.tv_scene').map((row) => row.data)
    p.send(p.hostUser, { type: 'start', gameId: 'g' })
    expect(scenes()).toEqual([])
    p.send(p.hostUser, { type: 'end', gameId: 'g' })
    p.tvScene = 'recap'
    p.send(p.hostUser, { type: 'start', gameId: 'g' })
    expect(p.tvScene).toBe('live')
    expect(scenes()).toEqual([{ tv_scene: 'live', reason: 'start' }])
    expect(p.log.filter((row) => row.kind === 'stage.changed')).toHaveLength(1)
  })
})

describe('saving as Postgres does', () => {
  it('stores state through the jsonb round trip: keys reordered, and what jsonb refuses fails the save', () => {
    class KeyOrder extends Game<Record<string, number>, { bad: boolean }, string[], null, object> {
      readonly type = 'keys'
      readonly defaultConfig = {}
      setup() {
        return { zed: 1, bo: 2, a: 3 }
      }
      parseAction(input: unknown) {
        return { bad: (input as { bad?: boolean }).bad === true }
      }
      handleAction(state: Record<string, number>, action: { bad: boolean }, _id: string, ctx: GameContext<object>) {
        if (!action.bad) throw new GameError('Nothing to do')
        return { ...state, nope: ctx.now / 0 - Infinity }
      }
      scores() {
        return {}
      }
      publicState(state: Record<string, number>) {
        return Object.keys(state)
      }
      playerView() {
        return null
      }
    }
    const p = simulateParty({ games: [new KeyOrder()], players: 2 })
    p.addGame('k', 'keys', 'Keys')
    p.send(p.hostUser, { type: 'start', gameId: 'k' })
    expect(Object.keys(p.stateOf('k')!.state as object)).toEqual(['a', 'bo', 'zed'])
    expect(() => p.send(p.userOf(p.players[0].id), { type: 'action', gameId: 'k', action: { bad: true } })).toThrow(
      "jsonb can't store NaN",
    )
  })

  it('hands hooks frozen input, so a mutation fails at once', () => {
    class Mutates extends ProbeGame {
      handleAction(state: ProbeState, _action: unknown, playerId: string, ctx: GameContext<{ movesToWin: number; seconds: number }>) {
        state.moves.push({ by: playerId, at: ctx.now })
        return state
      }
    }
    const p = simulateParty({ games: [new Mutates()], players: 2 })
    p.addGame('m', 'probe', 'Mutates')
    p.send(p.hostUser, { type: 'start', gameId: 'm' })
    expect(() => p.send(p.userOf(p.players[0].id), { type: 'action', gameId: 'm', action: { type: 'move' } })).toThrow(TypeError)
  })
})

describe('the recap rounds', () => {
  it('hands recap() each round with its log, points and players, finished or not', () => {
    const p = party()
    const [ana] = p.players
    p.send(p.hostUser, { type: 'start', gameId: 'g' })
    p.send(p.userOf(ana.id), { type: 'action', gameId: 'g', action: { type: 'move' } })
    let [round] = p.recapRounds('g')
    expect(round).toMatchObject({ round: 1, finished: false, finishedAt: null, points: { [ana.id]: 1 } })
    expect(probe.recap(round as never)).toEqual([])

    p.send(p.hostUser, { type: 'end', gameId: 'g' })
    ;[round] = p.recapRounds('g')
    expect(round).toMatchObject({ finished: true, finishedBy: 'host', winners: [ana.id] })
    expect(round.log.map((row) => row.kind)).toEqual([
      'game.start',
      'game.effects',
      'game.started',
      'stage.changed',
      'game.action',
      'game.effects',
      'game.end',
      'game.effects',
      'game.finished',
    ])
    expect(probe.recap(round as never)).toEqual([
      { title: 'The probe ended after 1 moves', players: [ana.id], weight: 'headline' },
    ])
  })
})
