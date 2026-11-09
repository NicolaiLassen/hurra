import { describe, expect, it } from 'vitest'
import { botExample, checkGameContract, type ContractExample } from '../core/contract'
import { createGameContext } from '../core/context'
import { GameError, type AnyGame, type GamePlayer, type PlayerId, type Prompt, type RecapRound } from '../core/Game'
import { canonicalJson } from '../core/runtime'
import { simulateParty, type FakeParty } from '../core/simulate'
import { answersOf, jsonbRoundTrip, seededRandom, testInfo } from '../core/testing'
import { bot } from './bot'
import {
  FusionGame,
  listNames,
  pictureKey,
  pointsFor,
  VOTE_SPEC,
  type FusionConfig,
  type FusionPlayerView,
  type FusionPublicState,
  type FusionState,
} from './logic'

const game = new FusionGame()
const GAME = 'fusion-1'

const config = (overrides: Partial<FusionConfig> = {}): FusionConfig => ({
  pictures: [
    { label: '#1', people: ['ana', 'bo'] },
    { label: '#2', people: ['cy', 'dee'] },
    { label: 'The viking' },
  ],
  pointsPerPerson: 1,
  bonusForBoth: 0,
  ...overrides,
})
const PLAYERS = ['ana', 'bo', 'cy', 'dee', 'eve', 'fin']

/** Runs a hook with a fresh context; returns the new state and what it did. */
function run<T>(
  hook: (ctx: ReturnType<typeof createGameContext<FusionConfig>>['ctx']) => T,
  overrides: Parameters<typeof testInfo<FusionConfig>>[2] = {},
  cfg = config(),
  players = PLAYERS,
) {
  const info = testInfo(cfg, players, overrides)
  const { ctx, effects } = createGameContext(info, seededRandom())
  return { result: hook(ctx), effects, info }
}

const start = (cfg = config(), players = PLAYERS) => run((ctx) => game.setup(ctx), {}, cfg, players)

/** The round's prompts, as game_load hands them to every request after the start. */
const promptsOf = (cfg: FusionConfig): Record<string, Prompt> =>
  Object.fromEntries(
    cfg.pictures.map((_, i) => [
      pictureKey(i + 1),
      { key: pictureKey(i + 1), spec: VOTE_SPEC, openedAt: 1_000, closesAt: null, closedAt: null, revealedAt: null },
    ]),
  )

const host = (state: FusionState, action: unknown, overrides: Parameters<typeof testInfo<FusionConfig>>[2] = {}, cfg = config()) =>
  run((ctx) => game.handleHostAction(state, game.parseHostAction(action), ctx), { prompts: promptsOf(cfg), ...overrides }, cfg)

/** The state after the lock, with these final votes per picture number (answers as info.answers has them). */
function locked(votes: Record<number, [PlayerId, [PlayerId, PlayerId]][]> = {}, cfg = config()) {
  const state = host(start(cfg).result, { type: 'lock' }, {}, cfg).result
  const answers = Object.fromEntries(
    cfg.pictures.map((_, i) => [
      pictureKey(i + 1),
      answersOf(
        1_000,
        (votes[i + 1] ?? []).map(([voter, choice], j) => [voter, { choice: [...choice].sort() }, 100 * (j + 1)]),
      ),
    ]),
  )
  return { state, answers }
}

