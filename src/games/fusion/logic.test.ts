import { describe, expect, it } from 'vitest'
import type { HostBotSight } from '../core/bot'
import { botExample, botSight, checkGameContract, hostBotSight, type ContractExample } from '../core/contract'
import { createGameContext } from '../core/context'
import { GameError, type AnyGame, type GamePlayer, type PlayerId, type Prompt, type RecapRound } from '../core/Game'
import { canonicalJson } from '../core/runtime'
import { simulateParty, type FakeParty } from '../core/simulate'
import { answersOf, jsonbRoundTrip, seededRandom, testInfo } from '../core/testing'
import { bot, BOT_PICTURES } from './bot'
import { FusionGame, readState, type FusionConfig, type FusionState } from './logic'
import {
  GRACE_MS,
  LEGACY_MESSAGE,
  pictureKey,
  readPublic,
  readView,
  REVEAL_HOLD_MS,
  VOTE_SPEC,
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
  showSeconds: 6,
  ...overrides,
})
const PLAYERS = ['ana', 'bo', 'cy', 'dee', 'eve', 'fin']
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
  spec: VOTE_SPEC,
  openedAt,
  closesAt: openedAt + 30_000 + GRACE_MS,
  closedAt,
  revealedAt: null,
})

/** Picture n asked at `at` from a fresh lobby (or `from`). */
function asked(n: number, from: FusionState = start().result, at = 10_000, cfg = config()) {
  return host(from, { type: 'ask', n }, { now: at }, cfg).result
}

/** The info for a reveal of picture n asked at `openedAt`: its prompt closed, with these locks. */
function closedWith(n: number, openedAt: number, locks: [PlayerId, [PlayerId, PlayerId]][], now = openedAt + 31_250): Overrides {
  return {
    now,
    prompts: { [pictureKey(n)]: prompt(n, openedAt, openedAt + 31_000) },
    answers: {
      [pictureKey(n)]: answersOf(
        openedAt,
        locks.map(([voter, choice], i) => [voter, { choice: [...choice].sort() }, 100 * (i + 1)]),
      ),
    },
  }
}

/** Picture n asked at 10 s and revealed by Reveal now with these locks. */
function revealed(n: number, locks: [PlayerId, [PlayerId, PlayerId]][], from: FusionState = start().result, cfg = config()) {
  const state = asked(n, from, 10_000, cfg)
  return host(state, { type: 'reveal', n }, closedWith(n, 10_000, locks, 20_000), cfg)
}

const pub = (state: FusionState, players = PLAYERS, cfg = config()) => game.publicState(state, testInfo(cfg, players))
const view = (state: FusionState, id: PlayerId, players = PLAYERS, cfg = config()) => game.playerView(state, id, testInfo(cfg, players))

describe('settings', () => {
  const parse = (input: Record<string, unknown>) => game.parseConfig({ ...game.defaultConfig, ...input })

  it('ships the defaults: a point a person, no bonus, 30 s to guess and 6 s a picture in the showing', () => {
    expect(jsonbRoundTrip(game.defaultConfig)).toEqual({ pictures: [], pointsPerPerson: 1, bonusForBoth: 0, seconds: 30, showSeconds: 6 })
    expect(game.presentation).toBe('stage')
  })

  it('fills blank labels with the picture number and keeps images, people and times', () => {
    const parsed = parse({
      pictures: [{ label: '  ' }, { label: ' Viking ', image: 's/g/abc-1.jpg', people: ['a', 'b'] }, {}],
      pointsPerPerson: 2,
      bonusForBoth: 1,
      seconds: 45,
      showSeconds: 3,
    })
    expect(parsed).toEqual({
      pictures: [{ label: '#1' }, { label: 'Viking', image: 's/g/abc-1.jpg', people: ['a', 'b'] }, { label: '#3' }],
      pointsPerPerson: 2,
      bonusForBoth: 1,
      seconds: 45,
      showSeconds: 3,
    })
  })

  it('starts settings saved before the times existed with the defaults', () => {
    // The engine merges defaultConfig under the saved settings.
    const old = { pictures: [{ label: '#1' }], pointsPerPerson: 1, bonusForBoth: 0 }
    expect(game.parseConfig({ ...game.defaultConfig, ...old })).toMatchObject({ seconds: 30, showSeconds: 6 })
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
    [{ pictures: [{}], seconds: 9 }, 'The time to guess must be 10 to 90 seconds'],
    [{ pictures: [{}], seconds: 91 }, 'The time to guess must be 10 to 90 seconds'],
    [{ pictures: [{}], seconds: 20.5 }, 'The time to guess must be 10 to 90 seconds'],
    [{ pictures: [{}], seconds: '30' }, 'The time to guess must be 10 to 90 seconds'],
    [{ pictures: [{}], showSeconds: 2 }, 'The showing must be 3 to 20 seconds a picture'],
    [{ pictures: [{}], showSeconds: 21 }, 'The showing must be 3 to 20 seconds a picture'],
    [{ pictures: [{}], showSeconds: null }, 'The showing must be 3 to 20 seconds a picture'],
  ])('refuses %j', (input, message) => {
    expect(() => parse(input)).toThrow(GameError)
    expect(() => parse(input)).toThrow(message)
  })

  it('takes the edges of each range', () => {
    expect(parse({ pictures: [{}], seconds: 10, showSeconds: 20 })).toMatchObject({ seconds: 10, showSeconds: 20 })
    expect(parse({ pictures: [{}], seconds: 90, showSeconds: 3 })).toMatchObject({ seconds: 90, showSeconds: 3 })
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
      names: { ana: 'ana', bo: 'bo', cy: 'cy', dee: 'dee' },
      revealed: [],
      results: {},
      totals: {},
      showStartedAt: null,
      current: null,
      openedAt: null,
      endsAt: null,
      revealedAt: null,
    })
    expect(effects.prompts.open).toEqual([])
    expect(effects.announcements).toEqual([])
    expect(game.wakeAt(state, testInfo(config(), PLAYERS))).toBeNull()
  })

  it('refuses a preset key with someone who is no longer in the party', () => {
    expect(() => start(config(), ['ana', 'cy', 'dee', 'eve'])).toThrow("#1 has someone who isn't in the party")
  })

  it('takes no moves from phones: guesses are prompts', () => {
    expect(() => (game as AnyGame).parseAction({ type: 'vote' })).toThrow('This game takes guesses, not moves')
  })
})

