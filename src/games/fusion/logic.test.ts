import { describe, expect, it } from 'vitest'
import type { HostBotSight } from '../core/bot'
import { botExample, botSight, checkGameContract, hostBotSight, type ContractExample } from '../core/contract'
import { createGameContext } from '../core/context'
import { GameError, type AnyGame, type GamePlayer, type PlayerId, type Prompt, type RecapRound } from '../core/Game'
import { canonicalJson } from '../core/runtime'
import { simulateParty, type FakeParty } from '../core/simulate'
import { answersOf, jsonbRoundTrip, seededRandom, testInfo } from '../core/testing'
import { bot, BOT_PICTURES } from './bot'
import { FusionGame, guessNames, readState, type FusionConfig, type FusionState } from './logic'
import {
  GRACE_MS,
  LEGACY_MESSAGE,
  pictureKey,
  readPublic,
  readView,
  REVEAL_HOLD_MS,
  SUSPENSE_MS,
  voteSpec,
  WAKE_MARGIN_MS,
  type FusionPlayerView,
  type FusionPublicState,
} from './shapes'

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
  seconds: 30,
  ...overrides,
})
/** The test party: each guest's name is their id (testInfo), so a picture's names here are also these. */
const PLAYERS = ['ana', 'bo', 'cy', 'dee', 'eve', 'fin']
/** What a guess offers the test party: everyone here, and every name in the pictures (here all of them guests). */
const SPEC = voteSpec(['ana', 'bo', 'cy', 'dee', 'eve', 'fin'])
/** From the ask to the end of the countdown: the TV's suspense, then 30 s. */
const ASKED_MS = SUSPENSE_MS + 30_000
type Overrides = Parameters<typeof testInfo<FusionConfig>>[2]

/** Runs a hook with a fresh context; returns the new state and what it did. */
function run<T>(
  hook: (ctx: ReturnType<typeof createGameContext<FusionConfig>>['ctx']) => T,
  overrides: Overrides = {},
  cfg = config(),
  players = PLAYERS,
) {
  const info = testInfo(cfg, players, overrides)
  const { ctx, effects } = createGameContext(info, seededRandom())
  return { result: hook(ctx), effects, info }
}

const start = (cfg = config(), players = PLAYERS) => run((ctx) => game.setup(ctx), {}, cfg, players)
const host = (state: FusionState, action: unknown, overrides: Overrides = {}, cfg = config()) =>
  run((ctx) => game.handleHostAction(state, game.parseHostAction(action), ctx), overrides, cfg)
const wake = (state: FusionState, overrides: Overrides = {}, cfg = config()) => run((ctx) => game.onWake(state, ctx), overrides, cfg)

/** A prompt as game_load hands it over: open, or closed with its locks in info.answers. */
const prompt = (n: number, openedAt: number, closedAt: number | null = null): Prompt => ({
  key: pictureKey(n),
  spec: SPEC,
  openedAt,
  closesAt: openedAt + ASKED_MS + GRACE_MS,
  closedAt,
  revealedAt: null,
})

/** Picture n asked at `at` from a fresh lobby (or `from`). */
function asked(n: number, from: FusionState = start().result, at = 10_000, cfg = config()) {
  return host(from, { type: 'ask', n }, { now: at }, cfg).result
}

/** The info for a reveal of picture n asked at `openedAt`: its prompt closed, with these locks. */
function closedWith(n: number, openedAt: number, locks: [PlayerId, [string, string]][], now = openedAt + ASKED_MS + GRACE_MS + WAKE_MARGIN_MS): Overrides {
  return {
    now,
    prompts: { [pictureKey(n)]: prompt(n, openedAt, openedAt + ASKED_MS + GRACE_MS) },
    answers: {
      [pictureKey(n)]: answersOf(
        openedAt,
        locks.map(([voter, choice], i) => [voter, { choice: [...choice].sort() }, 100 * (i + 1)]),
      ),
    },
  }
}

/** Picture n asked at 10 s and revealed by Reveal now with these locks: each two names. */
function revealed(n: number, locks: [PlayerId, [string, string]][], from: FusionState = start().result, cfg = config()) {
  const state = asked(n, from, 10_000, cfg)
  return host(state, { type: 'reveal', n }, closedWith(n, 10_000, locks, 20_000), cfg)
}

const pub = (state: FusionState, players = PLAYERS, cfg = config()) => game.publicState(state, testInfo(cfg, players))
const view = (state: FusionState, id: PlayerId, players = PLAYERS, cfg = config()) => game.playerView(state, id, testInfo(cfg, players))

describe('settings', () => {
  const parse = (input: Record<string, unknown>) => game.parseConfig({ ...game.defaultConfig, ...input })

  it('ships the defaults: a point a person, no bonus and 30 s to guess; no showing', () => {
    expect(jsonbRoundTrip(game.defaultConfig)).toEqual({ pictures: [], pointsPerPerson: 1, bonusForBoth: 0, seconds: 30 })
    expect(game.presentation).toBe('stage')
  })

  it('fills blank labels with the picture number and keeps images, typed names (cleaned) and times', () => {
    const parsed = parse({
      pictures: [{ label: '  ' }, { label: ' Viking ', image: 's/g/abc-1.jpg', people: [' Ana  Maria ', 'Bo'] }, {}],
      pointsPerPerson: 2,
      bonusForBoth: 1,
      seconds: 45,
      // From settings saved while the round opened with a showing: no longer read.
      showSeconds: 3,
    })
    expect(parsed).toEqual({
      pictures: [{ label: '#1' }, { label: 'Viking', image: 's/g/abc-1.jpg', people: ['Ana Maria', 'Bo'] }, { label: '#3' }],
      pointsPerPerson: 2,
      bonusForBoth: 1,
      seconds: 45,
    })
  })

  it('starts settings saved before the times existed with the defaults, and ignores the old showing time', () => {
    // The engine merges defaultConfig under the saved settings.
    const old = { pictures: [{ label: '#1' }], pointsPerPerson: 1, bonusForBoth: 0, showSeconds: 99 }
    expect(game.parseConfig({ ...game.defaultConfig, ...old })).toEqual({ pictures: [{ label: '#1' }], pointsPerPerson: 1, bonusForBoth: 0, seconds: 30 })
  })

  it('treats cleared people and images as none', () => {
    expect(parse({ pictures: [{ label: '', image: '', people: ['', ''] }, { people: [] }, { people: null }] }).pictures).toEqual([
      { label: '#1' },
      { label: '#2' },
      { label: '#3' },
    ])
  })

  it("keeps each person's own photo in the order of the people, and treats cleared ones as none", () => {
    const parsed = parse({
      pictures: [
        { people: ['a', 'b'], originals: ['s/g/one.jpg', 's/g/two.jpg'] },
        { people: ['c', 'd'], originals: [null, 's/g/three.jpg'] },
        { originals: ['s/g/four.jpg'] },
        { originals: ['', null] },
        { originals: [] },
        { originals: null },
      ],
    }).pictures
    expect(parsed).toEqual([
      { label: '#1', people: ['a', 'b'], originals: ['s/g/one.jpg', 's/g/two.jpg'] },
      { label: '#2', people: ['c', 'd'], originals: [null, 's/g/three.jpg'] },
      { label: '#3', originals: ['s/g/four.jpg', null] },
      { label: '#4' },
      { label: '#5' },
      { label: '#6' },
    ])
  })

  it.each([
    [{ pictures: [] }, 'Add the pictures in the settings first'],
    [{ pictures: 'x' }, 'Add the pictures in the settings first'],
    [{ pictures: Array.from({ length: 41 }, () => ({})) }, 'at most 40 pictures'],
    [{ pictures: [{ label: 'x'.repeat(21) }] }, 'labels are at most 20 characters'],
    [{ pictures: [{ label: 7 }] }, "label that isn't text"],
    [{ pictures: [null] }, "isn't valid"],
    [{ pictures: [{ people: ['a'] }] }, 'type the second name, or clear the first'],
    [{ pictures: [{ people: ['a', '  '] }] }, 'type the second name, or clear the first'],
    [{ pictures: [{ people: ['a', 'a'] }] }, 'type two different names'],
    // Case, accents and spaces never matter: these are one name.
    [{ pictures: [{ people: ['Ana Maria', 'anamaría'] }] }, 'type two different names'],
    [{ pictures: [{ people: ['Ana', 'x'.repeat(41)] }] }, 'names are at most 40 characters'],
    [{ pictures: [{ people: ['a', 'b', 'c'] }] }, 'type two names, or none'],
    [{ pictures: [{ people: [1, 2] }] }, 'type two names, or none'],
    [{ pictures: [{ image: '../secret.jpg' }] }, "that image isn't valid"],
    [{ pictures: [{ image: 'https://example.com/x.jpg' }] }, "that image isn't valid"],
    [{ pictures: [{ image: 's/g/x.png' }] }, "that image isn't valid"],
    [{ pictures: [{ originals: 's/g/x.jpg' }] }, "those photos of the two people aren't valid"],
    [{ pictures: [{ originals: ['s/g/a.jpg', 's/g/b.jpg', 's/g/c.jpg'] }] }, "those photos of the two people aren't valid"],
    [{ pictures: [{ originals: ['../secret.jpg'] }] }, "the photo of the first person isn't valid"],
    [{ pictures: [{ originals: [null, 'https://example.com/x.jpg'] }] }, "the photo of the second person isn't valid"],
    [{ pictures: [{ originals: [7, null] }] }, "the photo of the first person isn't valid"],
    [{ pictures: [{}], pointsPerPerson: 1.5 }, 'Points per right person must be a whole number from 0 to 10'],
    [{ pictures: [{}], pointsPerPerson: 11 }, 'Points per right person must be a whole number from 0 to 10'],
    [{ pictures: [{}], bonusForBoth: -1 }, 'The bonus for both must be a whole number from 0 to 10'],
    [{ pictures: [{}], bonusForBoth: null }, 'The bonus for both must be a whole number from 0 to 10'],
    [{ pictures: [{}], seconds: 9 }, 'The time to guess must be 10 to 90 seconds'],
    [{ pictures: [{}], seconds: 91 }, 'The time to guess must be 10 to 90 seconds'],
    [{ pictures: [{}], seconds: 20.5 }, 'The time to guess must be 10 to 90 seconds'],
    [{ pictures: [{}], seconds: '30' }, 'The time to guess must be 10 to 90 seconds'],
  ])('refuses %j', (input, message) => {
    expect(() => parse(input)).toThrow(GameError)
    expect(() => parse(input)).toThrow(message)
  })

  it('takes the edges of each range, and an old showing time of any value', () => {
    expect(parse({ pictures: [{}], seconds: 10, showSeconds: 2 })).toMatchObject({ seconds: 10 })
    expect(parse({ pictures: [{}], seconds: 90, showSeconds: null })).toMatchObject({ seconds: 90 })
    expect(parse({ pictures: [{}], seconds: 90 })).not.toHaveProperty('showSeconds')
  })

  it('counts label length in code points, as Postgres does', () => {
    expect(parse({ pictures: [{ label: '\u{1F600}'.repeat(20) }] }).pictures[0].label).toHaveLength(40)
  })
})