describe('settings', () => {
  const parse = (input: Record<string, unknown>) => game.parseConfig({ ...game.defaultConfig, ...input })

  it('fills blank labels with the picture number and keeps images and people', () => {
    const parsed = parse({
      pictures: [{ label: '  ' }, { label: ' Viking ', image: 's/g/abc-1.jpg', people: ['a', 'b'] }, {}],
      pointsPerPerson: 2,
      bonusForBoth: 1,
    })
    expect(parsed).toEqual({
      pictures: [{ label: '#1' }, { label: 'Viking', image: 's/g/abc-1.jpg', people: ['a', 'b'] }, { label: '#3' }],
      pointsPerPerson: 2,
      bonusForBoth: 1,
    })
  })

  it('treats cleared people and images as none', () => {
    expect(parse({ pictures: [{ label: '', image: '', people: ['', ''] }, { people: [] }, { people: null }] }).pictures).toEqual([
      { label: '#1' },
      { label: '#2' },
      { label: '#3' },
    ])
  })

  it.each([
    [{ pictures: [] }, 'Add the pictures in the settings first'],
    [{ pictures: 'x' }, 'Add the pictures in the settings first'],
    [{ pictures: Array.from({ length: 41 }, () => ({})) }, 'at most 40 pictures'],
    [{ pictures: [{ label: 'x'.repeat(21) }] }, 'labels are at most 20 characters'],
    [{ pictures: [{ label: 7 }] }, "label that isn't text"],
    [{ pictures: [null] }, "isn't valid"],
    [{ pictures: [{ people: ['a'] }] }, 'pick the second person'],
    [{ pictures: [{ people: ['a', ''] }] }, 'pick the second person'],
    [{ pictures: [{ people: ['a', 'a'] }] }, 'pick two different people'],
    [{ pictures: [{ people: ['a', 'b', 'c'] }] }, 'pick two people, or nobody'],
    [{ pictures: [{ people: [1, 2] }] }, 'pick two people, or nobody'],
    [{ pictures: [{ image: '../secret.jpg' }] }, "that image isn't valid"],
    [{ pictures: [{ image: 'https://example.com/x.jpg' }] }, "that image isn't valid"],
    [{ pictures: [{ image: 's/g/x.png' }] }, "that image isn't valid"],
    [{ pictures: [{}], pointsPerPerson: 1.5 }, 'Points per right person must be a whole number from 0 to 10'],
    [{ pictures: [{}], pointsPerPerson: 11 }, 'Points per right person must be a whole number from 0 to 10'],
    [{ pictures: [{}], bonusForBoth: -1 }, 'The bonus for both must be a whole number from 0 to 10'],
    [{ pictures: [{}], bonusForBoth: null }, 'The bonus for both must be a whole number from 0 to 10'],
  ])('refuses %j', (input, message) => {
    expect(() => parse(input)).toThrow(GameError)
    expect(() => parse(input)).toThrow(message)
  })

  it('counts label length in code points, as Postgres does', () => {
    expect(parse({ pictures: [{ label: '\u{1F600}'.repeat(20) }] }).pictures[0].label).toHaveLength(40)
  })

  it('ships default settings that survive a jsonb round trip', () => {
    expect(jsonbRoundTrip(game.defaultConfig)).toEqual({ pictures: [], pointsPerPerson: 1, bonusForBoth: 0 })
  })
})

describe('setup', () => {
  it('opens one changeable vote per picture, with no deadline and no answer in the spec', () => {
    const { result: state, effects } = start()
    expect(effects.prompts.open).toEqual([
      { key: 'p1', spec: VOTE_SPEC },
      { key: 'p2', spec: VOTE_SPEC },
      { key: 'p3', spec: VOTE_SPEC },
    ])
    expect(VOTE_SPEC).toEqual({ kind: 'choice', options: 'players', min: 2, max: 2, exclude_self: true })
    expect(state).toMatchObject({ phase: 'voting', key: { 1: ['ana', 'bo'], 2: ['cy', 'dee'] }, revealed: [] })
    expect(effects.announcements).toEqual([
      expect.objectContaining({ message: 'Who is fused?', detail: '3 pictures on the wall. Vote on your phone.', sound: 'chime' }),
    ])
  })

  it('keeps the names of the people in the key', () => {
    expect(start().result.names).toEqual({ ana: 'ana', bo: 'bo', cy: 'cy', dee: 'dee' })
  })

  it('refuses a preset key with someone who is no longer in the party', () => {
    expect(() => start(config(), ['ana', 'cy', 'dee', 'eve'])).toThrow("#1 has someone who isn't in the party")
  })

  it('takes no moves from phones: votes are prompts', () => {
    expect(() => (game as AnyGame).parseAction({ type: 'vote' })).toThrow(GameError)
  })
})

describe('setKey', () => {
  it('sets or changes who is in a picture, kept secret from the room', () => {
    const { result: state, effects } = host(start().result, { type: 'setKey', n: 3, people: ['eve', 'fin'] })
    expect(state.key[3]).toEqual(['eve', 'fin'])
    expect(state.names).toMatchObject({ eve: 'eve', fin: 'fin' })
    expect(effects.announcements).toEqual([])
    const changed = host(state, { type: 'setKey', n: 1, people: ['cy', 'fin'] }).result
    expect(changed.key[1]).toEqual(['cy', 'fin'])
    expect(changed.names).not.toHaveProperty('ana')
  })

  it('changes nothing when the same two are set again, in either order', () => {
    const state = start().result
    expect(host(state, { type: 'setKey', n: 1, people: ['bo', 'ana'] }).result).toBe(state)
  })

  it('works after the lock, until that picture is revealed', () => {
    const { state, answers } = locked()
    const keyed = host(state, { type: 'setKey', n: 3, people: ['eve', 'fin'] }).result
    expect(keyed.key[3]).toEqual(['eve', 'fin'])
    const revealed = host(keyed, { type: 'reveal', n: 3 }, { answers }).result
    expect(() => host(revealed, { type: 'setKey', n: 3, people: ['ana', 'bo'] })).toThrow('The viking is already revealed')
  })

  it.each([
    [{ type: 'setKey', n: 4, people: ['ana', 'bo'] }, 'There is no picture #4'],
    [{ type: 'setKey', n: 1, people: ['ana', 'ana'] }, 'Pick two different people'],
    [{ type: 'setKey', n: 1, people: ['ana', 'zed'] }, 'Pick two people who are in the party'],
    [{ type: 'setKey', n: 1, people: ['ana'] }, 'Pick the two people in the picture'],
    [{ type: 'setKey', n: 0, people: ['ana', 'bo'] }, 'There is no such picture'],
    [{ type: 'setKey', n: '1', people: ['ana', 'bo'] }, 'There is no such picture'],
  ])('refuses %j', (action, message) => {
    expect(() => host(start().result, action)).toThrow(message)
  })
})

