import { describe, expect, it } from 'vitest'
import { Game, GameError, type GameContext, type GameInfo, type PlayerId } from './Game'
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

describe('the guest list', () => {
  type AimsState = { target: PlayerId }
  /** Aims every effect at the guest its settings name, joined or not, and opens two prompts that name people. */
  class Aims extends Game<AimsState, { type: 'aim' }, { target: string }, { me: boolean }, { target: string }> {
    readonly type = 'aims'
    readonly defaultConfig = { target: '' }
    setup(ctx: GameContext<{ target: string }>): AimsState {
      if (!ctx.guests.some((g) => g.id === ctx.config.target)) throw new GameError('Pick someone on the guest list')
      ctx.openPrompt('who', { kind: 'choice', options: 'players' })
      ctx.openPrompt('anyone', { kind: 'choice', options: 'guests', exclude_self: true })
      return { target: ctx.config.target }
    }
    parseAction(): { type: 'aim' } {
      return { type: 'aim' }
    }
    handleAction(state: AimsState, _action: { type: 'aim' }, _by: PlayerId, ctx: GameContext<{ target: string }>): AimsState {
      ctx.awardPoints(state.target, 2, 'Aimed')
      ctx.updateProfile(state.target, { aimed: true })
      ctx.announce('Only for the target', { to: [state.target] })
      return state
    }
    scores(state: AimsState) {
      return { [state.target]: 7 }
    }
    publicState(state: AimsState, info: GameInfo<{ target: string }>) {
      return { target: info.guests.find((g) => g.id === state.target)?.name ?? '' }
    }
    playerView(state: AimsState, playerId: PlayerId) {
      return { me: playerId === state.target }
    }
  }

  it('lists, takes and frees names as the database does', () => {
    const p = simulateParty({ games: [new Aims()], players: 2 })
    const zelda = p.listGuest('Zelda')
    expect(p.guests.map((g) => g.name)).toEqual(['Zelda'])
    expect(p.players.map((pl) => pl.id)).not.toContain(zelda.id)
    expect(p.log.at(-1)).toMatchObject({ kind: 'guest.added', actor: 'host', data: { name: 'Zelda', player_id: zelda.id } })
    expect(p.pings.at(-1)).toBe('stage')
    expect(p.guestList()).toEqual([
      ...p.players.map((pl) => ({ id: pl.id, name: pl.name, joined: true })),
      { id: zelda.id, name: 'Zelda', joined: false },
    ])

    const joined = p.claimGuest(zelda.id)
    expect(joined).toMatchObject({ id: zelda.id, name: 'Zelda' })
    expect(p.guests).toEqual([])
    expect(p.players.at(-1)!.id).toBe(zelda.id)
    expect(p.log.at(-1)).toMatchObject({ kind: 'player.joined', data: { player_id: zelda.id, listed: true } })
    expect(() => p.claimGuest(zelda.id)).toThrow(FakeDbError)

    p.addGame('g', 'aims', 'Aims', { target: zelda.id })
    p.send(p.hostUser, { type: 'start', gameId: 'g' })
    p.send(p.userOf(p.players[0].id), { type: 'action', gameId: 'g', action: { type: 'aim' } })
    p.submit('g', 'anyone', zelda.id, { choice: [p.players[0].id] })
    expect(p.game('g').scores).toEqual({ [zelda.id]: 7 })
    expect(p.infoOf('g')!.scoreboard[zelda.id]).toBe(9)
    expect(p.feed.map((f) => f.audience)).toEqual([[zelda.id]])

    const code = p.codeOf(zelda.id)
    p.freeGuest(zelda.id)
    expect(p.players.map((pl) => pl.id)).not.toContain(zelda.id)
    expect(p.guests.map((g) => [g.id, g.name])).toEqual([[zelda.id, 'Zelda']])
    expect(p.codeOf(zelda.id)).not.toBe(code)
    expect(p.log.at(-1)).toMatchObject({ kind: 'player.freed', actor: 'host', data: { player_id: zelda.id } })
    expect(p.pings.at(-1)).toBe('room')
    expect(p.game('g').views).not.toHaveProperty(zelda.id)
    expect(p.game('g').scores).toEqual({})
    expect(p.infoOf('g')!.scoreboard).not.toHaveProperty(zelda.id)
    expect(p.answersOf('g', zelda.id)).toEqual({})
    expect(p.feed).toEqual([])
    expect(p.infoOf('g')!.guests).toContainEqual({ id: zelda.id, name: 'Zelda', joined: false })
  })

  it('gives a guest still expected no view, score, points, badge or toast, even when a game aims at them', () => {
    const p = simulateParty({ games: [new Aims()], players: 2 })
    const zelda = p.listGuest('Zelda')
    p.addGame('g', 'aims', 'Aims', { target: zelda.id })
    expect(p.send(p.hostUser, { type: 'start', gameId: 'g' })).toMatchObject({ kind: 'commit' })
    expect(p.game('g').publicState).toEqual({ target: 'Zelda' })
    const ana = p.players[0]
    // Every effect is dropped, so the aim changes nothing: no save at all.
    expect(p.send(p.userOf(ana.id), { type: 'action', gameId: 'g', action: { type: 'aim' } })).toMatchObject({ kind: 'skip' })
    expect(p.game('g').views).not.toHaveProperty(zelda.id)
    expect(p.game('g').scores).toEqual({})
    expect(p.infoOf('g')!.scoreboard).not.toHaveProperty(zelda.id)
    expect(p.feed).toEqual([])
    expect(p.stateOf('g')!.members).not.toContain(zelda.id)

    // Once she joins, the same aim reaches her.
    p.claimGuest(zelda.id)
    p.send(p.userOf(ana.id), { type: 'action', gameId: 'g', action: { type: 'aim' } })
    expect(p.game('g').views[zelda.id]).toEqual({ me: true })
    expect(p.game('g').scores).toEqual({ [zelda.id]: 7 })
    expect(p.feed.map((f) => f.audience)).toEqual([[zelda.id]])
  })

  it("lets a 'guests' answer name a guest still expected, and refuses that in a 'players' answer", () => {
    const p = simulateParty({ games: [new Aims()], players: 2 })
    const zelda = p.listGuest('Zelda')
    p.addGame('g', 'aims', 'Aims', { target: zelda.id })
    p.send(p.hostUser, { type: 'start', gameId: 'g' })
    const [ana, bo] = p.players
    const invalid = (fn: () => unknown) => {
      try {
        fn()
      } catch (error) {
        return (error as FakeDbError).code
      }
      return 'accepted'
    }
    expect(invalid(() => p.submit('g', 'who', ana.id, { choice: [zelda.id] }))).toBe('answer_invalid')
    expect(invalid(() => p.submit('g', 'who', ana.id, { choice: [bo.id] }))).toBe('accepted')
    expect(invalid(() => p.submit('g', 'anyone', ana.id, { choice: [zelda.id] }))).toBe('accepted')
    expect(invalid(() => p.submit('g', 'anyone', bo.id, { choice: [bo.id] }))).toBe('answer_invalid')
    // Nobody can answer as a guest still expected.
    expect(invalid(() => p.submit('g', 'anyone', zelda.id, { choice: [ana.id] }))).toBe('not_player')
  })

  it('runs leave, then join, for a name freed and taken again with no save in between', () => {
    const p = party(2)
    const zelda = p.listGuest('Zelda')
    p.claimGuest(zelda.id)
    p.send(p.hostUser, { type: 'start', gameId: 'g' })
    p.tick(1000)
    p.freeGuest(zelda.id)
    p.claimGuest(zelda.id)
    p.sync('g')
    const stored = p.stateOf('g')!
    expect((stored.state as ProbeState).left).toEqual([zelda.id])
    expect((stored.state as ProbeState).joined).toEqual([zelda.id])
    expect(stored.members).toContain(zelda.id)
    expect(p.log.filter((row) => row.kind === 'game.effects').at(-1)!.data.members).toEqual({ joined: [zelda.id], left: [zelda.id] })
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

describe('seeds and reloads', () => {
  /** A probe round played to its end, as a list of everything the room and the phones saw. */
  function play(seed: number | undefined, reloadEvery: number) {
    class Dealer extends ProbeGame {
      readonly type = 'dealer'
      setup(ctx: GameContext<{ movesToWin: number; seconds: number }>): ProbeState {
        return { ...super.setup(ctx), step: Math.floor(ctx.random() * 1e9) }
      }
    }
    const p = simulateParty({ games: [new Dealer()], players: 3, seed })
    p.addGame('g', 'dealer', 'Dealer', { movesToWin: 6, seconds: 10 })
    const seen: unknown[] = []
    p.send(p.hostUser, { type: 'start', gameId: 'g' })
    for (let i = 0; i < 6; i++) {
      if (reloadEvery > 0 && i % reloadEvery === 0) p.reload()
      const player = p.players[i % 3]
      p.send(p.userOf(player.id), { type: 'action', gameId: 'g', action: { type: 'move' } })
      seen.push(p.game('g'))
    }
    return seen
  }

  it('gives the same party for the same seed, and another for another seed', () => {
    expect(play(11, 0)).toEqual(play(11, 0))
    expect((play(11, 0)[0] as { publicState: ProbePublicState }).publicState.step).not.toBe(
      (play(12, 0)[0] as { publicState: ProbePublicState }).publicState.step,
    )
    // The default is the seed every test had before seeds.
    expect(play(undefined, 0)).toEqual(play(7, 0))
  })

  it('plays on from every table reloaded from JSON as if nothing happened', () => {
    expect(play(5, 1)).toEqual(play(5, 0))
    const p = party()
    p.send(p.hostUser, { type: 'start', gameId: 'g' })
    p.send(p.hostUser, { type: 'host-action', gameId: 'g', action: { type: 'ask', step: 0 } })
    p.submit('g', 'q1', p.players[0].id, { choice: ['yes'] })
    p.reload()
    // Still the one answer, still open, and the reveal finds it.
    expect(() => p.submit('g', 'q1', p.players[0].id, { choice: ['no'] })).toThrow(FakeDbError)
    p.tick(10_000)
    p.sync('g')
    expect(p.game('g').publicState).toMatchObject({ question: null, results: [{ key: 'q1', yes: 1, no: 0 }] })
  })
})