describe('the showing', () => {
  it('starts from the lobby, and wakes for the wall when every picture has had its seconds', () => {
    const { result: state, effects } = host(start().result, { type: 'show' }, { now: 5_000 })
    expect(state).toMatchObject({ phase: 'showing', showStartedAt: 5_000 })
    expect(effects.announcements).toEqual([])
    const info = testInfo(config(), PLAYERS)
    expect(game.wakeAt(state, info)).toBe(5_000 + 3 * 6_000)
    expect(pub(state)).toMatchObject({ phase: 'showing', showing: { startedAt: 5_000, endsAt: 23_000 }, current: null })
    const walled = wake(state, { now: 23_000 }).result
    expect(walled.phase).toBe('wall')
    expect(game.wakeAt(walled, info)).toBeNull()
  })

  it('takes its seconds from the round’s settings, and the defaults for settings saved before them', () => {
    const cfg = config({ showSeconds: 3 })
    const state = host(start(cfg).result, { type: 'show' }, { now: 0 }, cfg).result
    expect(game.wakeAt(state, testInfo(cfg, PLAYERS))).toBe(9_000)
    const old = { pictures: config().pictures, pointsPerPerson: 1, bonusForBoth: 0 } as FusionConfig
    expect(game.wakeAt(state, testInfo(old, PLAYERS))).toBe(18_000)
  })

  it('does nothing a second time, or once it has moved on', () => {
    const showing = host(start().result, { type: 'show' }).result
    expect(host(showing, { type: 'show' }).result).toBe(showing)
    const wall = host(showing, { type: 'wall', from: 'showing' }).result
    expect(host(wall, { type: 'show' }).result).toBe(wall)
  })
})

describe('the wall', () => {
  it('comes from the lobby, the showing or a reveal, each by name', () => {
    const lobby = start().result
    expect(host(lobby, { type: 'wall', from: 'lobby' }).result.phase).toBe('wall')
    const showing = host(lobby, { type: 'show' }).result
    expect(host(showing, { type: 'wall', from: 'showing' }).result.phase).toBe('wall')
    const reveal = revealed(1, [['cy', ['ana', 'bo']]]).result
    const back = host(reveal, { type: 'wall', from: 'reveal', n: 1 }).result
    expect(back).toMatchObject({ phase: 'wall', current: null, revealedAt: null, revealed: [1] })
    expect(pub(back).current).toBeNull()
  })

  it('skips a stale step: the phase it names has passed, or the reveal was another picture', () => {
    const lobby = start().result
    expect(host(lobby, { type: 'wall', from: 'showing' }).result).toBe(lobby)
    const showing = host(lobby, { type: 'show' }).result
    expect(host(showing, { type: 'wall', from: 'lobby' }).result).toBe(showing)
    const reveal = revealed(1, []).result
    expect(host(reveal, { type: 'wall', from: 'reveal', n: 2 }).result).toBe(reveal)
    expect(host(reveal, { type: 'wall', from: 'showing' }).result).toBe(reveal)
    const asking = asked(2)
    expect(host(asking, { type: 'wall', from: 'reveal', n: 2 }).result).toBe(asking)
  })

  it('comes back by itself 10 s after a reveal', () => {
    const reveal = revealed(1, []).result
    expect(game.wakeAt(reveal, testInfo(config(), PLAYERS))).toBe(20_000 + REVEAL_HOLD_MS)
    expect(wake(reveal, { now: 30_000 }).result).toMatchObject({ phase: 'wall', current: null })
  })
})