describe('lock', () => {
  it('closes every picture and moves to the reveal', () => {
    const { result: state, effects } = host(start().result, { type: 'lock' })
    expect(state.phase).toBe('locked')
    expect(effects.prompts.close).toEqual(['p1', 'p2', 'p3'])
    expect(effects.announcements).toEqual([expect.objectContaining({ message: 'Voting is closed', sound: 'drumroll' })])
  })

  it('does nothing a second time (a double tap)', () => {
    const { state } = locked()
    const second = host(state, { type: 'lock' })
    expect(second.result).toBe(state)
    expect(second.effects.prompts.close).toEqual([])
  })
})

describe('reveal', () => {
  it('is refused before the lock', () => {
    expect(() => host(start().result, { type: 'reveal', n: 1 })).toThrow('Lock voting first')
  })

  it('needs the key first', () => {
    const { state, answers } = locked()
    expect(() => host(state, { type: 'reveal', n: 3 }, { answers })).toThrow('Set who is in The viking first')
  })

  it('scores a point per right person, and nothing for the people in the picture', () => {
    const { state, answers } = locked({
      1: [
        ['cy', ['ana', 'bo']], // both
        ['dee', ['ana', 'eve']], // one
        ['eve', ['cy', 'dee']], // none
        ['ana', ['bo', 'cy']], // in the picture: doesn't count
      ],
    })
    const { result, effects } = host(state, { type: 'reveal', n: 1 }, { answers, now: 5_000 })
    expect(result.results[1]).toEqual({ both: 1, one: 1, none: 1, voters: 3, hits: { cy: 2, dee: 1, eve: 0 } })
    expect(result.totals).toEqual({ cy: 2, dee: 1 })
    expect(result.revealed).toEqual([1])
    expect(result.lastReveal).toEqual({ n: 1, at: 5_000 })
    expect(effects.prompts.reveal).toEqual(['p1'])
    expect(effects.announcements).toEqual([
      expect.objectContaining({ message: '#1 was ana and bo!', detail: '1 of 3 got both', icon: 'detective', sound: 'gotcha' }),
    ])
    expect(effects.records).toEqual([
      { type: 'revealed', data: { n: 1, label: '#1', people: ['ana', 'bo'], both: 1, one: 1, none: 1, voters: 3 }, about: ['ana', 'bo'] },
    ])
  })

  it('adds the bonus for getting both, and points per person as configured', () => {
    const cfg = config({ pointsPerPerson: 2, bonusForBoth: 3 })
    const { state, answers } = locked({ 1: [['cy', ['ana', 'bo']], ['dee', ['bo', 'eve']]] }, cfg)
    const { result } = host(state, { type: 'reveal', n: 1 }, { answers }, cfg)
    expect(result.totals).toEqual({ cy: 7, dee: 2 })
    expect(pointsFor(2, { perPerson: 2, bothBonus: 3 })).toBe(7)
    expect(pointsFor(1, { perPerson: 2, bothBonus: 3 })).toBe(2)
    expect(pointsFor(0, { perPerson: 2, bothBonus: 3 })).toBe(0)
  })

  it('does nothing for a picture that is out already (a double tap)', () => {
    const { state, answers } = locked({ 1: [['cy', ['ana', 'bo']]] })
    const once = host(state, { type: 'reveal', n: 1 }, { answers }).result
    const twice = host(once, { type: 'reveal', n: 1 }, { answers: {} })
    expect(twice.result).toBe(once)
    expect(twice.effects.announcements).toEqual([])
  })

  it('says so when nobody voted', () => {
    const { state, answers } = locked()
    const { effects } = host(state, { type: 'reveal', n: 2 }, { answers })
    expect(effects.announcements[0]).toMatchObject({ message: '#2 was cy and dee!', detail: 'Nobody voted on this one' })
  })

  it('refuses while the votes are still open', () => {
    const { state } = locked()
    expect(() => host(state, { type: 'reveal', n: 1 }, { answers: {} })).toThrow('The votes for #1 are still open')
  })

  it('still names someone in the picture who has left the party', () => {
    const { state, answers } = locked({ 1: [['cy', ['ana', 'bo']]] })
    const { effects, result } = host(state, { type: 'reveal', n: 1 }, {
      answers,
      players: ['bo', 'cy', 'dee', 'eve', 'fin'].map((id) => ({ id, name: id.toUpperCase(), profile: {} })),
    })
    expect(effects.announcements[0].message).toBe('#1 was ana and BO!')
    const info = testInfo(config(), ['bo', 'cy'])
    expect(game.publicState(result, info).pictures[0].revealed?.names).toEqual(['ana', 'bo'])
  })
})

