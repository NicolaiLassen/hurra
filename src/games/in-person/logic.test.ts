import { UsersThreeIcon } from '@phosphor-icons/react'
import { describe, expect, it } from 'vitest'
import { createGameContext } from '../core/context'
import { botExample, checkGameContract } from '../core/contract'
import { GameError, type AnyGame, type PlayerId, type RecapRound } from '../core/Game'
import { simulateParty } from '../core/simulate'
import { jsonbRoundTrip, testInfo } from '../core/testing'
import { bot } from './bot'
import { inPerson } from './index'
import { InPersonGame } from './logic'

const game = new InPersonGame()
/** The same game as the engine sees it: every hook with its full signature. */
const engineSide: AnyGame = game
type Round = RecapRound<Record<string, never>, Record<string, never>>

/** A party with an in-person round ready to start, its first four guests, and Start and End as the host sends them. */
function party(players = 4) {
  const p = simulateParty({ games: [game], players })
  p.addGame('pong', 'in-person', 'Beer pong')
  const [ana, bo, cy, dee] = p.players.map((player) => player.id)
  const start = (gameId = 'pong', stage?: boolean) =>
    p.send(p.hostUser, { type: 'start', gameId, ...(stage === undefined ? {} : { stage }) })
  const end = (gameId = 'pong') => p.send(p.hostUser, { type: 'end', gameId })
  return { party: p, ana, bo, cy, dee, start, end }
}

describe('the round', () => {
  it('takes the TV by default, and its settings are always empty', () => {
    expect(game.presentation).toBe('stage')
    expect(game.parseConfig()).toEqual({})
    const { party: p, start } = party()
    p.setSettings('pong', { secret: 'ignored' })
    const started = start()
    if (started.kind !== 'commit') throw new Error(`The start was a ${started.kind}`)
    expect(started.commit.stage).toBe('take')
    expect(started.commit.config).toEqual({})
    expect(p.stateOf('pong')?.config).toEqual({})
    expect(p.spotlight).toBe('pong')
  })

  it('can start in the background, beside the game on the TV', () => {
    const { party: p, start } = party()
    p.addGame('quiz', 'in-person', 'Stage game')
    start('quiz')
    expect(start('pong', false)).toMatchObject({ kind: 'commit', commit: { stage: 'keep' } })
    expect(p.spotlight).toBe('quiz')
    expect(p.game('pong').status).toBe('active')
  })

  it('refuses moves from phones and host controls: the host scores it by hand', () => {
    expect(() => engineSide.parseAction({ type: 'score' })).toThrow(GameError)
    const { party: p, ana, start } = party()
    start()
    expect(p.send(p.userOf(ana), { type: 'action', gameId: 'pong', action: {} })).toEqual({
      kind: 'refuse',
      status: 400,
      code: 'rule',
      message: 'The host scores this round',
    })
    expect(p.send(p.hostUser, { type: 'host-action', gameId: 'pong', action: { type: 'next' } })).toMatchObject({
      kind: 'refuse',
      code: 'bad_request',
    })
  })

  it('never finishes by itself, has no timer and keeps nothing secret', () => {
    const { party: p, ana, start } = party()
    start()
    p.award(ana, 10, 'pong')
    p.tick(3_600_000)
    expect(p.sync('pong')).toEqual({ kind: 'skip' })
    const live = p.game('pong')
    expect(live).toMatchObject({ status: 'active', wakeAt: null })
    expect(live.publicState).toEqual({})
    expect(live.scores).toEqual({})
    expect(Object.values(live.views)).toEqual([{}, {}, {}, {}])
    const { ctx } = createGameContext(testInfo({}, ['ana']))
    expect(engineSide.setup(ctx)).toEqual({})
    expect(engineSide.playerView({}, 'ana', testInfo({}, ['ana']))).toEqual({})
  })
})