describe('setup', () => {
  it('opens the lobby: no prompt and no announcement, the title card opens the game', () => {
    const { result: state, effects } = start()
    expect(state).toEqual({
      phase: 'lobby',
      key: { 1: ['ana', 'bo'], 2: ['cy', 'dee'] },
      revealed: [],
      results: {},
      totals: {},
      current: null,
      openedAt: null,
      endsAt: null,
      revealedAt: null,
    })
    expect(effects.prompts.open).toEqual([])
    expect(effects.announcements).toEqual([])
    expect(game.wakeAt(state)).toBeNull()
  })

  it('keeps typed names whoever has joined: a picture may be of someone nobody joined as', () => {
    // 'bo' isn't here: the key is names, not guests, and starts all the same.
    expect(start(config(), ['ana', 'cy', 'dee', 'eve']).result.key).toEqual({ 1: ['ana', 'bo'], 2: ['cy', 'dee'] })
  })

  it("turns settings saved with guests' ids into their names, and refuses only an id on no list any more", () => {
    const id = (n: number) => `f1c7a000-0000-4000-8000-${String(n).padStart(12, '0')}`
    const players = [
      { id: id(1), name: 'Ana', profile: {} },
      { id: id(2), name: 'Bo', profile: {} },
    ]
    const guests = [...players.map((p) => ({ id: p.id, name: p.name, joined: true })), { id: id(3), name: 'Zelda', joined: false }]
    const cfg = config({ pictures: [{ label: '#1', people: [id(1), id(3)] }, { label: '#2', people: [id(2), 'Tilde'] }] })
    const { ctx } = createGameContext(testInfo(cfg, [], { players, guests }), seededRandom())
    // The state holds names only: no guest's id.
    expect(game.setup(ctx).key).toEqual({ 1: ['Ana', 'Zelda'], 2: ['Bo', 'Tilde'] })
    const gone = config({ pictures: [{ label: '#1', people: [id(1), id(9)] }] })
    const { ctx: later } = createGameContext(testInfo(gone, [], { players, guests }), seededRandom())
    expect(() => game.setup(later)).toThrow("#1 names someone who isn't on the guest list any more. Type their name in the settings.")
    // An old id and the same name typed are one person.
    const twice = config({ pictures: [{ label: '#1', people: [id(1), 'ana'] }] })
    const { ctx: same } = createGameContext(testInfo(twice, [], { players, guests }), seededRandom())
    expect(() => game.setup(same)).toThrow('#1: type two different names')
  })

  it('takes no moves from phones: guesses are prompts', () => {
    expect(() => (game as AnyGame).parseAction({ type: 'vote' })).toThrow('This game takes guesses, not moves')
  })
})

describe('no showing', () => {
  it('has no showing any more: the host starts with the first picture', () => {
    expect(() => game.parseHostAction({ type: 'show' })).toThrow('Unknown host action')
    expect(() => game.parseHostAction({ type: 'wall', from: 'showing' })).toThrow('Unknown host action')
  })

  it('reads a save from the showing as the wall, which waits for the host', () => {
    const old = { ...start().result, phase: 'showing', showStartedAt: 5_000 } as unknown as FusionState
    const state = readState(old)
    expect(state.phase).toBe('wall')
    expect(state).not.toHaveProperty('showStartedAt')
    expect(game.wakeAt(old)).toBeNull()
    expect(pub(old).phase).toBe('wall')
    // And the host goes on from it as from the wall.
    expect(asked(1, old)).toMatchObject({ phase: 'asking', current: 1 })
  })
})

describe('the wall', () => {
  it('comes from the lobby or a reveal, each by name', () => {
    const lobby = start().result
    expect(host(lobby, { type: 'wall', from: 'lobby' }).result.phase).toBe('wall')
    const reveal = revealed(1, [['cy', ['ana', 'bo']]]).result
    const back = host(reveal, { type: 'wall', from: 'reveal', n: 1 }).result
    expect(back).toMatchObject({ phase: 'wall', current: null, revealedAt: null, revealed: [1] })
    expect(pub(back).current).toBeNull()
  })

  it('skips a stale step: the phase it names has passed, or the reveal was another picture', () => {
    const lobby = start().result
    const wall = host(lobby, { type: 'wall', from: 'lobby' }).result
    expect(host(wall, { type: 'wall', from: 'lobby' }).result).toBe(wall)
    const reveal = revealed(1, []).result
    expect(host(reveal, { type: 'wall', from: 'reveal', n: 2 }).result).toBe(reveal)
    expect(host(reveal, { type: 'wall', from: 'lobby' }).result).toBe(reveal)
    const asking = asked(2)
    expect(host(asking, { type: 'wall', from: 'reveal', n: 2 }).result).toBe(asking)
  })

  it('comes back by itself 10 s after a reveal', () => {
    const reveal = revealed(1, []).result
    expect(game.wakeAt(reveal)).toBe(20_000 + REVEAL_HOLD_MS)
    expect(wake(reveal, { now: 30_000 }).result).toMatchObject({ phase: 'wall', current: null })
  })
})

describe('asking a picture', () => {
  it('opens its guess after the suspense with its whole countdown, offering names and nothing about the answer', () => {
    const { result: state, effects } = host(start().result, { type: 'ask', n: 1 }, { now: 10_000 })
    // The TV shows which picture it is first: the countdown starts once that is over, so nobody loses guessing time.
    const endsAt = 10_000 + SUSPENSE_MS + 30_000
    expect(effects.prompts.open).toEqual([{ key: 'p1', spec: SPEC, closes_at: endsAt + GRACE_MS }])
    // Two names out of everyone here and every name in the pictures, the same list whatever picture is asked.
    expect(SPEC).toEqual({ kind: 'choice', options: ['ana', 'bo', 'cy', 'dee', 'eve', 'fin'], min: 2, max: 2, final: true })
    expect(host(start().result, { type: 'ask', n: 2 }).effects.prompts.open[0].spec).toEqual(SPEC)
    expect(effects.announcements).toEqual([])
    expect(state).toMatchObject({ phase: 'asking', current: 1, openedAt: 10_000, endsAt, revealedAt: null })
    expect(game.wakeAt(state)).toBe(endsAt + GRACE_MS + WAKE_MARGIN_MS)
    expect(pub(state).current).toEqual({ n: 1, step: 1, key: 'p1', openedAt: 10_000, startsAt: 10_000 + SUSPENSE_MS, endsAt, revealedAt: null })
  })

  it('offers everyone here and every name in the pictures, each once whatever its spelling, A to Z', () => {
    const cfg = config({ pictures: [{ label: '#1', people: ['Zelda', 'ANA'] }, { label: '#2', people: ['Åse', 'Tilde'] }] })
    const players = [
      { id: 'p1', name: 'Ana', profile: {} },
      { id: 'p2', name: 'Bo', profile: {} },
      { id: 'p3', name: 'Ørn', profile: {} },
    ]
    const state = run((ctx) => game.setup(ctx), { players }, cfg).result
    // Ana as she joined; the Danish order puts Æ, Ø and Å after Z.
    expect(guessNames(state, { players })).toEqual(['Ana', 'Bo', 'Tilde', 'Zelda', 'Ørn', 'Åse'])
    const { effects } = run((ctx) => game.handleHostAction(state, { type: 'ask', n: 1 }, ctx), { players }, cfg)
    expect(effects.prompts.open[0].spec).toEqual(voteSpec(['Ana', 'Bo', 'Tilde', 'Zelda', 'Ørn', 'Åse']))
  })

  it('takes the round’s own seconds', () => {
    const cfg = config({ seconds: 12 })
    const { result, effects } = host(start(cfg).result, { type: 'ask', n: 2 }, { now: 0 }, cfg)
    expect(result.endsAt).toBe(SUSPENSE_MS + 12_000)
    expect(effects.prompts.open[0].closes_at).toBe(SUSPENSE_MS + 13_000)
    expect(pub(result, PLAYERS, cfg).current).toMatchObject({ startsAt: SUSPENSE_MS, endsAt: SUSPENSE_MS + 12_000 })
  })

  it('reads a picture asked before the suspense with its countdown from the ask', () => {
    const old = { ...asked(1), endsAt: 10_000 + 30_000 }
    expect(pub(old).current).toMatchObject({ openedAt: 10_000, startsAt: 10_000, endsAt: 40_000 })
  })

  it('works from the lobby, the wall and a reveal, in any order', () => {
    const lobby = start().result
    const fromLobby = host(lobby, { type: 'ask', n: 2 }).result
    expect(fromLobby).toMatchObject({ phase: 'asking', current: 2 })
    const wall = host(lobby, { type: 'wall', from: 'lobby' }).result
    expect(host(wall, { type: 'ask', n: 2 }).result).toMatchObject({ phase: 'asking', current: 2 })
    expect(asked(1, lobby).current).toBe(1)
    const reveal = revealed(2, []).result
    const next = host(reveal, { type: 'ask', n: 1 }, { now: 60_000 }).result
    expect(next).toMatchObject({ phase: 'asking', current: 1, openedAt: 60_000, revealedAt: null, revealed: [2] })
    // "Picture 2 of 3" though it is #1: the strap counts the guessing.
    expect(pub(next).current).toMatchObject({ n: 1, step: 2 })
  })

  it('does nothing for the picture being asked (a double tap) or one already revealed', () => {
    const asking = asked(1)
    const again = host(asking, { type: 'ask', n: 1 })
    expect(again.result).toBe(asking)
    expect(again.effects.prompts.open).toEqual([])
    const reveal = revealed(1, []).result
    expect(host(reveal, { type: 'ask', n: 1 }).result).toBe(reveal)
    const wall = host(reveal, { type: 'wall', from: 'reveal', n: 1 }).result
    expect(host(wall, { type: 'ask', n: 1 }).result).toBe(wall)
  })

  it('refuses another picture while one is asked, a picture without its people, and one past the last', () => {
    expect(() => host(asked(1), { type: 'ask', n: 2 })).toThrow('Reveal #1 first')
    expect(() => host(start().result, { type: 'ask', n: 3 })).toThrow('Set who is in The viking first')
    expect(() => host(start().result, { type: 'ask', n: 4 })).toThrow('There is no picture #4')
    expect(() => host(start().result, { type: 'ask', n: 41 })).toThrow('There is no such picture')
  })

  it('takes a key typed on the night, then asks it, offering its names too', () => {
    const keyed = host(start().result, { type: 'setKey', n: 3, people: ['eve', 'Quentin'] }).result
    const { result, effects } = host(keyed, { type: 'ask', n: 3 })
    expect(result.current).toBe(3)
    expect(effects.prompts.open[0].spec).toEqual(voteSpec(['ana', 'bo', 'cy', 'dee', 'eve', 'fin', 'Quentin']))
  })
})