describe('finish', () => {
  it('is refused before the lock', () => {
    expect(() => host(start().result, { type: 'finish' })).toThrow('Lock voting first')
  })

  it('crowns the face detective, tells them, and gives them the badge', () => {
    const { state, answers } = locked({ 1: [['cy', ['ana', 'bo']], ['dee', ['ana', 'eve']]] })
    const revealed = host(state, { type: 'reveal', n: 1 }, { answers }).result
    const players = PLAYERS.map((id): GamePlayer => ({ id, name: id, profile: id === 'cy' ? { fusion: { detective: 2 } } : {} }))
    const { result, effects } = host(revealed, { type: 'finish' }, { players })
    expect(result.phase).toBe('done')
    expect(game.isFinished(result)).toBe(true)
    expect(effects.announcements).toEqual([
      expect.objectContaining({ message: 'cy has the sharpest eye!', detail: '2 points', icon: 'crown', sound: 'fanfare', interrupt: true }),
      expect.objectContaining({ message: 'You have the sharpest eye!', to: ['cy'] }),
    ])
    expect(effects.profiles).toEqual({ cy: { detective: 3 } })
    expect(game.winners(result, testInfo(config(), PLAYERS))).toEqual(['cy'])
  })

  it('crowns everyone tied at the top', () => {
    const { state, answers } = locked({ 1: [['cy', ['ana', 'bo']], ['dee', ['ana', 'bo']]] })
    const revealed = host(state, { type: 'reveal', n: 1 }, { answers }).result
    const { effects } = host(revealed, { type: 'finish' })
    expect(effects.announcements[0].message).toBe('cy and dee have the sharpest eyes!')
    expect(effects.announcements[1]).toMatchObject({ message: 'You share the sharpest eye!', to: ['cy', 'dee'] })
    expect(game.winners(revealed, testInfo(config(), PLAYERS))).toEqual(['cy', 'dee'])
  })

  it('crowns nobody when nobody scored', () => {
    const { state, answers } = locked({ 1: [['cy', ['eve', 'fin']]] })
    const revealed = host(state, { type: 'reveal', n: 1 }, { answers }).result
    const { result, effects } = host(revealed, { type: 'finish' })
    expect(effects.announcements).toEqual([expect.objectContaining({ message: 'Participant fusion is over', detail: 'Nobody scored this time' })])
    expect(effects.profiles).toEqual({})
    expect(game.winners(result, testInfo(config(), PLAYERS))).toEqual([])
  })

  it('leaves players who left out of the crown', () => {
    const { state, answers } = locked({ 1: [['cy', ['ana', 'bo']], ['dee', ['ana', 'eve']]] })
    const revealed = host(state, { type: 'reveal', n: 1 }, { answers }).result
    expect(game.winners(revealed, testInfo(config(), ['ana', 'dee']))).toEqual(['dee'])
  })
})

describe('onEnd', () => {
  it('says it is over with the leader when the host ends it', () => {
    const { state, answers } = locked({ 1: [['cy', ['ana', 'bo']]] })
    const revealed = host(state, { type: 'reveal', n: 1 }, { answers }).result
    const { result, effects } = run((ctx) => game.onEnd(revealed, ctx, 'host'))
    expect(result.phase).toBe('done')
    expect(effects.announcements).toEqual([
      expect.objectContaining({ message: 'Participant fusion is over', detail: 'cy had the sharpest eye with 2 points', icon: 'trophy' }),
    ])
  })

  it('stays quiet when the game finished itself', () => {
    const { state } = locked()
    const done = host(state, { type: 'finish' }).result
    const { result, effects } = run((ctx) => game.onEnd(done, ctx, 'game'))
    expect(result).toBe(done)
    expect(effects.announcements).toEqual([])
  })
})