describe('the contract', () => {
  it('holds over a round with a move, a host action, a join, a leave and End', () => {
    const problems = checkGameContract(game, {
      config: {},
      players: 4,
      steps: [
        { kind: 'action', player: 0, action: { type: 'score' } },
        { kind: 'host', action: { type: 'next' } },
        { kind: 'tick', ms: 60_000 },
        { kind: 'sync' },
        { kind: 'join' },
        { kind: 'action', player: 4, action: {} },
        { kind: 'leave', player: 1 },
        { kind: 'tick', ms: 60_000 },
        { kind: 'end' },
      ],
    })
    expect(problems).toEqual([])
  })

  it('holds over a round its bot plays, and the bot never moves', () => {
    const result = botExample(game, bot)
    if (!('example' in result)) throw new Error(result.refused)
    const moves = result.example.steps.filter((s) => s.kind === 'action' || s.kind === 'answer' || s.kind === 'host')
    expect(moves).toEqual([])
    expect(result.example.steps.at(-1)).toEqual({ kind: 'end' })
    expect(checkGameContract(game, result.example)).toEqual([])
    expect(bot.hostMove).toBeUndefined()
  })
})

describe('the winners after End', () => {
  it("crowns the top of the round's awards", () => {
    const { party: p, ana, bo, cy, start, end } = party()
    p.addGame('other', 'in-person', 'Darts')
    start()
    p.award(ana, 3, 'pong')
    p.award(bo, 5, 'pong')
    p.award(ana, 1, 'pong')
    // Points for another game, or for no game, don't decide this round.
    p.award(cy, 9)
    p.award(cy, 9, 'other')
    expect(end()).toMatchObject({ kind: 'commit', commit: { status: 'finished', finished_by: 'host' } })
    expect(p.game('pong')).toMatchObject({ status: 'finished', finishedBy: 'host', winners: [bo] })
  })

  it('crowns every player tied at the top', () => {
    const { party: p, ana, bo, cy, start, end } = party()
    start()
    p.award(ana, 4, 'pong')
    p.award(bo, 4, 'pong')
    p.award(cy, 2, 'pong')
    end()
    expect(p.game('pong').winners.sort()).toEqual([ana, bo].sort())
  })

  it('crowns nobody when no points were given, or only penalties', () => {
    const empty = party()
    empty.start()
    empty.end()
    expect(empty.party.game('pong').winners).toEqual([])

    const penalties = party()
    penalties.start()
    penalties.party.award(penalties.ana, -2, 'pong')
    penalties.end()
    expect(penalties.party.game('pong').winners).toEqual([])
  })

  it('starts the points over on a restart: the last round does not count', () => {
    const { party: p, ana, bo, start, end } = party()
    start()
    p.award(ana, 5, 'pong')
    end()
    expect(p.game('pong').winners).toEqual([ana])
    p.tick(60_000)
    start()
    p.award(bo, 1, 'pong')
    end()
    expect(p.game('pong')).toMatchObject({ round: 2, winners: [bo] })
  })

  it('runs several rounds at once, each crowning its own top scorer', () => {
    const { party: p, ana, bo, start, end } = party()
    p.addGame('darts', 'in-person', 'Darts')
    start('pong')
    start('darts', false)
    p.award(ana, 3, 'pong')
    p.award(bo, 2, 'darts')
    end('darts')
    // Darts finished off the stage: beer pong keeps the TV.
    expect(p.spotlight).toBe('pong')
    end('pong')
    expect(p.game('pong').winners).toEqual([ana])
    expect(p.game('darts').winners).toEqual([bo])
  })

  it('skips a top scorer the host removed before the end', () => {
    const { party: p, ana, bo, start, end } = party()
    start()
    p.award(ana, 9, 'pong')
    p.award(bo, 2, 'pong')
    p.removePlayer(ana)
    p.sync('pong')
    end()
    expect(p.game('pong').winners).toEqual([bo])
  })
})