describe('the reveal', () => {
  it('scores a point per right person for everyone who locked in, the two in the picture too', () => {
    const { result, effects } = revealed(1, [
      ['cy', ['ana', 'bo']], // both
      ['dee', ['ana', 'eve']], // one
      ['eve', ['cy', 'dee']], // none
      ['ana', ['bo', 'cy']], // in the picture: knows herself, names Bo: one
      ['bo', ['ana', 'bo']], // a crafted lock with his own name: it counts for nothing, Ana for one
    ])
    expect(result.results[1]).toEqual({ both: 1, one: 3, none: 1, voters: 5, hits: { cy: 2, dee: 1, eve: 0, ana: 1, bo: 1 }, at: 20_000 })
    expect(result.totals).toEqual({ cy: 2, dee: 1, ana: 1, bo: 1 })
    expect(result).toMatchObject({ phase: 'reveal', current: 1, revealed: [1], revealedAt: 20_000 })
    expect(effects.prompts.reveal).toEqual(['p1'])
    // No announcement: the TV and the phones show the reveal themselves.
    expect(effects.announcements).toEqual([])
    expect(effects.records).toEqual([
      { type: 'revealed', data: { n: 1, label: '#1', people: ['ana', 'bo'], both: 1, one: 3, none: 1, voters: 5 }, about: ['ana', 'bo'] },
    ])
  })

  it('counts a voter’s own name in teams, so a team that names one of its own scores as one', () => {
    const teams = run((ctx) => game.setup(ctx), { teamPlay: true }).result
    expect(teams.teamPlay).toBe(true)
    // Ana's team locked in Ana and Bo for every member: Ana gets both too.
    const { result } = revealed(1, [
      ['ana', ['ana', 'bo']],
      ['cy', ['ana', 'bo']],
      ['bo', ['bo', 'eve']],
    ], teams)
    expect(result.results[1].hits).toEqual({ ana: 2, cy: 2, bo: 1 })
    expect(result.totals).toEqual({ ana: 2, cy: 2, bo: 1 })
    expect(result.teamPlay).toBe(true)
    // Alone, the state says nothing of teams and the same locks give Ana one.
    expect(start().result).not.toHaveProperty('teamPlay')
    expect(revealed(1, [['ana', ['ana', 'bo']]]).result.results[1].hits).toEqual({ ana: 1 })
  })

  it('matches names whatever their case, accents and spaces', () => {
    const cfg = config({ pictures: [{ label: '#1', people: ['Ana María', 'Bo'] }] })
    const players = [
      { id: 'p1', name: 'Cy', profile: {} },
      { id: 'p2', name: 'Ana Maria', profile: {} },
    ]
    const lobby = run((ctx) => game.setup(ctx), { players }, cfg).result
    const asking = run((ctx) => game.handleHostAction(lobby, { type: 'ask', n: 1 }, ctx), { players, now: 10_000 }, cfg).result
    const reveal = run(
      (ctx) => game.handleHostAction(asking, { type: 'reveal', n: 1 }, ctx),
      { ...closedWith(1, 10_000, [['p1', ['anamaria', ' BO ']]]), players },
      cfg,
    )
    expect(reveal.result.results[1].hits).toEqual({ p1: 2 })
    // The log's people who joined: Ana Maria, by her name.
    expect(reveal.effects.records[0].about).toEqual(['p2'])
  })

  it('adds the bonus for getting both, and points per person as configured', () => {
    const cfg = config({ pointsPerPerson: 2, bonusForBoth: 3 })
    const { result } = revealed(1, [['cy', ['ana', 'bo']], ['dee', ['bo', 'eve']]], start(cfg).result, cfg)
    expect(result.totals).toEqual({ cy: 7, dee: 2 })
  })

  it('gives the same result by Reveal now and by the timer', () => {
    const locks: [PlayerId, [string, string]][] = [['cy', ['ana', 'bo']], ['dee', ['ana', 'eve']]]
    const asking = asked(1)
    const byHost = host(asking, { type: 'reveal', n: 1 }, closedWith(1, 10_000, locks))
    const byTimer = wake(asking, closedWith(1, 10_000, locks))
    expect(byTimer.result).toEqual(byHost.result)
    expect(byTimer.effects).toEqual(byHost.effects)
  })

  it('skips a reveal of a picture that isn’t being asked: the timer was first', () => {
    const reveal = revealed(1, []).result
    expect(host(reveal, { type: 'reveal', n: 1 }).result).toBe(reveal)
    const lobby = start().result
    expect(host(lobby, { type: 'reveal', n: 1 }).result).toBe(lobby)
    expect(host(asked(2), { type: 'reveal', n: 1 }).result.phase).toBe('asking')
  })

  it('refuses while the locks are still open', () => {
    expect(() => host(asked(1), { type: 'reveal', n: 1 }, { answers: {} })).toThrow('The votes for #1 are still open')
  })

  it('without locks when the timer comes, closes the guess and changes nothing, so Reveal now still works', () => {
    const asking = asked(1)
    const due = 10_000 + ASKED_MS + GRACE_MS + WAKE_MARGIN_MS
    const { result, effects } = wake(asking, { now: due, prompts: { p1: prompt(1, 10_000) }, answers: {} })
    expect(result).toBe(asking)
    expect(effects.prompts.close).toEqual(['p1'])
    expect(effects.records).toEqual([])
    // Already closed: nothing to do at all.
    expect(wake(asking, { now: due, prompts: { p1: prompt(1, 10_000, due - 250) }, answers: {} }).effects.prompts.close).toEqual([])
    expect(host(asking, { type: 'reveal', n: 1 }, closedWith(1, 10_000, [])).result.phase).toBe('reveal')
  })

  it('still names someone in the picture who has left the party: the key is names', () => {
    const asking = asked(1)
    const players = ['bo', 'cy', 'dee', 'eve', 'fin'].map((id) => ({ id, name: id, profile: {} }))
    const { result, effects } = host(asking, { type: 'reveal', n: 1 }, { ...closedWith(1, 10_000, [['cy', ['ana', 'bo']]]), players })
    expect(effects.records[0].about).toEqual(['bo'])
    expect(pub(result, ['bo', 'cy']).pictures[0].revealed?.names).toEqual(['ana', 'bo'])
  })

  it('counts a voter who has left since in the numbers, but not on the board', () => {
    const reveal = revealed(1, [['cy', ['ana', 'bo']], ['dee', ['ana', 'bo']]]).result
    const without = PLAYERS.filter((id) => id !== 'dee')
    const room = pub(reveal, without)
    expect(room.pictures[0].revealed).toMatchObject({ both: 2, voters: 2 })
    expect(room.top).toEqual([{ playerId: 'cy', points: 2, rank: 1 }])
    expect(game.winners(reveal, testInfo(config(), without))).toEqual(['cy'])
  })
})

describe('setKey', () => {
  it('sets or changes who is in a picture, kept secret from the room', () => {
    const { result: state, effects } = host(start().result, { type: 'setKey', n: 3, people: [' eve ', 'Quentin'] })
    // Typed names, cleaned, whoever has joined.
    expect(state.key[3]).toEqual(['eve', 'Quentin'])
    expect(effects.announcements).toEqual([])
    expect(JSON.stringify(pub(state))).not.toContain('Quentin')
    const changed = host(state, { type: 'setKey', n: 1, people: ['cy', 'fin'] }).result
    expect(changed.key[1]).toEqual(['cy', 'fin'])
  })

  it('changes nothing when the same two are set again, in either order; a new spelling is a change', () => {
    const state = start().result
    expect(host(state, { type: 'setKey', n: 1, people: ['bo', 'ana'] }).result).toBe(state)
    expect(host(state, { type: 'setKey', n: 1, people: ['Ana', 'bo'] }).result.key[1]).toEqual(['Ana', 'bo'])
  })

  it("takes a guest's id from a host page from before names as that guest's name", () => {
    const players = [
      { id: 'f1c7a000-0000-4000-8000-000000000001', name: 'Ana', profile: {} },
      { id: 'f1c7a000-0000-4000-8000-000000000002', name: 'Bo', profile: {} },
    ]
    const state = run((ctx) => game.setup(ctx), { players }).result
    const people = players.map((p) => p.id)
    const keyed = run((ctx) => game.handleHostAction(state, game.parseHostAction({ type: 'setKey', n: 3, people }), ctx), { players }).result
    expect(keyed.key[3]).toEqual(['Ana', 'Bo'])
  })

  it("takes the same two the other way round when the picture has their own photos: the order says whose photo is whose", () => {
    const cfg = config({ pictures: [{ label: '#1', people: ['ana', 'bo'], originals: ['s/g/ana.jpg', null] }] })
    const state = start(cfg).result
    expect(host(state, { type: 'setKey', n: 1, people: ['ana', 'bo'] }, {}, cfg).result).toBe(state)
    expect(host(state, { type: 'setKey', n: 1, people: ['bo', 'ana'] }, {}, cfg).result.key[1]).toEqual(['bo', 'ana'])
  })

  it('works in every phase, the picture being asked included, until that picture is revealed', () => {
    const asking = asked(1)
    const changed = host(asking, { type: 'setKey', n: 1, people: ['cy', 'eve'] }).result
    expect(changed.key[1]).toEqual(['cy', 'eve'])
    const reveal = host(changed, { type: 'reveal', n: 1 }, closedWith(1, 10_000, [['dee', ['cy', 'eve']]])).result
    expect(reveal.totals).toEqual({ dee: 2 })
    expect(() => host(reveal, { type: 'setKey', n: 1, people: ['ana', 'bo'] })).toThrow('#1 is already revealed')
  })

  it.each([
    [{ type: 'setKey', n: 4, people: ['ana', 'bo'] }, 'There is no picture #4'],
    [{ type: 'setKey', n: 1, people: ['ana', 'ANA'] }, 'Type two different names'],
    [{ type: 'setKey', n: 1, people: ['ana', 'f1c7a000-0000-4000-8000-000000000099'] }, 'Type the two names in the picture'],
    [{ type: 'setKey', n: 1, people: ['ana', 'z'.repeat(41)] }, 'Names are at most 40 characters'],
    [{ type: 'setKey', n: 1, people: ['ana', '  '] }, 'Type the two names in the picture'],
    [{ type: 'setKey', n: 1, people: ['ana'] }, 'Type the two names in the picture'],
    [{ type: 'setKey', n: 0, people: ['ana', 'bo'] }, 'There is no such picture'],
    [{ type: 'setKey', n: '1', people: ['ana', 'bo'] }, 'There is no such picture'],
  ])('refuses %j', (action, message) => {
    expect(() => host(start().result, action)).toThrow(message)
  })
})

describe('finish', () => {
  it('crowns the face detective from any phase but a picture being asked', () => {
    const lobby = start().result
    const wall = host(lobby, { type: 'wall', from: 'lobby' }).result
    const reveal = revealed(1, [['cy', ['ana', 'bo']]]).result
    for (const state of [lobby, wall, reveal]) {
      const { result } = host(state, { type: 'finish' })
      expect(result).toMatchObject({ phase: 'done', current: null })
      expect(game.isFinished(result)).toBe(true)
      expect(game.wakeAt(result)).toBeNull()
    }
    expect(() => host(asked(1), { type: 'finish' })).toThrow('Reveal #1 first')
  })

  it('crowns the face detective, tells them, and gives them the badge', () => {
    const reveal = revealed(1, [['cy', ['ana', 'bo']], ['dee', ['ana', 'eve']]]).result
    const players = PLAYERS.map((id): GamePlayer => ({ id, name: id, profile: id === 'cy' ? { fusion: { detective: 2 } } : {} }))
    const { result, effects } = host(reveal, { type: 'finish' }, { players })
    expect(effects.announcements).toEqual([
      expect.objectContaining({ message: 'cy has the sharpest eye', detail: '2 points', icon: 'crown', sound: 'fanfare', interrupt: true }),
      expect.objectContaining({ message: 'You have the sharpest eye', to: ['cy'] }),
    ])
    expect(effects.profiles).toEqual({ cy: { detective: 3 } })
    expect(effects.records).toEqual([{ type: 'crowned', data: { winners: ['cy'], points: 2 }, about: ['cy'] }])
    expect(game.winners(result, testInfo(config(), PLAYERS))).toEqual(['cy'])
  })

  it('crowns everyone tied at the top', () => {
    const reveal = revealed(1, [['cy', ['ana', 'bo']], ['dee', ['ana', 'bo']]]).result
    const { effects } = host(reveal, { type: 'finish' })
    expect(effects.announcements[0].message).toBe('cy and dee have the sharpest eyes')
    expect(effects.announcements[1]).toMatchObject({ message: 'You share the sharpest eye', to: ['cy', 'dee'] })
  })

  it('crowns nobody when nobody scored', () => {
    const reveal = revealed(1, [['cy', ['eve', 'fin']]]).result
    const { result, effects } = host(reveal, { type: 'finish' })
    expect(effects.announcements).toEqual([expect.objectContaining({ message: 'Participant fusion is over', detail: 'Nobody scored this time' })])
    expect(effects.profiles).toEqual({})
    expect(game.winners(result, testInfo(config(), PLAYERS))).toEqual([])
  })
})

describe('onEnd', () => {
  it('says it is over with the leader when the host ends it, a picture still asked staying unscored', () => {
    const reveal = revealed(1, [['cy', ['ana', 'bo']]]).result
    const asking = host(host(reveal, { type: 'wall', from: 'reveal', n: 1 }).result, { type: 'ask', n: 2 }).result
    const { result, effects } = run((ctx) => game.onEnd(asking, ctx, 'host'))
    expect(result).toMatchObject({ phase: 'done', current: null, revealed: [1], totals: { cy: 2 } })
    expect(effects.announcements).toEqual([
      expect.objectContaining({ message: 'Participant fusion is over', detail: 'cy had the sharpest eye with 2 points', icon: 'trophy' }),
    ])
    expect(effects.prompts.reveal).toEqual([])
    expect(pub(result).pictures[1].revealed).toBeNull()
  })

  it('stays quiet when the game finished itself', () => {
    const done = host(start().result, { type: 'finish' }).result
    const { result, effects } = run((ctx) => game.onEnd(done, ctx, 'game'))
    expect(result).toBe(done)
    expect(effects.announcements).toEqual([])
  })
})