describe('what the room sees', () => {
  it('never shows who is in a picture before its reveal', () => {
    const { state, answers } = locked({ 1: [['cy', ['ana', 'bo']]] })
    const info = testInfo(config(), PLAYERS)
    const before = game.publicState(state, info)
    expect(before.pictures.map((p) => p.revealed)).toEqual([null, null, null])
    expect(JSON.stringify(before)).not.toMatch(/"(ana|bo|cy|dee)"/)
    const after = game.publicState(host(state, { type: 'reveal', n: 1 }, { answers }).result, info)
    expect(after.pictures[0].revealed).toEqual({ people: ['ana', 'bo'], names: ['ana', 'bo'], both: 1, one: 0, none: 0, voters: 1 })
    expect(after.pictures[1].revealed).toBeNull()
    expect(JSON.stringify(after.pictures.slice(1))).not.toMatch(/"(cy|dee)"/)
  })

  it('shows the pictures, the top five and the scoring', () => {
    const cfg = config({ pictures: [{ label: '#1', image: 's/g/a.jpg', people: ['ana', 'bo'] }, { label: '#2' }], bonusForBoth: 2 })
    const state = start(cfg).result
    const pub = game.publicState({ ...state, totals: { eve: 1, cy: 3, dee: 3, gone: 9 } }, testInfo(cfg, PLAYERS))
    expect(pub.pictures[0]).toEqual({ n: 1, key: 'p1', label: '#1', image: 's/g/a.jpg', revealed: null })
    expect(pub.pictures[1].image).toBeNull()
    expect(pub.top).toEqual([
      { playerId: 'cy', points: 3 },
      { playerId: 'dee', points: 3 },
      { playerId: 'eve', points: 1 },
    ])
    expect(pub.scoring).toEqual({ perPerson: 1, bothBonus: 2 })
  })

  it('gives each player their points and how they did on each revealed picture', () => {
    const { state, answers } = locked({ 1: [['cy', ['ana', 'bo']], ['eve', ['cy', 'dee']]] })
    const revealed = host(state, { type: 'reveal', n: 1 }, { answers }).result
    const info = testInfo(config(), PLAYERS)
    expect(game.playerView(revealed, 'cy')).toEqual<FusionPlayerView>({ points: 2, hits: { 1: 2 } })
    expect(game.playerView(revealed, 'eve')).toEqual({ points: 0, hits: { 1: 0 } })
    expect(game.playerView(revealed, 'ana')).toEqual({ points: 0, hits: {} })
    expect(game.playerView(revealed, 'stranger')).toEqual({ points: 0, hits: {} })
    expect(game.scores(revealed)).toEqual({ cy: 2 })
    expect(canonicalJson(game.publicState(jsonbRoundTrip(revealed), info))).toBe(canonicalJson(game.publicState(revealed, info)))
  })
})

describe('host actions from untrusted input', () => {
  it.each([null, 1, 'x', [], {}, { type: 'nope' }, { type: 'reveal' }, { type: 'reveal', n: 1.5 }, { type: 'setKey', n: 1, people: 'ab' }])(
    'refuses %j',
    (input) => {
      expect(() => game.parseHostAction(input)).toThrow(GameError)
    },
  )

  it('keeps only what it knows', () => {
    expect(game.parseHostAction({ type: 'lock', extra: 1 })).toEqual({ type: 'lock' })
    expect(game.parseHostAction({ type: 'reveal', n: 2, people: ['x'] })).toEqual({ type: 'reveal', n: 2 })
  })
})

describe('listNames', () => {
  it('lists names the way the room reads them', () => {
    expect(listNames([])).toBe('')
    expect(listNames(['Ana'])).toBe('Ana')
    expect(listNames(['Ana', 'Bo'])).toBe('Ana and Bo')
    expect(listNames(['Ana', 'Bo', 'Cy'])).toBe('Ana, Bo and Cy')
    expect(listNames(['Ana', 'Bo', 'Cy', 'Dee', 'Eve'])).toBe('Ana, Bo, Cy and 2 more')
  })
})

// Whole rounds through the in-memory party: the real step(), game_load and
// game_commit rules, and submit_answer's checks.

function party(players = 8) {
  const p = simulateParty({ games: [new FusionGame()], players })
  const ids = p.players.map((pl) => pl.id)
  return { p, ids }
}

function startParty(p: FakeParty, settings: Record<string, unknown>) {
  p.addGame(GAME, 'fusion', 'Who is fused?', settings)
  const started = p.send(p.hostUser, { type: 'start', gameId: GAME })
  expect(started.kind).toBe('commit')
  return started
}

const hostAct = (p: FakeParty, action: unknown, close?: string[]) =>
  p.send(p.hostUser, { type: 'host-action', gameId: GAME, action, close })