describe('asking a picture', () => {
  it('opens its guess with a deadline and nothing about the answer, and counts down', () => {
    const { result: state, effects } = host(start().result, { type: 'ask', n: 1 }, { now: 10_000 })
    expect(effects.prompts.open).toEqual([{ key: 'p1', spec: VOTE_SPEC, closes_at: 10_000 + 30_000 + GRACE_MS }])
    expect(VOTE_SPEC).toEqual({ kind: 'choice', options: 'players', min: 2, max: 2, exclude_self: true, final: true })
    expect(JSON.stringify(effects.prompts)).not.toMatch(/ana|bo/)
    expect(effects.announcements).toEqual([])
    expect(state).toMatchObject({ phase: 'asking', current: 1, openedAt: 10_000, endsAt: 40_000, revealedAt: null, showStartedAt: null })
    expect(game.wakeAt(state, testInfo(config(), PLAYERS))).toBe(40_000 + GRACE_MS + WAKE_MARGIN_MS)
    expect(pub(state).current).toEqual({ n: 1, step: 1, key: 'p1', openedAt: 10_000, endsAt: 40_000, revealedAt: null })
  })

  it('takes the round’s own seconds', () => {
    const cfg = config({ seconds: 12 })
    const { result, effects } = host(start(cfg).result, { type: 'ask', n: 2 }, { now: 0 }, cfg)
    expect(result.endsAt).toBe(12_000)
    expect(effects.prompts.open[0].closes_at).toBe(13_000)
  })

  it('works from the lobby, the showing, the wall and a reveal, in any order', () => {
    const lobby = start().result
    const fromShowing = host(host(lobby, { type: 'show' }).result, { type: 'ask', n: 2 }).result
    expect(fromShowing).toMatchObject({ phase: 'asking', current: 2, showStartedAt: null })
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

  it('takes a key set on the night, then asks it', () => {
    const keyed = host(start().result, { type: 'setKey', n: 3, people: ['eve', 'fin'] }).result
    expect(host(keyed, { type: 'ask', n: 3 }).result.current).toBe(3)
  })
})

describe('the reveal', () => {
  it('scores a point per right person, and nothing for the people in the picture, even with a crafted lock', () => {
    const { result, effects } = revealed(1, [
      ['cy', ['ana', 'bo']], // both
      ['dee', ['ana', 'eve']], // one
      ['eve', ['cy', 'dee']], // none
      ['ana', ['bo', 'cy']], // in the picture: counts for nothing
      ['bo', ['ana', 'cy']], // in the picture too
    ])
    expect(result.results[1]).toEqual({ both: 1, one: 1, none: 1, voters: 3, hits: { cy: 2, dee: 1, eve: 0 }, at: 20_000 })
    expect(result.totals).toEqual({ cy: 2, dee: 1 })
    expect(result).toMatchObject({ phase: 'reveal', current: 1, revealed: [1], revealedAt: 20_000 })
    expect(effects.prompts.reveal).toEqual(['p1'])
    // No announcement: the TV and the phones show the reveal themselves.
    expect(effects.announcements).toEqual([])
    expect(effects.records).toEqual([
      { type: 'revealed', data: { n: 1, label: '#1', people: ['ana', 'bo'], both: 1, one: 1, none: 1, voters: 3 }, about: ['ana', 'bo'] },
    ])
  })

  it('adds the bonus for getting both, and points per person as configured', () => {
    const cfg = config({ pointsPerPerson: 2, bonusForBoth: 3 })
    const { result } = revealed(1, [['cy', ['ana', 'bo']], ['dee', ['bo', 'eve']]], start(cfg).result, cfg)
    expect(result.totals).toEqual({ cy: 7, dee: 2 })
  })

  it('gives the same result by Reveal now and by the timer', () => {
    const locks: [PlayerId, [PlayerId, PlayerId]][] = [['cy', ['ana', 'bo']], ['dee', ['ana', 'eve']]]
    const asking = asked(1)
    const byHost = host(asking, { type: 'reveal', n: 1 }, closedWith(1, 10_000, locks, 41_250))
    const byTimer = wake(asking, closedWith(1, 10_000, locks, 41_250))
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
    const { result, effects } = wake(asking, { now: 41_250, prompts: { p1: prompt(1, 10_000) }, answers: {} })
    expect(result).toBe(asking)
    expect(effects.prompts.close).toEqual(['p1'])
    expect(effects.records).toEqual([])
    // Already closed: nothing to do at all.
    expect(wake(asking, { now: 41_250, prompts: { p1: prompt(1, 10_000, 41_000) }, answers: {} }).effects.prompts.close).toEqual([])
    expect(host(asking, { type: 'reveal', n: 1 }, closedWith(1, 10_000, [])).result.phase).toBe('reveal')
  })

  it('still names someone in the picture who has left the party', () => {
    const asking = asked(1)
    const players = ['bo', 'cy', 'dee', 'eve', 'fin'].map((id) => ({ id, name: id.toUpperCase(), profile: {} }))
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
    [{ type: 'setKey', n: 1, people: ['ana', 'ana'] }, 'Pick two different people'],
    [{ type: 'setKey', n: 1, people: ['ana', 'zed'] }, 'Pick two people who are in the party'],
    [{ type: 'setKey', n: 1, people: ['ana'] }, 'Pick the two people in the picture'],
    [{ type: 'setKey', n: 0, people: ['ana', 'bo'] }, 'There is no such picture'],
    [{ type: 'setKey', n: '1', people: ['ana', 'bo'] }, 'There is no such picture'],
  ])('refuses %j', (action, message) => {
    expect(() => host(start().result, action)).toThrow(message)
  })
})

describe('finish', () => {
  it('crowns the face detective from any phase but a picture being asked', () => {
    const lobby = start().result
    const showing = host(lobby, { type: 'show' }).result
    const wall = host(lobby, { type: 'wall', from: 'lobby' }).result
    const reveal = revealed(1, [['cy', ['ana', 'bo']]]).result
    for (const state of [lobby, showing, wall, reveal]) {
      const { result } = host(state, { type: 'finish' })
      expect(result).toMatchObject({ phase: 'done', current: null, showStartedAt: null })
      expect(game.isFinished(result)).toBe(true)
      expect(game.wakeAt(result, testInfo(config(), PLAYERS))).toBeNull()
    }
    expect(() => host(asked(1), { type: 'finish' })).toThrow('Reveal #1 first')
  })

  it('crowns the face detective, tells them, and gives them the badge', () => {
    const reveal = revealed(1, [['cy', ['ana', 'bo']], ['dee', ['ana', 'eve']]]).result
    const players = PLAYERS.map((id): GamePlayer => ({ id, name: id, profile: id === 'cy' ? { fusion: { detective: 2 } } : {} }))
    const { result, effects } = host(reveal, { type: 'finish' }, { players })
    expect(effects.announcements).toEqual([
      expect.objectContaining({ message: 'cy has the sharpest eye!', detail: '2 points', icon: 'crown', sound: 'fanfare', interrupt: true }),
      expect.objectContaining({ message: 'You have the sharpest eye!', to: ['cy'] }),
    ])
    expect(effects.profiles).toEqual({ cy: { detective: 3 } })
    expect(effects.records).toEqual([{ type: 'crowned', data: { winners: ['cy'], points: 2 }, about: ['cy'] }])
    expect(game.winners(result, testInfo(config(), PLAYERS))).toEqual(['cy'])
  })

  it('crowns everyone tied at the top', () => {
    const reveal = revealed(1, [['cy', ['ana', 'bo']], ['dee', ['ana', 'bo']]]).result
    const { effects } = host(reveal, { type: 'finish' })
    expect(effects.announcements[0].message).toBe('cy and dee have the sharpest eyes!')
    expect(effects.announcements[1]).toMatchObject({ message: 'You share the sharpest eye!', to: ['cy', 'dee'] })
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
  it('never shows who is in a picture before its reveal, in any phase, to the room or another guest', () => {
    const lobby = start().result
    const showing = host(lobby, { type: 'show' }, { now: 1_000 }).result
    const wall = host(showing, { type: 'wall', from: 'showing' }).result
    const asking = asked(1, wall)
    const reveal = host(asking, { type: 'reveal', n: 1 }, closedWith(1, 10_000, [['eve', ['ana', 'bo']]], 20_000)).result
    const back = host(reveal, { type: 'wall', from: 'reveal', n: 1 }).result
    const asking2 = asked(2, back, 50_000)
    const done = host(back, { type: 'finish' }).result
    for (const [name, state] of Object.entries({ lobby, showing, wall, asking, reveal, back, asking2, done })) {
      const room = canonicalJson(pub(state))
      // #2 (cy and dee) is never revealed; #1 (ana and bo) only from its reveal.
      expect(room, name).not.toMatch(/"(cy|dee)"/)
      if (state.revealed.includes(1)) expect(room, name).toMatch(/"people":\["ana","bo"\]/)
      else expect(room, name).not.toMatch(/"(ana|bo)"/)
      for (const id of ['eve', 'fin', 'stranger']) {
        expect(canonicalJson(view(state, id)), `${name} ${id}`).not.toMatch(/"(ana|bo|cy|dee)"/)
        expect(view(state, id).inPicture).toBe(false)
      }
    }
    // Only the two in the picture being asked or revealed know they are in it.
    expect(['ana', 'bo', 'cy', 'dee'].filter((id) => view(asking, id).inPicture)).toEqual(['ana', 'bo'])
    expect(['ana', 'bo', 'cy', 'dee'].filter((id) => view(reveal, id).inPicture)).toEqual(['ana', 'bo'])
    expect(['ana', 'bo', 'cy', 'dee'].filter((id) => view(asking2, id).inPicture)).toEqual(['cy', 'dee'])
    expect(['ana', 'bo', 'cy', 'dee'].filter((id) => view(back, id).inPicture)).toEqual([])
  })

  it('shows the pictures, the rules and the top five with ranks', () => {
    const cfg = config({ pictures: [{ label: '#1', image: 's/g/a.jpg', people: ['ana', 'bo'] }, { label: '#2' }], bonusForBoth: 2, seconds: 20 })
    const state = { ...start(cfg).result, totals: { eve: 1, cy: 3, dee: 3, gone: 9 } }
    const room = pub(state, PLAYERS, cfg)
    expect(room.pictures).toEqual([
      { n: 1, key: 'p1', label: '#1', image: 's/g/a.jpg', revealed: null },
      { n: 2, key: 'p2', label: '#2', image: null, revealed: null },
    ])
    expect(room.rules).toEqual({ seconds: 20, showSeconds: 6, perPerson: 1, bothBonus: 2 })
    expect(room.top).toEqual([
      { playerId: 'cy', points: 3, rank: 1 },
      { playerId: 'dee', points: 3, rank: 1 },
      { playerId: 'eve', points: 1, rank: 3 },
    ])
    expect(room).toMatchObject({ phase: 'lobby', showing: null, current: null })
    expect(readPublic(jsonbRoundTrip(room))).toEqual(room)
  })

  it('gives each guest their points, their place and how they did on each revealed picture', () => {
    const reveal = revealed(1, [['cy', ['ana', 'bo']], ['eve', ['cy', 'dee']]]).result
    expect(view(reveal, 'cy')).toEqual<FusionPlayerView>({ points: 2, rank: 1, hits: { 1: 2 }, inPicture: false })
    expect(view(reveal, 'eve')).toEqual({ points: 0, rank: null, hits: { 1: 0 }, inPicture: false })
    expect(view(reveal, 'ana')).toEqual({ points: 0, rank: null, hits: {}, inPicture: true })
    expect(view(reveal, 'stranger')).toEqual({ points: 0, rank: null, hits: {}, inPicture: false })
    expect(game.scores(reveal)).toEqual({ cy: 2 })
    const info = testInfo(config(), PLAYERS)
    expect(canonicalJson(game.publicState(jsonbRoundTrip(reveal), info))).toBe(canonicalJson(game.publicState(reveal, info)))
    expect(pub(reveal).pictures[0].revealed).toEqual({
      people: ['ana', 'bo'],
      names: ['ana', 'bo'],
      both: 1,
      one: 0,
      none: 1,
      voters: 2,
      step: 1,
      at: 20_000,
    })
    expect(pub(reveal).current).toEqual({ n: 1, step: 1, key: 'p1', openedAt: 10_000, endsAt: 40_000, revealedAt: 20_000 })
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
    { type: 'setKey', n: 1, people: 'ab' },
  ])('refuses %j', (input) => {
    expect(() => game.parseHostAction(input)).toThrow(GameError)
  })

  it('keeps only what it knows', () => {
    expect(game.parseHostAction({ type: 'show', extra: 1 })).toEqual({ type: 'show' })
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
      expect(game.wakeAt(state, info)).toBeNull()
      const room = game.publicState(state, info)
      expect(room).toMatchObject({ phase: 'lobby', showing: null, current: null, rules: { seconds: 30, showSeconds: 6 } })
      expect(readPublic(jsonbRoundTrip(room))).toEqual(room)
      expect(game.playerView(state, 'ana', info)).toMatchObject({ inPicture: false })
      for (const action of [{ type: 'show' }, { type: 'ask', n: 2 }, { type: 'finish' }, { type: 'setKey', n: 2, people: ['eve', 'fin'] }]) {
        expect(() => host(state, action, {}, oldConfig)).toThrow(LEGACY_MESSAGE)
      }
      expect(wake(state, {}, oldConfig).result).toBe(state)
    }
    expect(game.publicState(legacy('locked'), testInfo(oldConfig, PLAYERS)).pictures[0].revealed).toMatchObject({ people: ['ana', 'bo'], step: 1, at: null })
    expect(game.publicState(legacy('locked'), testInfo(oldConfig, PLAYERS)).top).toEqual([{ playerId: 'cy', points: 2, rank: 1 }])
  })

  it('ends: the host’s End announces the leader, the points so far stand', () => {
    const { result, effects } = run((ctx) => game.onEnd(legacy('locked'), ctx, 'host'), {}, oldConfig)
    expect(result).toMatchObject({ phase: 'done', revealed: [1], totals: { cy: 2 }, current: null, showStartedAt: null })
    expect(game.isFinished(result)).toBe(true)
    expect(effects.announcements[0]).toMatchObject({ detail: 'cy had the sharpest eye with 2 points' })
    expect(game.winners(result, testInfo(oldConfig, PLAYERS))).toEqual(['cy'])
    expect(readState(legacy('voting'))).toMatchObject({ showStartedAt: null, current: null, openedAt: null, endsAt: null, revealedAt: null })
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
})

// Whole rounds through the in-memory party: the real step(), game_load and
// game_commit rules, submit_answer's checks, and the timers' syncs.

function party(players = 8) {
  const p = simulateParty({ games: [new FusionGame()], players })
  const ids = p.players.map((pl) => pl.id)
  return { p, ids }
}

function startParty(p: FakeParty, settings: Record<string, unknown>) {
  p.addGame(GAME, 'fusion', 'Who is fused?', { seconds: 30, showSeconds: 6, ...settings })
  const started = p.send(p.hostUser, { type: 'start', gameId: GAME })
  expect(started.kind).toBe('commit')
  return started
}

const hostAct = (p: FakeParty, action: unknown, close?: string[]) =>
  p.send(p.hostUser, { type: 'host-action', gameId: GAME, action, close })
const lock = (p: FakeParty, n: number, voter: PlayerId, choice: PlayerId[], afterMs?: number) =>
  p.submit(GAME, pictureKey(n), voter, { choice }, afterMs)
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
  it('takes the TV, shows the pictures, then asks them one by one with locks on the phones', () => {
    const { p, ids } = party()
    const [a, b, c, d, e, f, g] = ids
    startParty(p, { pictures: [{ people: [a, b] }, { people: [c, d] }], pointsPerPerson: 1, bonusForBoth: 1 })
    expect(p.spotlight).toBe(GAME) // a stage game takes the TV
    expect(p.promptsOf(GAME)).toEqual([])
    expect(roomOf(p).phase).toBe('lobby')

    expect(hostAct(p, { type: 'show' }).kind).toBe('commit')
    expect(roomOf(p).phase).toBe('showing')
    expect(wakeUp(p).kind).toBe('commit')
    expect(roomOf(p).phase).toBe('wall')

    expect(hostAct(p, { type: 'ask', n: 1 }).kind).toBe('commit')
    expect(p.promptsOf(GAME).map((x) => x.key)).toEqual(['p1'])
    lock(p, 1, e, [a, b])
    lock(p, 1, f, [a, c])
    expect(() => lock(p, 1, f, [a, b])).toThrow('You already answered') // the first lock counts
    lock(p, 1, a, [b, c]) // in the picture: the database takes it, the reveal ignores it
    expect(() => lock(p, 1, g, [g, a])).toThrow('That is not one of the options') // not yourself
    expect(() => lock(p, 1, g, [a])).toThrow('Pick 2')
    expect(p.talliesOf(GAME)).toEqual({ p1: 3 })
    expect(canonicalJson(p.game(GAME).publicState)).not.toContain(a)

    // Reveal now, as the host page sends it.
    expect(hostAct(p, { type: 'reveal', n: 1 }, ['p1']).kind).toBe('commit')
    expect(hostAct(p, { type: 'reveal', n: 1 }, ['p1']).kind).toBe('skip') // a double tap
    expect(roomOf(p).pictures[0].revealed).toMatchObject({ people: [a, b], names: ['Guest 1', 'Guest 2'], both: 1, one: 1, none: 0, voters: 2, step: 1 })
    expect(roomOf(p).pictures[1].revealed).toBeNull()
    expect(p.game(GAME).scores).toEqual({ [e]: 3, [f]: 1 })
    expect(readView(p.game(GAME).views[e])).toEqual({ points: 3, rank: 1, hits: { 1: 2 }, inPicture: false })
    expect(readView(p.game(GAME).views[a])).toMatchObject({ hits: {}, inPicture: true })
    expect(p.feed).toEqual([])

    // The wall comes back by itself; then #2, revealed by the timer.
    expect(wakeUp(p).kind).toBe('commit')
    expect(roomOf(p)).toMatchObject({ phase: 'wall', current: null })
    expect(hostAct(p, { type: 'ask', n: 2 }).kind).toBe('commit')
    lock(p, 2, e, [c, d], 29_900) // at 29.9 s
    expect(() => lock(p, 2, g, [c, d], 31_000)).toThrow('Too late, answers are closed')
    expect(wakeUp(p).kind).toBe('commit')
    expect(roomOf(p)).toMatchObject({ phase: 'reveal', current: { n: 2, step: 2 } })
    expect(p.game(GAME).scores).toEqual({ [e]: 6, [f]: 1 })

    expect(hostAct(p, { type: 'finish' }).kind).toBe('commit')
    expect(p.game(GAME)).toMatchObject({ status: 'finished', finishedBy: 'game', winners: [e] })
    expect(p.players.find((pl) => pl.id === e)?.profile).toEqual({ fusion: { detective: 1 } })
    expect(p.feed.filter((item) => item.interrupt).map((item) => item.message)).toEqual(['Guest 5 has the sharpest eye!'])
  })

  it('sets the key on the night and still keeps it secret', () => {
    const { p, ids } = party(5)
    startParty(p, { pictures: [{}], pointsPerPerson: 1, bonusForBoth: 0 })
    expect(hostAct(p, { type: 'ask', n: 1 })).toMatchObject({ kind: 'refuse', message: 'Set who is in #1 first' })
    expect(hostAct(p, { type: 'setKey', n: 1, people: [ids[0], ids[1]] }).kind).toBe('commit')
    expect(stateOf(p).key).toEqual({ 1: [ids[0], ids[1]] })
    expect(canonicalJson(p.game(GAME).publicState)).not.toContain(ids[0])
    expect(canonicalJson(Object.values(p.game(GAME).views))).not.toContain(ids[1])
    expect(hostAct(p, { type: 'setKey', n: 1, people: [ids[1], ids[0]] }).kind).toBe('skip')
  })

  it('handles a guest who joins late and locks in, and one who leaves', () => {
    const { p, ids } = party(5)
    startParty(p, { pictures: [{ people: [ids[0], ids[1]] }, { people: [ids[2], ids[3]] }], pointsPerPerson: 1, bonusForBoth: 0 })
    hostAct(p, { type: 'ask', n: 1 })
    const late = p.addPlayer('Late')
    p.sync(GAME)
    expect(readView(p.game(GAME).views[late.id])).toEqual({ points: 0, rank: null, hits: {}, inPicture: false })
    lock(p, 1, late.id, [ids[0], ids[1]]) // a late guest can lock in
    lock(p, 1, ids[4], [ids[0], ids[1]])
    p.removePlayer(ids[4]) // removed before the reveal: their lock goes with them
    p.sync(GAME)
    p.removePlayer(ids[1]) // someone in picture 1 leaves; the print still shows them
    p.sync(GAME)
    expect(hostAct(p, { type: 'reveal', n: 1 }, ['p1']).kind).toBe('commit')
    expect(roomOf(p).pictures[0].revealed).toMatchObject({ people: [ids[0], ids[1]], names: ['Guest 1', 'Guest 2'], both: 1, voters: 1 })
    expect(p.game(GAME).scores).toEqual({ [late.id]: 2 })
  })

  it('ends by the host while a picture is asked: the crown from the points so far, that picture secret', () => {
    const { p, ids } = party(6)
    startParty(p, { pictures: [{ people: [ids[0], ids[1]] }, { people: [ids[2], ids[3]] }], pointsPerPerson: 1, bonusForBoth: 0 })
    hostAct(p, { type: 'ask', n: 1 })
    lock(p, 1, ids[4], [ids[0], ids[1]])
    hostAct(p, { type: 'reveal', n: 1 }, ['p1'])
    hostAct(p, { type: 'wall', from: 'reveal', n: 1 })
    hostAct(p, { type: 'ask', n: 2 })
    lock(p, 2, ids[5], [ids[2], ids[3]])
    expect(p.send(p.hostUser, { type: 'end', gameId: GAME }).kind).toBe('commit')
    expect(p.game(GAME)).toMatchObject({ status: 'finished', finishedBy: 'host', winners: [ids[4]], scores: { [ids[4]]: 2 } })
    expect(p.promptsOf(GAME).find((x) => x.key === 'p2')).toMatchObject({ revealedAt: null })
    expect(p.promptsOf(GAME).find((x) => x.key === 'p2')!.closedAt).not.toBeNull()
    expect(roomOf(p).phase).toBe('done')
    expect(canonicalJson(p.game(GAME).publicState)).not.toContain(ids[2])
  })

  it('keeps its contract over a hand-written round with a join and a leave', () => {
    const roster = simulateParty({ games: [game], players: 6 }).players.map((pl) => pl.id)
    const choice = (x: number, y: number) => ({ choice: [roster[x], roster[y]].sort() })
    const example: ContractExample = {
      config: { pictures: [{ people: [roster[0], roster[1]] }, { label: 'Viking' }, {}], pointsPerPerson: 1, bonusForBoth: 1, seconds: 10, showSeconds: 3 },
      players: 6,
      steps: [
        { kind: 'host', action: { type: 'show' } },
        { kind: 'host', action: { type: 'show' } },
        { kind: 'tick', ms: 9_000 },
        { kind: 'sync' },
        { kind: 'host', action: { type: 'wall', from: 'showing' } },
        { kind: 'host', action: { type: 'ask', n: 2 } },
        { kind: 'host', action: { type: 'ask', n: 1 } },
        { kind: 'answer', player: 2, key: 'p1', answer: choice(0, 1) },
        { kind: 'answer', player: 3, key: 'p1', answer: choice(0, 4) },
        { kind: 'answer', player: 0, key: 'p1', answer: choice(1, 2) },
        { kind: 'join' },
        { kind: 'answer', player: 6, key: 'p1', answer: choice(0, 1) },
        { kind: 'host', action: { type: 'ask', n: 1 } },
        { kind: 'host', action: { type: 'setKey', n: 2, people: [roster[2], roster[3]] } },
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
    // It starts the showing, asks all four (Reveal now once everyone has locked in) and crowns the detective by itself: no End needed.
    expect(hostSteps[0]).toBe('show')
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
    const { p, ids } = party(6)
    startParty(p, { pictures: [{ people: [ids[0], ids[1]] }, { people: [ids[2], ids[3]] }, { people: [ids[4], ids[5]] }], pointsPerPerson: 1, bonusForBoth: 0 })
    hostAct(p, { type: 'ask', n: 1 })
    lock(p, 1, ids[2], [ids[0], ids[1]])
    return { p, ids }
  }
  /** The same, revealed. */
  function revealing() {
    const { p, ids } = asking()
    hostAct(p, { type: 'reveal', n: 1 }, ['p1'])
    return { p, ids }
  }

  it('the countdown ends as the host taps Reveal now: the host first, then the timer is skipped', () => {
    const { p } = asking()
    p.tick(31_250)
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

  it('the showing ends as the host taps Skip to the wall: the second is skipped', () => {
    const { p, ids } = party(4)
    startParty(p, { pictures: [{ people: [ids[0], ids[1]] }], pointsPerPerson: 1, bonusForBoth: 0 })
    hostAct(p, { type: 'show' })
    expect(wakeUp(p).kind).toBe('commit')
    expect(hostAct(p, { type: 'wall', from: 'showing' }).kind).toBe('skip')
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
    p.tick(20_000)
    expect(p.sync(GAME).kind).toBe('skip')
    expect(roomOf(p).phase).toBe('asking')
  })

  it('a lock at 29.9 s counts; one past the grace second is refused; a second lock is refused', () => {
    const { p, ids } = asking()
    lock(p, 1, ids[3], [ids[0], ids[5]], 29_900)
    lock(p, 1, ids[4], [ids[0], ids[1]], 30_999)
    expect(() => lock(p, 1, ids[5], [ids[0], ids[1]], 31_000)).toThrow('Too late, answers are closed')
    expect(() => lock(p, 1, ids[2], [ids[0], ids[5]])).toThrow('You already answered')
    expect(wakeUp(p).kind).toBe('commit')
    expect(roomOf(p).pictures[0].revealed).toMatchObject({ both: 2, one: 1, voters: 3 })
  })
})

describe('the bot', () => {
  it('makes four pictures from pairs of the first eight players, 10 s to guess and a 3 s showing', () => {
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
      showSeconds: 3,
    })
    expect(game.parseConfig({ ...game.defaultConfig, ...bot.settings!(['a', 'b', 'c']) }).pictures).toHaveLength(4)
    expect(game.parseConfig({ ...game.defaultConfig, ...bot.settings!(['solo']) }).pictures[0]).toEqual({ label: '#1' })
  })

  it('locks in only while a picture is asked, never on a picture it is in, and only once', () => {
    const { p, ids } = party(6)
    startParty(p, bot.settings!(ids))
    const random = () => 0 // always now
    expect(bot.move(botSight(p, GAME, ids[4], random))).toBeNull() // the lobby
    hostAct(p, { type: 'ask', n: 1 })
    expect(bot.move(botSight(p, GAME, ids[0], random))).toBeNull() // in #1
    const move = bot.move(botSight(p, GAME, ids[4], random))
    expect(move).toMatchObject({ kind: 'answer', key: 'p1' })
    if (move?.kind !== 'answer') throw new Error('No lock')
    expect((move.answer as { choice: string[] }).choice).not.toContain(ids[4])
    p.submit(GAME, move.key, ids[4], move.answer)
    expect(bot.move(botSight(p, GAME, ids[4], random))).toBeNull() // locked in already
    p.tick(10_000)
    expect(bot.move(botSight(p, GAME, ids[5], random))).toBeNull() // time's up
  })

  it('spreads its locks over the countdown', () => {
    const { p, ids } = party(6)
    startParty(p, bot.settings!(ids))
    hostAct(p, { type: 'ask', n: 1 })
    // 10 s left: a chance of one in ten each second.
    expect(bot.move(botSight(p, GAME, ids[4], () => 0.2))).toBeNull()
    expect(bot.move(botSight(p, GAME, ids[4], () => 0.05))).not.toBeNull()
    p.tick(9_500) // the last second always locks in
    expect(bot.move(botSight(p, GAME, ids[4], () => 0.99))).not.toBeNull()
  })

  it('runs the host’s steps: show, the wall by the timer, ask after a pause, Reveal now when everyone is in, crown', () => {
    const { p, ids } = party(4)
    startParty(p, { ...bot.settings!(ids), pictures: [{ label: '#1', people: [ids[0], ids[1]] }, { label: '#2' }] })
    const next = () => bot.hostMove!(hostBotSight(p, GAME, () => 0.5) as HostBotSight)
    expect(next()).toEqual({ action: { type: 'show' } })
    hostAct(p, { type: 'show' })
    expect(next()).toBeNull() // the showing runs: 2 pictures of 3 s
    p.tick(6_000 + 4_000)
    expect(next()).toBeNull() // the timer is due, not yet overdue
    p.tick(1_000)
    expect(next()).toEqual({ action: { type: 'wall', from: 'showing' } })
    hostAct(p, { type: 'wall', from: 'showing' })
    // The wall was due 5 s ago, longer than its pause: on to the first picture.
    expect(next()).toEqual({ action: { type: 'ask', n: 1 } })
    hostAct(p, { type: 'ask', n: 1 })
    expect(next()).toBeNull()
    lock(p, 1, ids[2], [ids[0], ids[1]])
    lock(p, 1, ids[3], [ids[0], ids[2]])
    // Everyone who may vote (not the two in it) has locked in.
    expect(next()).toEqual({ action: { type: 'reveal', n: 1 }, close: ['p1'] })
    hostAct(p, { type: 'reveal', n: 1 }, ['p1'])
    expect(next()).toBeNull() // the reveal holds the TV
    p.tick(REVEAL_HOLD_MS + 5_000)
    expect(next()).toEqual({ action: { type: 'wall', from: 'reveal', n: 1 } })
    // As it should be: the timer brings the wall, and the host waits a moment on it.
    const timely = party(4)
    startParty(timely.p, { ...bot.settings!(timely.ids), pictures: [{ label: '#1', people: [timely.ids[0], timely.ids[1]] }, { label: '#2' }] })
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
    // #2 has nobody set: the host sets it first, then asks it.
    expect(next()).toEqual({ action: { type: 'setKey', n: 2, people: [ids[0], ids[1]] } })
    hostAct(p, { type: 'setKey', n: 2, people: [ids[0], ids[1]] })
    expect(next()).toEqual({ action: { type: 'ask', n: 2 } })
    hostAct(p, { type: 'ask', n: 2 })
    p.tick(10_000 + GRACE_MS + WAKE_MARGIN_MS + 5_000)
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
    // Everyone locked in on every picture but the two in it.
    expect(room.pictures.map((x) => x.revealed!.voters)).toEqual([43, 43, 43, 43])
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
    const locks: Record<number, [PlayerId, PlayerId[]][]> = {
      1: [e, f, g].map((voter) => [voter, [a, b]]),
      2: [
        [e, [c, d]],
        [f, [a, g]],
        [g, [a, b]],
        [c, [d, e]], // in the picture: doesn't count
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