describe('what the room sees', () => {
  it('never shows who is in a picture before its reveal, in any phase, to the room or any guest', () => {
    const lobby = start().result
    const wall = host(lobby, { type: 'wall', from: 'lobby' }).result
    const asking = asked(1, wall)
    const reveal = host(asking, { type: 'reveal', n: 1 }, closedWith(1, 10_000, [['eve', ['ana', 'bo']]], 20_000)).result
    const back = host(reveal, { type: 'wall', from: 'reveal', n: 1 }).result
    const asking2 = asked(2, back, 50_000)
    const done = host(back, { type: 'finish' }).result
    for (const [name, state] of Object.entries({ lobby, wall, asking, reveal, back, asking2, done })) {
      const room = canonicalJson(pub(state))
      // #2 (cy and dee) is never revealed; #1 (ana and bo) only from its reveal.
      expect(room, name).not.toMatch(/"(cy|dee)"/)
      if (state.revealed.includes(1)) expect(room, name).toMatch(/"names":\["ana","bo"\]/)
      else expect(room, name).not.toMatch(/"(ana|bo)"/)
      // No guest's view says anything about a picture's people, the two in it included.
      for (const id of [...PLAYERS, 'stranger']) {
        expect(canonicalJson(view(state, id)), `${name} ${id}`).not.toMatch(/"(ana|bo|cy|dee)"/)
        expect(view(state, id)).not.toHaveProperty('inPicture')
      }
    }
  })

  it("keeps each picture's image secret until it is asked: the wall shows a placeholder till then", () => {
    const cfg = config({
      pictures: [
        { label: '#1', image: 's/g/one.jpg', people: ['ana', 'bo'] },
        { label: '#2', image: 's/g/two.jpg', people: ['cy', 'dee'] },
        { label: 'The viking', image: 's/g/three.jpg' },
      ],
    })
    const lobby = start(cfg).result
    const wall = host(lobby, { type: 'wall', from: 'lobby' }, {}, cfg).result
    const asking = asked(1, wall, 10_000, cfg)
    const reveal = host(asking, { type: 'reveal', n: 1 }, closedWith(1, 10_000, [['eve', ['ana', 'bo']]], 20_000), cfg).result
    const back = host(reveal, { type: 'wall', from: 'reveal', n: 1 }, {}, cfg).result
    const asking2 = asked(2, back, 50_000, cfg)
    const ended = run((ctx) => game.onEnd(asking2, ctx, 'host'), {}, cfg).result
    const seen = (state: FusionState) => pub(state, PLAYERS, cfg).pictures.map((p) => [p.asked, p.image])
    expect(seen(lobby)).toEqual([[false, null], [false, null], [false, null]])
    expect(seen(wall)).toEqual([[false, null], [false, null], [false, null]])
    // Asked: its image reaches the room now, while the TV's suspense runs.
    expect(seen(asking)).toEqual([[true, 's/g/one.jpg'], [false, null], [false, null]])
    expect(seen(back)).toEqual([[true, 's/g/one.jpg'], [false, null], [false, null]])
    expect(seen(asking2)).toEqual([[true, 's/g/one.jpg'], [true, 's/g/two.jpg'], [false, null]])
    // Ended while #2 was asked: it stays unscored and secret, its image too.
    expect(seen(ended)).toEqual([[true, 's/g/one.jpg'], [false, null], [false, null]])
    // Never in a guest's view or a prompt.
    for (const state of [lobby, wall, asking, reveal]) for (const id of PLAYERS) expect(canonicalJson(view(state, id, PLAYERS, cfg))).not.toContain('.jpg')
    const { effects } = run((ctx) => game.handleHostAction(wall, game.parseHostAction({ type: 'ask', n: 1 }), ctx), { now: 10_000 }, cfg)
    expect(canonicalJson(effects)).not.toContain('.jpg')
  })

  it("keeps the two people's own photos secret until their picture is revealed, then shows them in the people's order", () => {
    const cfg = config({
      pictures: [
        { label: '#1', people: ['ana', 'bo'], originals: ['s/g/orig-ana.jpg', 's/g/orig-bo.jpg'] },
        { label: '#2', people: ['cy', 'dee'], originals: ['s/g/orig-cy.jpg', null] },
        { label: 'The viking' },
      ],
    })
    const lobby = start(cfg).result
    const wall = host(lobby, { type: 'wall', from: 'lobby' }, {}, cfg).result
    const asking = asked(1, wall, 10_000, cfg)
    const reveal = host(asking, { type: 'reveal', n: 1 }, closedWith(1, 10_000, [['eve', ['ana', 'bo']]], 20_000), cfg).result
    const back = host(reveal, { type: 'wall', from: 'reveal', n: 1 }, {}, cfg).result
    const asking2 = asked(2, back, 50_000, cfg)
    const done = host(back, { type: 'finish' }, {}, cfg).result
    for (const [name, state] of Object.entries({ lobby, wall, asking, reveal, back, asking2, done })) {
      const room = canonicalJson(pub(state, PLAYERS, cfg))
      // #2's photo never shows: it is never revealed. #1's only from its reveal.
      expect(room, name).not.toContain('orig-cy')
      if (state.revealed.includes(1)) expect(room, name).toContain('"originals":["s/g/orig-ana.jpg","s/g/orig-bo.jpg"]')
      else expect(room, name).not.toMatch(/orig-(ana|bo)/)
      // No guest's view ever carries one, the two in the picture included.
      for (const id of PLAYERS) expect(canonicalJson(view(state, id, PLAYERS, cfg)), `${name} ${id}`).not.toContain('orig-')
    }
    // The prompt asks nothing about them either.
    const { effects } = run((ctx) => game.handleHostAction(wall, game.parseHostAction({ type: 'ask', n: 1 }), ctx), { now: 10_000 }, cfg)
    expect(canonicalJson(effects)).not.toContain('orig-')
    // A picture without its own photos says so: two nulls.
    const plain = revealed(1, [['eve', ['ana', 'bo']]]).result
    expect(pub(plain).pictures[0].revealed?.originals).toEqual([null, null])
  })

  it('shows the pictures, the rules and the top five with ranks', () => {
    const cfg = config({ pictures: [{ label: '#1', image: 's/g/a.jpg', people: ['ana', 'bo'] }, { label: '#2' }], bonusForBoth: 2, seconds: 20 })
    const state = { ...start(cfg).result, totals: { eve: 1, cy: 3, dee: 3, gone: 9 } }
    const room = pub(state, PLAYERS, cfg)
    // Not asked yet: no image, whatever the settings hold.
    expect(room.pictures).toEqual([
      { n: 1, key: 'p1', label: '#1', asked: false, image: null, revealed: null },
      { n: 2, key: 'p2', label: '#2', asked: false, image: null, revealed: null },
    ])
    expect(room.rules).toEqual({ seconds: 20, perPerson: 1, bothBonus: 2 })
    expect(room.top).toEqual([
      { playerId: 'cy', points: 3, rank: 1 },
      { playerId: 'dee', points: 3, rank: 1 },
      { playerId: 'eve', points: 1, rank: 3 },
    ])
    expect(room).toMatchObject({ phase: 'lobby', current: null })
    expect(room).not.toHaveProperty('expected')
    expect(readPublic(jsonbRoundTrip(room))).toEqual(room)
  })

  it('gives each guest their points, their place and how they did on each revealed picture', () => {
    const reveal = revealed(1, [['cy', ['ana', 'bo']], ['eve', ['cy', 'dee']], ['ana', ['bo', 'eve']]]).result
    expect(view(reveal, 'cy')).toEqual<FusionPlayerView>({ points: 2, rank: 1, hits: { 1: 2 } })
    expect(view(reveal, 'eve')).toEqual({ points: 0, rank: null, hits: { 1: 0 } })
    // In the picture, and scoring on it like anyone.
    expect(view(reveal, 'ana')).toEqual({ points: 1, rank: 2, hits: { 1: 1 } })
    expect(view(reveal, 'stranger')).toEqual({ points: 0, rank: null, hits: {} })
    expect(game.scores(reveal)).toEqual({ cy: 2, ana: 1 })
    const info = testInfo(config(), PLAYERS)
    expect(canonicalJson(game.publicState(jsonbRoundTrip(reveal), info))).toBe(canonicalJson(game.publicState(reveal, info)))
    expect(pub(reveal).pictures[0].revealed).toEqual({
      names: ['ana', 'bo'],
      both: 1,
      one: 1,
      none: 1,
      voters: 3,
      originals: [null, null],
      step: 1,
      at: 20_000,
    })
    expect(pub(reveal).current).toEqual({
      n: 1,
      step: 1,
      key: 'p1',
      openedAt: 10_000,
      startsAt: 10_000 + SUSPENSE_MS,
      endsAt: 10_000 + ASKED_MS,
      revealedAt: 20_000,
    })
  })
})

describe('host actions from untrusted input', () => {
  it.each([
    null,
    1,
    'x',
    [],
    {},
    { type: 'nope' },
    { type: 'lock' },
    { type: 'reveal' },
    { type: 'reveal', n: 1.5 },
    { type: 'ask', n: 0 },
    { type: 'wall' },
    { type: 'wall', from: 'asking' },
    { type: 'wall', from: 'reveal' },
    { type: 'wall', from: 'showing' },
    { type: 'show' },
    { type: 'setKey', n: 1, people: 'ab' },
    { type: 'setKey', n: 1, people: ['ana', ''] },
    { type: 'setKey', n: 1, people: ['ana', 7] },
  ])('refuses %j', (input) => {
    expect(() => game.parseHostAction(input)).toThrow(GameError)
  })

  it('keeps only what it knows', () => {
    expect(game.parseHostAction({ type: 'finish', extra: 1 })).toEqual({ type: 'finish' })
    expect(game.parseHostAction({ type: 'wall', from: 'lobby', n: 3 })).toEqual({ type: 'wall', from: 'lobby' })
    expect(game.parseHostAction({ type: 'wall', from: 'reveal', n: 3 })).toEqual({ type: 'wall', from: 'reveal', n: 3 })
    expect(game.parseHostAction({ type: 'ask', n: 2, people: ['x'] })).toEqual({ type: 'ask', n: 2 })
    expect(game.parseHostAction({ type: 'reveal', n: 2 })).toEqual({ type: 'reveal', n: 2 })
  })
})