const vote = (p: FakeParty, n: number, voter: PlayerId, choice: PlayerId[]) =>
  p.submit(GAME, pictureKey(n), voter, { choice })
const pub = (p: FakeParty) => p.game(GAME).publicState as FusionPublicState
const stateOf = (p: FakeParty) => p.stateOf(GAME)!.state as FusionState
const recapOf = (p: FakeParty) => p.recapRounds(GAME)[0] as RecapRound<FusionState, FusionConfig>

describe('a round in the party', () => {
  it('runs in the background, takes votes until the lock, and reveals one picture at a time', () => {
    const { p, ids } = party()
    const [a, b, c, d, e, f, g, h] = ids
    startParty(p, { pictures: [{ people: [a, b] }, { people: [c, d] }], pointsPerPerson: 1, bonusForBoth: 1 })
    expect(p.spotlight).toBeNull() // a background game doesn't take the TV
    expect(p.promptsOf(GAME).map((x) => x.key)).toEqual(['p1', 'p2'])

    vote(p, 1, e, [a, b])
    vote(p, 1, f, [a, c])
    vote(p, 1, f, [a, b]) // changed: the last one counts
    vote(p, 1, g, [c, d])
    vote(p, 1, a, [b, c]) // in the picture
    vote(p, 2, e, [c, d])
    expect(() => p.submit(GAME, 'p1', h, { choice: [h, a] })).toThrow('That is not one of the options') // not yourself
    expect(() => p.submit(GAME, 'p1', h, { choice: [a] })).toThrow('Pick 2')
    expect(p.talliesOf(GAME)).toEqual({ p1: 4, p2: 1 })

    // Nobody sees the key while voting.
    expect(canonicalJson(pub(p))).not.toContain(a)

    expect(hostAct(p, { type: 'reveal', n: 1 })).toMatchObject({ kind: 'refuse', status: 400, message: 'Lock voting first' })
    expect(hostAct(p, { type: 'lock' }).kind).toBe('commit')
    expect(() => vote(p, 2, f, [c, d])).toThrow('Too late, answers are closed')
    expect(hostAct(p, { type: 'lock' }).kind).toBe('skip') // a double tap

    expect(hostAct(p, { type: 'reveal', n: 1 }, ['p1']).kind).toBe('commit')
    expect(hostAct(p, { type: 'reveal', n: 1 }, ['p1']).kind).toBe('skip') // a double tap on Reveal next
    const one = pub(p).pictures[0].revealed
    expect(one).toEqual({ people: [a, b], names: ['Guest 1', 'Guest 2'], both: 2, one: 0, none: 1, voters: 3 })
    expect(pub(p).pictures[1].revealed).toBeNull()
    expect(p.game(GAME).scores).toEqual({ [e]: 3, [f]: 3 })
    expect((p.game(GAME).views[e] as FusionPlayerView).hits).toEqual({ 1: 2 })
    expect((p.game(GAME).views[a] as FusionPlayerView).hits).toEqual({})
    expect(p.feed.at(-1)).toMatchObject({ message: '#1 was Guest 1 and Guest 2!', detail: '2 of 3 got both', interrupt: false })

    expect(hostAct(p, { type: 'reveal', n: 2 }, ['p2']).kind).toBe('commit')
    expect(p.game(GAME).scores).toEqual({ [e]: 6, [f]: 3 })

    expect(hostAct(p, { type: 'finish' }).kind).toBe('commit')
    const finished = p.game(GAME)
    expect(finished).toMatchObject({ status: 'finished', finishedBy: 'game', winners: [e] })
    expect(p.players.find((pl) => pl.id === e)?.profile).toEqual({ fusion: { detective: 1 } })
    expect(p.feed.filter((item) => item.interrupt).map((item) => item.message)).toEqual(['Guest 5 has the sharpest eye!'])
    // A finished game with the stage free takes it for its final screen.
    expect(p.spotlight).toBe(GAME)
  })

  it('sets the key on the night and still keeps it secret', () => {
    const { p, ids } = party(5)
    startParty(p, { pictures: [{}], pointsPerPerson: 1, bonusForBoth: 0 })
    expect(hostAct(p, { type: 'setKey', n: 1, people: [ids[0], ids[1]] }).kind).toBe('commit')
    expect(stateOf(p).key).toEqual({ 1: [ids[0], ids[1]] })
    expect(canonicalJson(pub(p))).not.toContain(ids[0])
    expect(canonicalJson(Object.values(p.game(GAME).views))).not.toContain(ids[1])
    expect(hostAct(p, { type: 'setKey', n: 1, people: [ids[1], ids[0]] }).kind).toBe('skip')
  })

  it('ends by the host before the lock: nobody wins, every vote closes', () => {
    const { p, ids } = party(4)
    startParty(p, { pictures: [{ people: [ids[0], ids[1]] }], pointsPerPerson: 1, bonusForBoth: 0 })
    vote(p, 1, ids[2], [ids[0], ids[1]])
    expect(p.send(p.hostUser, { type: 'end', gameId: GAME }).kind).toBe('commit')
    expect(p.game(GAME)).toMatchObject({ status: 'finished', finishedBy: 'host', winners: [] })
    expect(p.promptsOf(GAME)[0].closedAt).not.toBeNull()
    expect((pub(p)).phase).toBe('done')
    // Nothing was revealed, so nothing about the key reached the room.
    expect(canonicalJson(pub(p))).not.toContain(ids[0])
  })

  it('handles a guest who joins and one who leaves mid-round', () => {
    const { p, ids } = party(5)
    startParty(p, { pictures: [{ people: [ids[0], ids[1]] }, { people: [ids[2], ids[3]] }], pointsPerPerson: 1, bonusForBoth: 0 })
    const late = p.addPlayer('Late')
    p.sync(GAME)
    vote(p, 1, late.id, [ids[0], ids[1]]) // a late guest can vote
    vote(p, 1, ids[4], [ids[0], ids[1]])
    p.removePlayer(ids[4]) // their vote goes with them
    p.sync(GAME)
    p.removePlayer(ids[1]) // someone in picture 1 leaves; the print still shows them
    p.sync(GAME)
    hostAct(p, { type: 'lock' })
    expect(hostAct(p, { type: 'reveal', n: 1 }).kind).toBe('commit')
    expect(pub(p).pictures[0].revealed).toMatchObject({ people: [ids[0], ids[1]], names: ['Guest 1', 'Guest 2'], both: 1, voters: 1 })
    expect(p.game(GAME).scores).toEqual({ [late.id]: 2 })
  })

  it('keeps its contract over a hand-written round with a join and a leave', () => {
    const roster = simulateParty({ games: [game], players: 6 }).players.map((pl) => pl.id)
    const choice = (x: number, y: number) => ({ choice: [roster[x], roster[y]].sort() })
    const example: ContractExample = {
      config: { pictures: [{ people: [roster[0], roster[1]] }, { label: 'Viking' }, {}], pointsPerPerson: 1, bonusForBoth: 1 },
      players: 6,
      steps: [
        { kind: 'answer', player: 2, key: 'p1', answer: choice(0, 1) },
        { kind: 'answer', player: 3, key: 'p1', answer: choice(0, 4) },
        { kind: 'answer', player: 0, key: 'p1', answer: choice(1, 2) },
        { kind: 'join' },
        { kind: 'answer', player: 6, key: 'p2', answer: choice(2, 3) },
        { kind: 'host', action: { type: 'setKey', n: 2, people: [roster[2], roster[3]] } },
        { kind: 'host', action: { type: 'reveal', n: 1 } },
        { kind: 'host', action: { type: 'lock' } },
        { kind: 'leave', player: 3 },
        { kind: 'host', action: { type: 'reveal', n: 1 } },
        { kind: 'host', action: { type: 'reveal', n: 1 } },
        { kind: 'host', action: { type: 'reveal', n: 3 } },
        { kind: 'host', action: { type: 'reveal', n: 2 }, close: ['p2'] },
        { kind: 'tick', ms: 5_000 },
        { kind: 'sync' },
        { kind: 'host', action: { type: 'finish' } },
      ],
    }
    expect(checkGameContract(game, example)).toEqual([])
  })

  it('plays a whole round with its bot and keeps its contract', () => {
    const result = botExample(game, bot)
    if ('refused' in result) throw new Error(result.refused)
    const { steps } = result.example
    const hostSteps = steps.flatMap((s) => (s.kind === 'host' ? [(s.action as { type: string }).type] : []))
    // It locks, reveals all four and crowns the detective by itself: no End needed.
    expect(hostSteps).toEqual(['lock', 'reveal', 'reveal', 'reveal', 'reveal', 'finish'])
    expect(steps.some((s) => s.kind === 'end')).toBe(false)
    expect(steps.some((s) => s.kind === 'join') && steps.some((s) => s.kind === 'leave')).toBe(true)
    expect(checkGameContract(game, result.example)).toEqual([])
  })
})