describe('recap', () => {
  const players = [
    { id: 'ana', name: 'Ana' },
    { id: 'bo', name: 'Bo' },
    { id: 'cy', name: 'Cy' },
    { id: 'dee', name: 'Dee' },
    { id: 'eve', name: 'Eve' },
  ]
  const round = (overrides: Partial<Round> = {}): Round => ({
    gameId: 'pong',
    title: 'Beer pong',
    round: 1,
    finished: true,
    startedAt: 1_000,
    finishedAt: 600_000,
    finishedBy: 'host',
    config: {},
    state: {},
    winners: [],
    players,
    points: {},
    log: [],
    ...overrides,
  })

  it('names the top scorer of a finished round', () => {
    expect(game.recap(round({ points: { ana: 3, bo: 7, cy: 1 }, winners: ['bo'] }))).toEqual([
      {
        title: 'Top scorer in Beer pong: Bo',
        detail: '7 points',
        players: ['bo'],
        icon: 'trophy',
        tone: 'gold',
        weight: 'headline',
      },
    ])
    expect(game.recap(round({ points: { cy: 1 } }))[0]).toMatchObject({
      title: 'Top scorer in Beer pong: Cy',
      detail: '1 point',
    })
  })

  it('names every tied top scorer, and each one gets the moment', () => {
    expect(game.recap(round({ points: { ana: 4, bo: 2, cy: 4 } }))[0]).toMatchObject({
      title: 'Top scorers in Beer pong: Ana and Cy',
      detail: '4 points each',
      players: ['ana', 'cy'],
    })
    const all = Object.fromEntries(players.map((p) => [p.id, 2]))
    expect(game.recap(round({ points: all }))[0]).toMatchObject({
      title: 'Top scorers in Beer pong: Ana, Bo, Cy and 2 more',
      players: ['ana', 'bo', 'cy', 'dee', 'eve'],
    })
  })

  it('says nothing about a round still running, even with points', () => {
    expect(game.recap(round({ finished: false, finishedAt: null, finishedBy: null, points: { ana: 5 } }))).toEqual([])
  })

  it('says nothing when nobody scored, or only lost points', () => {
    expect(game.recap(round())).toEqual([])
    expect(game.recap(round({ points: { ana: 0, bo: -3 } }))).toEqual([])
  })

  it('names a top scorer who left the party by the name they had', () => {
    const left = round({ points: { gone: 6, ana: 2 }, players: [...players, { id: 'gone', name: 'Mads' }] })
    expect(game.recap(left)[0]).toMatchObject({ title: 'Top scorer in Beer pong: Mads', players: ['gone'] })
  })

  it('agrees with the winners a played round crowned, and survives a jsonb round trip', () => {
    const { party: p, ana, bo, cy, start, end } = party()
    start()
    p.award(ana, 2, 'pong')
    p.award(cy, 6, 'pong')
    p.award(bo, 6, 'pong')
    p.tick(120_000)
    end()
    const [played] = p.recapRounds('pong') as Round[]
    expect(played.finished).toBe(true)
    const highlights = game.recap(played)
    const crowned = p.game('pong').winners
    expect([...highlights[0].players!].sort()).toEqual([...crowned].sort())
    expect(highlights[0].detail).toBe('6 points each')
    expect(jsonbRoundTrip(highlights)).toEqual(highlights)
  })

  it('reads players by id, whatever order the points come in', () => {
    const points: Record<PlayerId, number> = jsonbRoundTrip({ eve: 1, dee: 5, ana: 5 })
    expect(game.recap(round({ points }))[0]).toMatchObject({ title: 'Top scorers in Beer pong: Ana and Dee' })
  })
})

describe('the module', () => {
  it('pairs the logic with its screens, and leaves the TV stage and final screen to the core', () => {
    expect(inPerson.logic).toBeInstanceOf(InPersonGame)
    expect(inPerson.icon).toBe(UsersThreeIcon)
    expect(inPerson.PlayerCard).toBeDefined()
    expect(inPerson.ResultView).toBeDefined()
    expect(inPerson.TvStatus).toBeDefined()
    expect(inPerson.HostView).toBeDefined()
    expect(inPerson.TvView).toBeUndefined()
    expect(inPerson.FinalTvView).toBeUndefined()
    expect(inPerson.acceptsScans).toBeUndefined()
  })
})