describe('a round of the background version', () => {
  // As the background version saved it: voting or locked, every prompt open from the start.
  const legacy = (phase: 'voting' | 'locked'): FusionState =>
    ({
      phase,
      key: { 1: ['ana', 'bo'], 2: ['cy', 'dee'] },
      names: { ana: 'ana', bo: 'bo', cy: 'cy', dee: 'dee' },
      revealed: phase === 'locked' ? [1] : [],
      results: phase === 'locked' ? { 1: { both: 1, one: 0, none: 0, voters: 1, hits: { cy: 2 } } } : {},
      totals: phase === 'locked' ? { cy: 2 } : {},
      lastReveal: phase === 'locked' ? { n: 1, at: 5_000 } : null,
    }) as unknown as FusionState
  const oldConfig = { pictures: config().pictures, pointsPerPerson: 1, bonusForBoth: 0 } as FusionConfig

  it('reads as a lobby that never starts: no timer, every step refused', () => {
    for (const phase of ['voting', 'locked'] as const) {
      const state = legacy(phase)
      const info = testInfo(oldConfig, PLAYERS)
      expect(game.wakeAt(state)).toBeNull()
      const room = game.publicState(state, info)
      expect(room).toMatchObject({ phase: 'lobby', current: null, rules: { seconds: 30 } })
      expect(readPublic(jsonbRoundTrip(room))).toEqual(room)
      expect(game.playerView(state, 'ana', info)).toEqual({ points: 0, rank: null, hits: {} })
      for (const action of [{ type: 'wall', from: 'lobby' }, { type: 'ask', n: 2 }, { type: 'finish' }, { type: 'setKey', n: 2, people: ['eve', 'fin'] }]) {
        expect(() => host(state, action, {}, oldConfig)).toThrow(LEGACY_MESSAGE)
      }
      expect(wake(state, {}, oldConfig).result).toBe(state)
    }
    // Its key read as the names it kept: ids then, names now.
    expect(game.publicState(legacy('locked'), testInfo(oldConfig, PLAYERS)).pictures[0].revealed).toMatchObject({ names: ['ana', 'bo'], step: 1, at: null })
    expect(game.publicState(legacy('locked'), testInfo(oldConfig, PLAYERS)).top).toEqual([{ playerId: 'cy', points: 2, rank: 1 }])
  })

  it('ends: the host’s End announces the leader, the points so far stand', () => {
    const { result, effects } = run((ctx) => game.onEnd(legacy('locked'), ctx, 'host'), {}, oldConfig)
    expect(result).toMatchObject({ phase: 'done', revealed: [1], totals: { cy: 2 }, current: null })
    expect(game.isFinished(result)).toBe(true)
    expect(effects.announcements[0]).toMatchObject({ detail: 'cy had the sharpest eye with 2 points' })
    expect(game.winners(result, testInfo(oldConfig, PLAYERS))).toEqual(['cy'])
    expect(readState(legacy('voting'))).toMatchObject({ current: null, openedAt: null, endsAt: null, revealedAt: null })
  })

  it('still makes its recap once finished', () => {
    const done = { ...legacy('locked'), phase: 'done' } as FusionState
    const round: RecapRound<FusionState, FusionConfig> = {
      gameId: GAME,
      title: 'Who is fused?',
      round: 1,
      finished: true,
      startedAt: 0,
      finishedAt: 9_000,
      finishedBy: 'host',
      config: oldConfig,
      state: done,
      winners: ['cy'],
      players: PLAYERS.map((id) => ({ id, name: id })),
      points: { cy: 2 },
      log: [],
    }
    expect(game.recap(round).map((h) => h.title)).toEqual(['Sharpest eye: cy'])
  })

  it("reads a stage save from before names, whose key held guests' ids, as the names it kept", () => {
    const old = {
      ...start().result,
      key: { 1: ['id-a', 'id-b'] },
      names: { 'id-a': 'Ana', 'id-b': 'Bo' },
      showStartedAt: null,
    } as unknown as FusionState
    const state = readState(old)
    expect(state.key).toEqual({ 1: ['Ana', 'Bo'] })
    expect(state).not.toHaveProperty('names')
  })
})

// Whole rounds through the in-memory party: the real step(), game_load and
// game_commit rules, submit_answer's checks, and the timers' syncs.

/** A party of `players` guests: their ids, and their names ("Guest 1" on), which pictures and guesses use. */
function party(players = 8) {
  const p = simulateParty({ games: [new FusionGame()], players })
  const ids = p.players.map((pl) => pl.id)
  const names = p.players.map((pl) => pl.name)
  return { p, ids, names }
}

function startParty(p: FakeParty, settings: Record<string, unknown>) {
  p.addGame(GAME, 'fusion', 'Who is fused?', { seconds: 30, ...settings })
  const started = p.send(p.hostUser, { type: 'start', gameId: GAME })
  expect(started.kind).toBe('commit')
  return started
}

const hostAct = (p: FakeParty, action: unknown, close?: string[]) =>
  p.send(p.hostUser, { type: 'host-action', gameId: GAME, action, close })
/** A lock of two names (or one, to be refused); `intoCountdown` is ms into the countdown, which starts after the suspense. */
const lock = (p: FakeParty, n: number, voter: PlayerId, choice: string[], intoCountdown?: number) =>
  p.submit(GAME, pictureKey(n), voter, { choice }, intoCountdown === undefined ? undefined : SUSPENSE_MS + intoCountdown)
const roomOf = (p: FakeParty) => readPublic(p.game(GAME).publicState)!
const stateOf = (p: FakeParty) => p.stateOf(GAME)!.state as FusionState
const recapOf = (p: FakeParty) => p.recapRounds(GAME)[0] as RecapRound<FusionState, FusionConfig>
/** Ticks to the game's wake time (and `extra` past it), then syncs as the TV does. */
function wakeUp(p: FakeParty, extra = 0) {
  const at = p.game(GAME).wakeAt
  if (at === null) throw new Error('No wake time')
  p.tick(Math.max(0, at - p.now) + extra)
  return p.sync(GAME)
}