describe('the bot', () => {
  it('makes four pictures from pairs of the first eight players', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `p${i}`)
    expect(bot.settings!(ids)).toEqual({
      pictures: [
        { label: '#1', people: ['p0', 'p1'] },
        { label: '#2', people: ['p2', 'p3'] },
        { label: '#3', people: ['p4', 'p5'] },
        { label: '#4', people: ['p6', 'p7'] },
      ],
      pointsPerPerson: 1,
      bonusForBoth: 1,
    })
    expect(game.parseConfig({ ...game.defaultConfig, ...bot.settings!(['a', 'b', 'c']) }).pictures).toHaveLength(4)
    expect(game.parseConfig({ ...game.defaultConfig, ...bot.settings!(['solo']) }).pictures[0]).toEqual({ label: '#1' })
  })

  it('crowns a face detective in a party of 45', () => {
    const p = simulateParty({ games: [new FusionGame()], players: 45 })
    const ids = p.players.map((pl) => pl.id)
    p.addGame(GAME, 'fusion', 'Who is fused?', bot.settings!(ids))
    p.send(p.hostUser, { type: 'start', gameId: GAME })
    const random = seededRandom(3)
    for (let second = 0; second < 120 && p.game(GAME).status === 'active'; second++) {
      for (const id of ids) {
        const move = bot.move({
          playerId: id,
          players: p.players.map((pl) => ({ id: pl.id, name: pl.name, code: p.codeOf(pl.id) })),
          publicState: p.game(GAME).publicState,
          view: p.game(GAME).views[id] ?? null,
          prompts: p.promptsOf(GAME),
          myAnswers: p.answersOf(GAME, id),
          now: p.now,
          random,
        })
        if (move?.kind === 'answer') p.submit(GAME, move.key, id, move.answer)
      }
      const stored = p.stateOf(GAME)!
      const hostMove = bot.hostMove!({
        players: p.players.map((pl) => ({ id: pl.id, name: pl.name, code: p.codeOf(pl.id) })),
        publicState: p.game(GAME).publicState,
        prompts: p.promptsOf(GAME),
        now: p.now,
        random,
        state: stored.state,
        config: stored.config,
        tallies: p.talliesOf(GAME),
      })
      if (hostMove) hostAct(p, hostMove.action, hostMove.close)
      p.tick(1000)
    }
    const final = p.game(GAME)
    expect(final.status).toBe('finished')
    expect(final.winners.length).toBeGreaterThan(0)
    expect(pub(p).pictures.every((x) => x.revealed !== null)).toBe(true)
    // Everyone voted on every picture before the lock (4 votes each, people in a picture don't count on it).
    expect(pub(p).pictures.map((x) => x.revealed!.voters)).toEqual([43, 43, 43, 43])
    expect(stateOf(p).phase).toBe('done')
  })
})