describe('a round in the party', () => {
  it('takes the TV, then asks the pictures one by one, everyone locking in two names on their phones', () => {
    const { p, ids, names } = party()
    const [a, , , , e, f, g] = ids
    const [A, B, C, D] = names
    startParty(p, { pictures: [{ people: [A, B] }, { people: [C, D] }], pointsPerPerson: 1, bonusForBoth: 1 })
    expect(p.spotlight).toBe(GAME) // a stage game takes the TV
    expect(p.promptsOf(GAME)).toEqual([])
    expect(roomOf(p).phase).toBe('lobby')

    // From the lobby straight to the first picture: no showing.
    expect(hostAct(p, { type: 'ask', n: 1 }).kind).toBe('commit')
    expect(p.promptsOf(GAME).map((x) => x.key)).toEqual(['p1'])
    lock(p, 1, e, [A, B])
    lock(p, 1, f, [A, C])
    expect(() => lock(p, 1, f, [A, B])).toThrow('You already answered') // the first lock counts
    lock(p, 1, a, [B, C]) // in the picture: she guesses too, and scores
    expect(() => lock(p, 1, g, ['Nobody', A])).toThrow('That is not one of the options') // only the names offered
    expect(() => lock(p, 1, g, [A])).toThrow('Pick 2')
    expect(p.talliesOf(GAME)).toEqual({ p1: 3 })
    expect(canonicalJson(p.game(GAME).publicState)).not.toContain(`"${A}"`)

    // Reveal now, as the host page sends it.
    expect(hostAct(p, { type: 'reveal', n: 1 }, ['p1']).kind).toBe('commit')
    expect(hostAct(p, { type: 'reveal', n: 1 }, ['p1']).kind).toBe('skip') // a double tap
    expect(roomOf(p).pictures[0].revealed).toMatchObject({ names: ['Guest 1', 'Guest 2'], both: 1, one: 2, none: 0, voters: 3, step: 1 })
    expect(roomOf(p).pictures[1].revealed).toBeNull()
    expect(p.game(GAME).scores).toEqual({ [e]: 3, [f]: 1, [a]: 1 })
    expect(readView(p.game(GAME).views[e])).toEqual({ points: 3, rank: 1, hits: { 1: 2 } })
    expect(readView(p.game(GAME).views[a])).toEqual({ points: 1, rank: 2, hits: { 1: 1 } })
    expect(p.feed).toEqual([])

    // The wall comes back by itself; then #2, revealed by the timer.
    expect(wakeUp(p).kind).toBe('commit')
    expect(roomOf(p)).toMatchObject({ phase: 'wall', current: null })
    expect(hostAct(p, { type: 'ask', n: 2 }).kind).toBe('commit')
    lock(p, 2, e, [C, D], 29_900) // 29.9 s into the countdown
    expect(() => lock(p, 2, g, [C, D], 31_000)).toThrow('Too late, answers are closed')
    expect(wakeUp(p).kind).toBe('commit')
    expect(roomOf(p)).toMatchObject({ phase: 'reveal', current: { n: 2, step: 2 } })
    expect(p.game(GAME).scores).toEqual({ [e]: 6, [f]: 1, [a]: 1 })

    expect(hostAct(p, { type: 'finish' }).kind).toBe('commit')
    expect(p.game(GAME)).toMatchObject({ status: 'finished', finishedBy: 'game', winners: [e] })
    expect(p.players.find((pl) => pl.id === e)?.profile).toEqual({ fusion: { detective: 1 } })
    expect(p.feed.filter((item) => item.interrupt).map((item) => item.message)).toEqual(['Guest 5 has the sharpest eye'])
  })

  it('starts settings saved with guests’ ids, as their names', () => {
    const { p, ids } = party(5)
    startParty(p, { pictures: [{ people: [ids[0], ids[1]] }], pointsPerPerson: 1, bonusForBoth: 0 })
    expect(stateOf(p).key).toEqual({ 1: ['Guest 1', 'Guest 2'] })
    expect(canonicalJson(p.stateOf(GAME)!.state)).not.toContain(ids[0])
  })

  it('types the key on the night and still keeps it secret', () => {
    const { p, names } = party(5)
    startParty(p, { pictures: [{}], pointsPerPerson: 1, bonusForBoth: 0 })
    expect(hostAct(p, { type: 'ask', n: 1 })).toMatchObject({ kind: 'refuse', message: 'Set who is in #1 first' })
    expect(hostAct(p, { type: 'setKey', n: 1, people: [names[0], 'Quentin'] }).kind).toBe('commit')
    expect(stateOf(p).key).toEqual({ 1: [names[0], 'Quentin'] })
    expect(canonicalJson(p.game(GAME).publicState)).not.toContain('Quentin')
    expect(canonicalJson(Object.values(p.game(GAME).views))).not.toContain('Quentin')
    expect(hostAct(p, { type: 'setKey', n: 1, people: ['Quentin', names[0]] }).kind).toBe('skip')
  })

  it("keeps each picture's image off every phone and the TV until it is asked, and the own photos until its reveal", () => {
    const { p, ids, names } = party(6)
    const [a, , , , e, f] = ids
    const [A, B, C, D] = names
    const photos = { a: 's/g/secret-a.jpg', b: 's/g/secret-b.jpg', c: 's/g/secret-c.jpg' }
    const images = { one: 's/g/fused-one.jpg', two: 's/g/fused-two.jpg' }
    // Everything a phone or the TV reads: the public state, the views, the prompts, the feed, the party's data and players, the tallies.
    const screens = () =>
      canonicalJson({
        room: p.game(GAME).publicState,
        views: p.game(GAME).views,
        prompts: p.promptsOf(GAME),
        feed: p.feed,
        data: p.sessionData,
        players: p.players,
        tallies: p.talliesOf(GAME),
        pings: p.pings,
      })
    const seen = (paths: Record<string, string>) => Object.entries(paths).filter(([, path]) => screens().includes(path)).map(([who]) => who)
    startParty(p, {
      pictures: [
        { image: images.one, people: [A, B], originals: [photos.a, photos.b] },
        { image: images.two, people: [C, D], originals: [photos.c, null] },
      ],
      pointsPerPerson: 1,
      bonusForBoth: 0,
    })
    expect(seen(photos)).toEqual([])
    expect(seen(images)).toEqual([])
    hostAct(p, { type: 'wall', from: 'lobby' })
    expect(seen(images)).toEqual([])
    hostAct(p, { type: 'ask', n: 1 })
    // Asked: its image reaches the room now (the TV loads it during the suspense), and only its.
    expect(seen(images)).toEqual(['one'])
    lock(p, 1, e, [A, B])
    lock(p, 1, f, [A, C])
    lock(p, 1, a, [C, D])
    expect(seen(photos)).toEqual([])
    // The reveal hands the TV #1's two photos, in the people's order, and nobody else's.
    hostAct(p, { type: 'reveal', n: 1 }, ['p1'])
    expect(seen(photos)).toEqual(['a', 'b'])
    expect(roomOf(p).pictures[0].revealed?.originals).toEqual([photos.a, photos.b])
    expect(canonicalJson(p.game(GAME).views)).not.toContain('secret-')
    wakeUp(p)
    expect(seen(images)).toEqual(['one'])
    hostAct(p, { type: 'ask', n: 2 })
    expect(seen(images)).toEqual(['one', 'two'])
    expect(seen(photos)).toEqual(['a', 'b'])
    hostAct(p, { type: 'reveal', n: 2 }, ['p2'])
    expect(seen(photos)).toEqual(['a', 'b', 'c'])
    expect(roomOf(p).pictures[1].revealed?.originals).toEqual([photos.c, null])
  })

  it('handles a guest who joins late and locks in, and one who leaves', () => {
    const { p, ids, names } = party(5)
    startParty(p, { pictures: [{ people: [names[0], names[1]] }, { people: [names[2], names[3]] }], pointsPerPerson: 1, bonusForBoth: 0 })
    hostAct(p, { type: 'ask', n: 1 })
    const late = p.addPlayer('Late')
    p.sync(GAME)
    expect(readView(p.game(GAME).views[late.id])).toEqual({ points: 0, rank: null, hits: {} })
    lock(p, 1, late.id, [names[0], names[1]]) // a late guest can lock in
    lock(p, 1, ids[4], [names[0], names[1]])
    p.removePlayer(ids[4]) // removed before the reveal: their lock goes with them
    p.sync(GAME)
    p.removePlayer(ids[1]) // someone in picture 1 leaves; the print still shows them
    p.sync(GAME)
    expect(hostAct(p, { type: 'reveal', n: 1 }, ['p1']).kind).toBe('commit')
    expect(roomOf(p).pictures[0].revealed).toMatchObject({ names: ['Guest 1', 'Guest 2'], both: 1, voters: 1 })
    expect(p.game(GAME).scores).toEqual({ [late.id]: 2 })
  })

  it('ends by the host while a picture is asked: the crown from the points so far, that picture secret', () => {
    const { p, ids, names } = party(6)
    startParty(p, { pictures: [{ people: [names[0], names[1]] }, { people: [names[2], names[3]] }], pointsPerPerson: 1, bonusForBoth: 0 })
    hostAct(p, { type: 'ask', n: 1 })
    lock(p, 1, ids[4], [names[0], names[1]])
    hostAct(p, { type: 'reveal', n: 1 }, ['p1'])
    hostAct(p, { type: 'wall', from: 'reveal', n: 1 })
    hostAct(p, { type: 'ask', n: 2 })
    lock(p, 2, ids[5], [names[2], names[3]])
    expect(p.send(p.hostUser, { type: 'end', gameId: GAME }).kind).toBe('commit')
    expect(p.game(GAME)).toMatchObject({ status: 'finished', finishedBy: 'host', winners: [ids[4]], scores: { [ids[4]]: 2 } })
    expect(p.promptsOf(GAME).find((x) => x.key === 'p2')).toMatchObject({ revealedAt: null })
    expect(p.promptsOf(GAME).find((x) => x.key === 'p2')!.closedAt).not.toBeNull()
    expect(roomOf(p).phase).toBe('done')
    expect(roomOf(p).pictures[1]).toMatchObject({ asked: false, revealed: null })
  })

  it('keeps its contract over a hand-written round with a join and a leave', () => {
    const roster = simulateParty({ games: [game], players: 6 }).players.map((pl) => pl.name)
    const choice = (x: number, y: number) => ({ choice: [roster[x], roster[y]].sort() })
    const example: ContractExample = {
      config: { pictures: [{ people: [roster[0], roster[1]] }, { label: 'Viking' }, {}], pointsPerPerson: 1, bonusForBoth: 1, seconds: 10 },
      players: 6,
      steps: [
        { kind: 'host', action: { type: 'wall', from: 'lobby' } },
        { kind: 'host', action: { type: 'wall', from: 'lobby' } },
        { kind: 'host', action: { type: 'ask', n: 2 } },
        { kind: 'host', action: { type: 'ask', n: 1 } },
        { kind: 'answer', player: 2, key: 'p1', answer: choice(0, 1) },
        { kind: 'answer', player: 3, key: 'p1', answer: choice(0, 4) },
        { kind: 'answer', player: 0, key: 'p1', answer: choice(1, 2) },
        { kind: 'join' },
        { kind: 'answer', player: 6, key: 'p1', answer: choice(0, 1) },
        { kind: 'host', action: { type: 'ask', n: 1 } },
        { kind: 'host', action: { type: 'setKey', n: 2, people: [roster[2], 'Tilde'] } },
        { kind: 'tick', ms: 5_000 },
        { kind: 'sync' },
        { kind: 'tick', ms: 7_000 },
        { kind: 'sync' },
        { kind: 'host', action: { type: 'reveal', n: 1 }, close: ['p1'] },
        { kind: 'leave', player: 3 },
        { kind: 'tick', ms: 10_000 },
        { kind: 'sync' },
        { kind: 'host', action: { type: 'ask', n: 2 } },
        { kind: 'answer', player: 4, key: 'p2', answer: choice(2, 3) },
        { kind: 'host', action: { type: 'finish' } },
        { kind: 'host', action: { type: 'reveal', n: 2 }, close: ['p2'] },
        { kind: 'host', action: { type: 'wall', from: 'reveal', n: 2 } },
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
    // It asks the first picture from the lobby, all four (Reveal now once everyone has locked in), and crowns the detective by itself: no End needed.
    expect(hostSteps[0]).toBe('ask')
    expect(hostSteps.filter((type) => type === 'ask')).toHaveLength(BOT_PICTURES)
    expect(hostSteps.at(-1)).toBe('finish')
    expect(steps.some((s) => s.kind === 'end')).toBe(false)
    expect(steps.some((s) => s.kind === 'join') && steps.some((s) => s.kind === 'leave')).toBe(true)
    expect(checkGameContract(game, result.example)).toEqual([])
  })
})

describe('races, the quiz’s way', () => {
  /** A party at picture #1 asked, with one lock in. */
  function asking() {
    const { p, ids, names } = party(6)
    const pair = (x: number, y: number) => ({ people: [names[x], names[y]] })
    startParty(p, { pictures: [pair(0, 1), pair(2, 3), pair(4, 5)], pointsPerPerson: 1, bonusForBoth: 0 })
    hostAct(p, { type: 'ask', n: 1 })
    lock(p, 1, ids[2], [names[0], names[1]])
    return { p, ids, names }
  }
  /** The same, revealed. */
  function revealing() {
    const { p, ids, names } = asking()
    hostAct(p, { type: 'reveal', n: 1 }, ['p1'])
    return { p, ids, names }
  }

  it('the countdown ends as the host taps Reveal now: the host first, then the timer is skipped', () => {
    const { p } = asking()
    p.tick(SUSPENSE_MS + 31_250)
    expect(hostAct(p, { type: 'reveal', n: 1 }, ['p1']).kind).toBe('commit')
    expect(p.sync(GAME).kind).toBe('skip')
    expect(roomOf(p).pictures[0].revealed).toMatchObject({ both: 1, voters: 1 })
  })

  it('the countdown ends as the host taps Reveal now: the timer first, then the tap is skipped', () => {
    const { p } = asking()
    expect(wakeUp(p).kind).toBe('commit')
    expect(hostAct(p, { type: 'reveal', n: 1 }, ['p1']).kind).toBe('skip')
    expect(p.game(GAME).scores).toEqual({ [p.players[2].id]: 2 })
  })

  it('the reveal’s 10 s end as the host taps Back to the wall: the second is skipped', () => {
    const first = revealing()
    expect(wakeUp(first.p).kind).toBe('commit')
    expect(hostAct(first.p, { type: 'wall', from: 'reveal', n: 1 }).kind).toBe('skip')
    const second = revealing()
    second.p.tick(REVEAL_HOLD_MS)
    expect(hostAct(second.p, { type: 'wall', from: 'reveal', n: 1 }).kind).toBe('commit')
    expect(second.p.sync(GAME).kind).toBe('skip')
  })

  it('the reveal’s 10 s end as the host taps Skip the wall: the ask applies either way', () => {
    const timerFirst = revealing()
    expect(wakeUp(timerFirst.p).kind).toBe('commit')
    expect(hostAct(timerFirst.p, { type: 'ask', n: 2 }).kind).toBe('commit')
    expect(roomOf(timerFirst.p).current).toMatchObject({ n: 2 })
    const askFirst = revealing()
    askFirst.p.tick(REVEAL_HOLD_MS)
    expect(hostAct(askFirst.p, { type: 'ask', n: 2 }).kind).toBe('commit')
    expect(askFirst.p.sync(GAME).kind).toBe('skip')
    expect(roomOf(askFirst.p)).toMatchObject({ phase: 'asking', current: { n: 2 } })
  })

  it('the lobby’s Show the wall first as the host asks #1: the ask applies either way, the wall step is skipped', () => {
    const { p, names } = party(4)
    startParty(p, { pictures: [{ people: [names[0], names[1]] }], pointsPerPerson: 1, bonusForBoth: 0 })
    expect(hostAct(p, { type: 'ask', n: 1 }).kind).toBe('commit')
    expect(hostAct(p, { type: 'wall', from: 'lobby' }).kind).toBe('skip')
  })

  it('a double tap on Ask: the second is skipped', () => {
    const { p } = revealing()
    expect(hostAct(p, { type: 'ask', n: 2 }).kind).toBe('commit')
    expect(hostAct(p, { type: 'ask', n: 2 }).kind).toBe('skip')
    expect(p.promptsOf(GAME).map((x) => x.key)).toEqual(['p1', 'p2'])
  })

  it('two hosts ask different pictures: the second is told to reveal the first', () => {
    const { p } = revealing()
    expect(hostAct(p, { type: 'ask', n: 2 }).kind).toBe('commit')
    expect(hostAct(p, { type: 'ask', n: 3 })).toMatchObject({ kind: 'refuse', status: 400, message: 'Reveal #2 first' })
  })

  it('a sync before the wake time finds nothing due', () => {
    const { p } = asking()
    p.tick(SUSPENSE_MS + 20_000)
    expect(p.sync(GAME).kind).toBe('skip')
    expect(roomOf(p).phase).toBe('asking')
  })

  it('a lock at 29.9 s of the countdown counts; one past the grace second is refused; a second lock is refused', () => {
    const { p, ids, names } = asking()
    lock(p, 1, ids[3], [names[0], names[5]], 29_900)
    lock(p, 1, ids[4], [names[0], names[1]], 30_999)
    expect(() => lock(p, 1, ids[5], [names[0], names[1]], 31_000)).toThrow('Too late, answers are closed')
    expect(() => lock(p, 1, ids[2], [names[0], names[5]])).toThrow('You already answered')
    expect(wakeUp(p).kind).toBe('commit')
    expect(roomOf(p).pictures[0].revealed).toMatchObject({ both: 2, one: 1, voters: 3 })
  })

  it('a lock during the suspense counts too: the guess is open from the ask, the phone shows its picker once the picture is in', () => {
    const { p, ids, names } = asking()
    lock(p, 1, ids[3], [names[0], names[1]], -SUSPENSE_MS + 500)
    expect(p.talliesOf(GAME)).toEqual({ p1: 2 })
  })
})

describe('the bot', () => {
  it('makes four pictures from pairs of the first eight players, 10 s to guess: ids, as settings from before names, read as names at the start', () => {
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
      seconds: 10,
    })
    expect(game.parseConfig({ ...game.defaultConfig, ...bot.settings!(['a', 'b', 'c']) }).pictures).toHaveLength(4)
    expect(game.parseConfig({ ...game.defaultConfig, ...bot.settings!(['solo']) }).pictures[0]).toEqual({ label: '#1' })
    const { p, ids: party6 } = party(6)
    startParty(p, bot.settings!(party6))
    expect(stateOf(p).key[1]).toEqual(['Guest 1', 'Guest 2'])
  })

  it('locks in on every picture asked once it is in on the TV, the two in it too, with two names offered but its own, and only once', () => {
    const { p, ids, names } = party(6)
    startParty(p, bot.settings!(ids))
    const random = () => 0 // always now
    expect(bot.move(botSight(p, GAME, ids[4], random))).toBeNull() // the lobby
    hostAct(p, { type: 'ask', n: 1 })
    expect(bot.move(botSight(p, GAME, ids[4], random))).toBeNull() // the TV's suspense: no picker yet
    p.tick(SUSPENSE_MS)
    const inIt = bot.move(botSight(p, GAME, ids[0], random)) // in #1: guesses all the same
    expect(inIt).toMatchObject({ kind: 'answer', key: 'p1' })
    const move = bot.move(botSight(p, GAME, ids[4], random))
    expect(move).toMatchObject({ kind: 'answer', key: 'p1' })
    if (move?.kind !== 'answer' || inIt?.kind !== 'answer') throw new Error('No lock')
    const picked = (move.answer as { choice: string[] }).choice
    expect(picked).toHaveLength(2)
    expect(picked).not.toContain(names[4])
    expect(picked.every((name) => names.includes(name))).toBe(true)
    expect((inIt.answer as { choice: string[] }).choice).not.toContain(names[0])
    p.submit(GAME, move.key, ids[4], move.answer)
    expect(bot.move(botSight(p, GAME, ids[4], random))).toBeNull() // locked in already
    p.tick(10_000)
    expect(bot.move(botSight(p, GAME, ids[5], random))).toBeNull() // time's up
  })

  it('spreads its locks over the countdown', () => {
    const { p, ids } = party(6)
    startParty(p, bot.settings!(ids))
    hostAct(p, { type: 'ask', n: 1 })
    p.tick(SUSPENSE_MS)
    // 10 s left: a chance of one in ten each second.
    expect(bot.move(botSight(p, GAME, ids[4], () => 0.2))).toBeNull()
    expect(bot.move(botSight(p, GAME, ids[4], () => 0.05))).not.toBeNull()
    p.tick(9_500) // the last second always locks in
    expect(bot.move(botSight(p, GAME, ids[4], () => 0.99))).not.toBeNull()
  })

  it('runs the host’s steps: ask the first from the lobby, Reveal now when everyone is in, the wall, ask after a pause, crown', () => {
    const { p, ids, names } = party(4)
    startParty(p, { ...bot.settings!(ids), pictures: [{ label: '#1', people: [names[0], names[1]] }, { label: '#2' }] })
    const next = () => bot.hostMove!(hostBotSight(p, GAME, () => 0.5) as HostBotSight)
    // No showing: straight to the first picture.
    expect(next()).toEqual({ action: { type: 'ask', n: 1 } })
    hostAct(p, { type: 'ask', n: 1 })
    expect(next()).toBeNull()
    lock(p, 1, ids[2], [names[0], names[1]])
    lock(p, 1, ids[3], [names[0], names[2]])
    lock(p, 1, ids[0], [names[1], names[3]])
    expect(next()).toBeNull() // one still to lock in: the two in it guess too
    lock(p, 1, ids[1], [names[0], names[2]])
    expect(next()).toEqual({ action: { type: 'reveal', n: 1 }, close: ['p1'] })
    hostAct(p, { type: 'reveal', n: 1 }, ['p1'])
    expect(next()).toBeNull() // the reveal holds the TV
    p.tick(REVEAL_HOLD_MS + 5_000)
    expect(next()).toEqual({ action: { type: 'wall', from: 'reveal', n: 1 } })
    // As it should be: the timer brings the wall, and the host waits a moment on it.
    const timely = party(4)
    startParty(timely.p, { ...bot.settings!(timely.ids), pictures: [{ label: '#1', people: [timely.names[0], timely.names[1]] }, { label: '#2' }] })
    hostAct(timely.p, { type: 'ask', n: 1 })
    hostAct(timely.p, { type: 'reveal', n: 1 }, ['p1'])
    expect(wakeUp(timely.p).kind).toBe('commit')
    const later = () => bot.hostMove!(hostBotSight(timely.p, GAME, () => 0.5) as HostBotSight)
    expect(later()).toBeNull()
    timely.p.tick(2_900)
    expect(later()).toBeNull()
    timely.p.tick(100)
    expect(later()).toMatchObject({ action: { type: 'setKey', n: 2 } })

    p.sync(GAME)
    // #2 has nobody set: the host types two names first, then asks it.
    expect(next()).toEqual({ action: { type: 'setKey', n: 2, people: [names[0], names[1]] } })
    hostAct(p, { type: 'setKey', n: 2, people: [names[0], names[1]] })
    expect(next()).toEqual({ action: { type: 'ask', n: 2 } })
    hostAct(p, { type: 'ask', n: 2 })
    p.tick(SUSPENSE_MS + 10_000 + GRACE_MS + WAKE_MARGIN_MS + 5_000)
    expect(next()).toEqual({ action: { type: 'reveal', n: 2 }, close: ['p2'] })
    hostAct(p, { type: 'reveal', n: 2 }, ['p2'])
    hostAct(p, { type: 'wall', from: 'reveal', n: 2 })
    p.tick(REVEAL_HOLD_MS + 3_000)
    expect(next()).toEqual({ action: { type: 'finish' } })
  })

  it('leaves a round of the background version alone', () => {
    expect(
      bot.hostMove!({ players: [], publicState: null, prompts: [], now: 0, random: () => 0, state: { phase: 'locked' }, config: config(), tallies: {} }),
    ).toBeNull()
  })

  it('crowns a face detective in a party of 45', () => {
    const p = simulateParty({ games: [new FusionGame()], players: 45 })
    const ids = p.players.map((pl) => pl.id)
    p.addGame(GAME, 'fusion', 'Who is fused?', bot.settings!(ids))
    p.send(p.hostUser, { type: 'start', gameId: GAME })
    const random = seededRandom(3)
    for (let second = 0; second < 300 && p.game(GAME).status === 'active'; second++) {
      for (const id of ids) {
        const move = bot.move(botSight(p, GAME, id, random))
        if (move?.kind === 'answer') p.submit(GAME, move.key, id, move.answer)
      }
      const hostMove = bot.hostMove!(hostBotSight(p, GAME, random))
      if (hostMove) hostAct(p, hostMove.action, hostMove.close)
      p.tick(1000)
      const due = p.game(GAME).wakeAt
      if (due !== null && due <= p.now) p.sync(GAME)
    }
    const final = p.game(GAME)
    expect(final.status).toBe('finished')
    expect(final.winners.length).toBeGreaterThan(0)
    const room = roomOf(p) as FusionPublicState
    expect(room.pictures.every((x) => x.revealed !== null)).toBe(true)
    // Everyone locked in on every picture, the two in it too.
    expect(room.pictures.map((x) => x.revealed!.voters)).toEqual([45, 45, 45, 45])
    expect(stateOf(p).phase).toBe('done')
  })
})