describe('recap', () => {
  function finishedRound(reveal: number[]) {
    const { p, ids } = party(8)
    const [a, b, c, d, e, f, g] = ids
    startParty(p, {
      pictures: [{ people: [a, b] }, { label: 'Viking', people: [c, d] }, { people: [e, f] }],
      pointsPerPerson: 1,
      bonusForBoth: 0,
    })
    for (const voter of [e, f, g]) vote(p, 1, voter, [a, b])
    vote(p, 2, e, [c, d])
    vote(p, 2, f, [a, g])
    vote(p, 2, g, [a, b])
    vote(p, 2, c, [d, e]) // in the picture: doesn't count
    hostAct(p, { type: 'lock' })
    for (const n of reveal) hostAct(p, { type: 'reveal', n })
    return { p, ids }
  }

  it('returns nothing while the round runs', () => {
    const { p } = finishedRound([1])
    const round = recapOf(p)
    expect(round.finished).toBe(false)
    expect(game.recap(round)).toEqual([])
  })

  it('names the sharpest eye, the best disguise and any perfect eye', () => {
    const { p, ids } = finishedRound([1, 2])
    hostAct(p, { type: 'finish' })
    const highlights = game.recap(recapOf(p))
    expect(highlights).toEqual([
      expect.objectContaining({ title: 'Sharpest eye: Guest 5', detail: '4 points', players: [ids[4]], weight: 'headline' }),
      expect.objectContaining({
        title: 'Best disguise: Viking fooled the room',
        detail: 'Only 1 of 3 saw Guest 3 and Guest 4',
        players: [ids[2], ids[3]],
        at: expect.any(Number),
      }),
      expect.objectContaining({ title: 'Perfect eye: Guest 5', players: [ids[4]] }),
    ])
  })

  it('never names the people of a picture the host did not reveal', () => {
    const { p, ids } = finishedRound([1])
    hostAct(p, { type: 'finish' })
    const highlights = game.recap(recapOf(p))
    expect(highlights.map((h) => h.title)).toEqual(['Sharpest eye: Guest 5, Guest 6 and Guest 7'])
    const text = JSON.stringify(highlights)
    for (const hidden of [ids[2], ids[3], 'Guest 3', 'Guest 4', 'Viking']) expect(text).not.toContain(hidden)
  })
})