describe('recap', () => {
  function finishedRound(reveal: number[]) {
    const { p, ids, names } = party(8)
    const [A, B, C, D, E, F, G] = names
    const [, , c, , e, f, g] = ids
    startParty(p, {
      pictures: [{ people: [A, B] }, { label: 'Viking', people: [C, D] }, { people: [E, F] }],
      pointsPerPerson: 1,
      bonusForBoth: 0,
    })
    const locks: Record<number, [PlayerId, string[]][]> = {
      1: [e, f, g].map((voter) => [voter, [A, B]]),
      2: [
        [e, [C, D]],
        [f, [A, G]],
        [g, [A, B]],
        [c, [D, E]], // in the picture: names the other one, and scores it
      ],
    }
    for (const n of reveal) {
      hostAct(p, { type: 'ask', n })
      for (const [voter, choice] of locks[n] ?? []) lock(p, n, voter, choice)
      hostAct(p, { type: 'reveal', n }, [pictureKey(n)])
      hostAct(p, { type: 'wall', from: 'reveal', n })
    }
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
    expect(game.recap(recapOf(p))).toEqual([
      expect.objectContaining({ title: 'Sharpest eye: Guest 5', detail: '4 points', players: [ids[4]], weight: 'headline' }),
      expect.objectContaining({
        title: 'Best disguise: Viking fooled the room',
        detail: 'Only 1 of 4 saw Guest 3 and Guest 4',
        players: [ids[2], ids[3]],
        at: expect.any(Number),
      }),
      expect.objectContaining({ title: 'Perfect eye: Guest 5', players: [ids[4]] }),
    ])
  })

  it('counts a perfect eye on a picture you are in as the other one right: your own name is never offered', () => {
    const { p, ids, names } = party(4)
    const [A, B, C, D] = names
    startParty(p, { pictures: [{ people: [A, B] }, { people: [C, D] }], pointsPerPerson: 1, bonusForBoth: 0 })
    hostAct(p, { type: 'ask', n: 1 })
    lock(p, 1, ids[0], [B, C]) // in it: Bo is everything she could get
    lock(p, 1, ids[2], [A, B])
    hostAct(p, { type: 'reveal', n: 1 }, ['p1'])
    hostAct(p, { type: 'ask', n: 2 })
    lock(p, 2, ids[0], [C, D])
    lock(p, 2, ids[2], [D, A]) // in it: Dee, everything he could get
    hostAct(p, { type: 'reveal', n: 2 }, ['p2'])
    hostAct(p, { type: 'finish' })
    const perfect = game.recap(recapOf(p)).find((h) => h.title.startsWith('Perfect eye'))
    expect(perfect).toMatchObject({ title: 'Perfect eye: Guest 1 and Guest 3', players: [ids[0], ids[2]] })
  })

  it('asks for both names for a perfect eye in teams, where your own counts, and scores a team as one through the engine', () => {
    const { p, ids, names } = party(4)
    const [A, B, C, D] = names
    const [gold] = p.makeTeams(2)
    for (const id of ids) p.setTeam(id, null)
    p.setTeam(ids[0], gold.id)
    p.setTeam(ids[1], gold.id)
    p.addGame(GAME, 'fusion', 'Who is fused?', { seconds: 30, pictures: [{ people: [A, B] }, { people: [C, D] }], pointsPerPerson: 1, bonusForBoth: 0 })
    expect(p.setTeamPlay(GAME, true)).toBe(true)
    expect(p.send(p.hostUser, { type: 'start', gameId: GAME }).kind).toBe('commit')
    expect(stateOf(p).teamPlay).toBe(true)
    hostAct(p, { type: 'ask', n: 1 })
    lock(p, 1, ids[0], [A, B]) // Guest 1 names herself and her teammate, for both of them
    lock(p, 1, ids[2], [A, C])
    hostAct(p, { type: 'reveal', n: 1 }, ['p1'])
    expect(stateOf(p).results[1].hits).toEqual({ [ids[0]]: 2, [ids[1]]: 2, [ids[2]]: 1 })
    hostAct(p, { type: 'ask', n: 2 })
    lock(p, 2, ids[0], [C, D])
    lock(p, 2, ids[2], [C, D]) // in it: Guest 3's own name counts in teams, so both are right
    hostAct(p, { type: 'reveal', n: 2 }, ['p2'])
    hostAct(p, { type: 'finish' })
    const perfect = game.recap(recapOf(p)).find((h) => h.title.startsWith('Perfect eye'))
    // Guest 3 named only one of picture 1: in teams the other was there to get.
    expect(perfect).toMatchObject({ title: 'Perfect eye: Guest 1 and Guest 2', players: [ids[0], ids[1]] })
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

// Names, not the guest list (docs/engine-v2.md, 8.4): who is in a picture is
// two typed names. The list only helps spell them; a picture may be of a
// guest the host listed who never joins (Zelda), or of a name on no list at
// all (Tilde), and a guess names them like anyone. Settings saved with ids
// still start, as names.

describe('names, not the guest list', () => {
  const GUESTS = [
    ...PLAYERS.map((id) => ({ id, name: id, joined: true })),
    { id: 'f1c7a000-0000-4000-8000-000000000001', name: 'Zelda', joined: false },
    { id: 'f1c7a000-0000-4000-8000-000000000002', name: 'Quentin', joined: false },
  ]
  const ZELDA_ID = GUESTS[6].id
  const listed = (overrides: Overrides = {}): Overrides => ({ guests: GUESTS, ...overrides })
  const withZelda = (overrides: Partial<FusionConfig> = {}) =>
    config({
      pictures: [
        // Zelda by her id, as settings saved before names held her.
        { label: '#1', people: ['ana', ZELDA_ID], originals: ['s/g/ana.jpg', 's/g/zelda.jpg'] },
        { label: '#2', people: ['cy', 'Tilde'] },
        { label: 'The viking' },
      ],
      ...overrides,
    })
  const startListed = (cfg = withZelda()) => run((ctx) => game.setup(ctx), listed(), cfg)
  const hostListed = (state: FusionState, action: unknown, overrides: Overrides = {}, cfg = withZelda()) =>
    host(state, action, listed(overrides), cfg)
  const pubListed = (state: FusionState, cfg = withZelda()) => game.publicState(state, testInfo(cfg, PLAYERS, { guests: GUESTS }))

  it('starts with a picture of a guest who has not joined, and one of a name on no list, all as names', () => {
    const { result: state } = startListed()
    expect(state.key).toEqual({ 1: ['ana', 'Zelda'], 2: ['cy', 'Tilde'] })
    expect(canonicalJson(state)).not.toContain(ZELDA_ID)
  })

  it('refuses only an id on no list any more: removed from the guest list since', () => {
    const cfg = withZelda({ pictures: [{ label: '#1', people: ['ana', 'f1c7a000-0000-4000-8000-000000000099'] }] })
    expect(() => run((ctx) => game.setup(ctx), listed(), cfg)).toThrow(
      "#1 names someone who isn't on the guest list any more. Type their name in the settings.",
    )
  })

  it('types a key on the night with any name (Show who)', () => {
    const state = startListed().result
    const changed = hostListed(state, { type: 'setKey', n: 3, people: ['Quentin', 'Viggo'] }).result
    expect(changed.key[3]).toEqual(['Quentin', 'Viggo'])
  })

  it('gives the room no list of who is expected: the names to guess come with each picture’s guess', () => {
    const state = startListed().result
    const room = pubListed(state)
    expect(room).not.toHaveProperty('expected')
    for (const picture of room.pictures) expect(picture.revealed).toBeNull()
    expect(canonicalJson(room)).not.toMatch(/Zelda|Tilde|ana|Quentin/)
    // The guess offers everyone here and every name in the pictures; a listed guest in no picture is not among them.
    expect(guessNames(state, testInfo(withZelda(), PLAYERS))).toEqual(['ana', 'bo', 'cy', 'dee', 'eve', 'fin', 'Tilde', 'Zelda'])
  })

  it('asks and reveals a picture of a guest who never came, with her name and own photo; everyone here scores', () => {
    const asking = hostListed(startListed().result, { type: 'ask', n: 1 }, { now: 10_000 }).result
    const locks = closedWith(1, 10_000, [
      ['bo', ['ana', 'Zelda']],
      ['cy', ['ana', 'eve']],
      ['ana', ['Zelda', 'bo']], // in it: names Zelda, and scores
      ['zelda', ['ana', 'bo']], // a lock from someone not here (crafted): counts for nothing
    ], 20_000)
    const { result: revealedState, effects } = hostListed(asking, { type: 'reveal', n: 1 }, locks)
    expect(revealedState.totals).toEqual({ bo: 2, cy: 1, ana: 1 })
    expect(revealedState.results[1]).toMatchObject({ both: 1, one: 2, none: 0, voters: 3 })
    // The log's about names only the guest here.
    expect(effects.records[0]).toMatchObject({ type: 'revealed', about: ['ana'] })
    expect(pubListed(revealedState).pictures[0].revealed).toMatchObject({
      names: ['ana', 'Zelda'],
      originals: ['s/g/ana.jpg', 's/g/zelda.jpg'],
      voters: 3,
    })
    // Read by a room that doesn't have Zelda on the list any more: the key is her name.
    expect(pub(revealedState, PLAYERS, withZelda()).pictures[0].revealed?.names).toEqual(['ana', 'Zelda'])
  })

  it('lets a guest who left take nothing with them: their points and hits go, the counts and the key stay', () => {
    const reveal = revealed(1, [['cy', ['ana', 'bo']], ['dee', ['ana', 'eve']], ['eve', ['ana', 'bo']]]).result
    expect(reveal.totals).toEqual({ cy: 2, dee: 1, eve: 2 })
    const left = game.onPlayerLeave(reveal, 'cy')
    expect(left.totals).toEqual({ dee: 1, eve: 2 })
    expect(left.results[1].hits).toEqual({ dee: 1, eve: 2 })
    expect(left.results[1]).toMatchObject({ both: 2, one: 1, none: 0, voters: 3 })
    expect(left.key).toEqual(reveal.key)
    // Someone in the picture who leaves keeps the key: it names the people in the picture.
    const inIt = game.onPlayerLeave(reveal, 'ana')
    expect(inIt).toBe(reveal)
    // Someone with nothing in the round changes nothing.
    expect(game.onPlayerLeave(start().result, 'fin')).toEqual(start().result)
  })

  it('names a guest who never came in the recap from the key, and leaves them out of its people', () => {
    const { p, ids, names } = party(6)
    const [a, b, c, d] = ids
    const [A, B, C, D] = names
    startParty(p, { pictures: [{ people: [A, 'Zelda'] }], pointsPerPerson: 1, bonusForBoth: 0 })
    hostAct(p, { type: 'ask', n: 1 })
    lock(p, 1, b, [A, C])
    lock(p, 1, c, [A, D])
    lock(p, 1, d, [B, C])
    hostAct(p, { type: 'reveal', n: 1 }, ['p1'])
    hostAct(p, { type: 'finish' })
    const disguise = game.recap(recapOf(p)).find((h) => h.title.startsWith('Best disguise'))
    expect(disguise).toMatchObject({ detail: 'Nobody saw Guest 1 and Zelda', players: [a] })
  })
})

describe('a party where a picture is of someone who never came', () => {
  it('asks it, takes guesses that name her, reveals it with her name and own photo, and scores everyone here', () => {
    const { p, ids, names } = party(6)
    const [a, , , d, e, f] = ids
    const [A, B, C] = names
    const zelda = p.listGuest('Zelda') // listed, never joins
    p.listGuest('Quentin') // listed, never joins, in no picture
    const photo = 's/g/secret-zelda.jpg'
    startParty(p, {
      pictures: [
        // Zelda by her id, as settings saved before names held her; Tilde typed, on no list.
        { people: [a, zelda.id], originals: [null, photo] },
        { people: [B, 'Tilde'] },
      ],
      pointsPerPerson: 1,
      bonusForBoth: 1,
    })
    // Everything a phone or the TV reads.
    const screens = () =>
      canonicalJson({
        room: p.game(GAME).publicState,
        views: p.game(GAME).views,
        prompts: p.promptsOf(GAME),
        feed: p.feed,
        data: p.sessionData,
        players: p.players,
        tallies: p.talliesOf(GAME),
      })
    expect(screens()).not.toContain(photo)
    expect(screens()).not.toContain(zelda.id)
    expect(p.players.map((pl) => pl.id)).not.toContain(zelda.id)

    expect(hostAct(p, { type: 'ask', n: 1 }).kind).toBe('commit')
    // The names to guess: everyone here and every name in the pictures, never the listed Quentin, in no picture.
    expect(p.promptsOf(GAME)[0].spec).toEqual(voteSpec([...names, 'Tilde', 'Zelda']))
    lock(p, 1, d, [A, 'Zelda']) // both right, naming someone who never came
    lock(p, 1, e, [A, 'Tilde']) // one right
    lock(p, 1, f, [B, C]) // none
    lock(p, 1, a, ['Zelda', B]) // in the picture: Zelda is right
    expect(() => lock(p, 1, ids[1], [A, 'Quentin'])).toThrow('That is not one of the options')
    expect(() => p.submit(GAME, 'p1', zelda.id, { choice: [A, B] })).toThrow() // not here: no phone can answer for her
    // Before the reveal: no key, no photo.
    expect(screens()).not.toContain(photo)
    expect(canonicalJson(roomOf(p).pictures)).not.toContain('Zelda')
    expect(canonicalJson(p.game(GAME).views)).not.toContain('Zelda')

    expect(hostAct(p, { type: 'reveal', n: 1 }, ['p1']).kind).toBe('commit')
    expect(roomOf(p).pictures[0].revealed).toMatchObject({
      names: ['Guest 1', 'Zelda'],
      originals: [null, photo],
      both: 1,
      one: 2,
      none: 1,
      voters: 4,
    })
    expect(p.game(GAME).scores).toEqual({ [d]: 3, [e]: 1, [a]: 1 })
    expect(readView(p.game(GAME).views[d])).toMatchObject({ points: 3, hits: { 1: 2 } })
    expect(readView(p.game(GAME).views[a])).toMatchObject({ points: 1, hits: { 1: 1 } })
    expect(p.game(GAME).views).not.toHaveProperty(zelda.id)

    wakeUp(p)
    hostAct(p, { type: 'ask', n: 2 })
    lock(p, 2, d, [B, 'Tilde'])
    hostAct(p, { type: 'reveal', n: 2 }, ['p2'])
    expect(roomOf(p).pictures[1].revealed).toMatchObject({ names: ['Guest 2', 'Tilde'], both: 1 })
    expect(hostAct(p, { type: 'finish' }).kind).toBe('commit')
    expect(p.game(GAME)).toMatchObject({ status: 'finished', winners: [d], scores: { [d]: 6, [e]: 1, [a]: 1 } })
    expect(p.game(GAME).scores).not.toHaveProperty(zelda.id)
  })

  it('lets a guest in a picture who arrives mid-round guess it and score like anyone, matched by her name', () => {
    const { p, ids, names } = party(5)
    const [, , , d] = ids
    const [A, B, C] = names
    const zelda = p.listGuest('Zelda')
    startParty(p, { pictures: [{ people: [A, 'zelda'] }, { people: [B, C] }], pointsPerPerson: 1, bonusForBoth: 0 })
    hostAct(p, { type: 'ask', n: 1 })
    p.claimGuest(zelda.id) // she arrives while her own picture is asked
    p.sync(GAME)
    expect(readView(p.game(GAME).views[zelda.id])).toEqual({ points: 0, rank: null, hits: {} })
    lock(p, 1, zelda.id, [A, B]) // she knows herself: Ana is right
    lock(p, 1, d, [A, 'zelda'])
    hostAct(p, { type: 'reveal', n: 1 }, ['p1'])
    expect(roomOf(p).pictures[0].revealed).toMatchObject({ names: ['Guest 1', 'zelda'], voters: 2, both: 1, one: 1 })
    expect(p.game(GAME).scores).toEqual({ [d]: 2, [zelda.id]: 1 })
    wakeUp(p)
    hostAct(p, { type: 'ask', n: 2 })
    lock(p, 2, zelda.id, [B, C])
    hostAct(p, { type: 'reveal', n: 2 }, ['p2'])
    expect(p.game(GAME).scores).toEqual({ [d]: 2, [zelda.id]: 3 })
  })

  it('gives a freed name taken again nothing from the round, and the picture still names the person by name', () => {
    const { p, ids, names } = party(5)
    const [, , , d] = ids
    const [A, B, C] = names
    const zelda = p.listGuest('Zelda')
    p.claimGuest(zelda.id)
    startParty(p, { pictures: [{ people: [A, B] }, { people: [C, 'Zelda'] }], pointsPerPerson: 1, bonusForBoth: 0 })
    hostAct(p, { type: 'ask', n: 1 })
    lock(p, 1, zelda.id, [A, B])
    lock(p, 1, d, [A, C])
    hostAct(p, { type: 'reveal', n: 1 }, ['p1'])
    expect(p.game(GAME).scores).toEqual({ [zelda.id]: 2, [d]: 1 })
    p.tick(1000)
    p.freeGuest(zelda.id) // the wrong phone had her name
    p.sync(GAME)
    expect(p.game(GAME).scores).toEqual({ [d]: 1 })
    expect(stateOf(p).results[1].hits).toEqual({ [d]: 1 })
    p.tick(1000)
    p.claimGuest(zelda.id) // the real Zelda takes her name
    p.sync(GAME)
    expect(p.game(GAME).scores).toEqual({ [d]: 1 })
    expect(readView(p.game(GAME).views[zelda.id])).toEqual({ points: 0, rank: null, hits: {} })
    expect(stateOf(p).totals).not.toHaveProperty(zelda.id)
    // The room still saw what it saw, and her own picture still names her.
    expect(roomOf(p).pictures[0].revealed).toMatchObject({ both: 1, one: 1, voters: 2 })
    expect(stateOf(p).key[2]).toEqual([C, 'Zelda'])
    wakeUp(p)
    hostAct(p, { type: 'ask', n: 2 })
    lock(p, 2, d, [C, 'Zelda'])
    hostAct(p, { type: 'reveal', n: 2 }, ['p2'])
    expect(roomOf(p).pictures[1].revealed).toMatchObject({ names: ['Guest 3', 'Zelda'] })
    expect(p.game(GAME).scores).toEqual({ [d]: 3 })
  })
})
