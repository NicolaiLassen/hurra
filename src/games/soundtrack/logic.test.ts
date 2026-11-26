// Lydspor's rules (.design/lydspor/spec.md, sections 5 to 8 and 11): the
// settings, the deal, the prompts, the last call and the lock, the review of
// typed answers, reveals, the host's Accept, scoring with the guard, the own
// average and the payout, sit out, guests who leave or join late, double taps
// and races, and what never reaches the room. Every song, singer, caption and
// answer here is invented.
import { describe, expect, it } from 'vitest'
import { botExample, checkGameContract, type ContractExample } from '../core/contract'
import { createGameContext } from '../core/context'
import { GameError, type AnswerPayload, type PlayerId, type Prompt, type RecapRound } from '../core/Game'
import { canonicalJson } from '../core/runtime'
import { simulateParty, type FakeParty } from '../core/simulate'
import { answersOf, seededRandom, testInfo } from '../core/testing'
import { bot, botSettings, misspell } from './bot'
import { checkConfig, eventSpec, playedKeys, SoundtrackGame, TEXT_SPEC, buildReview, readPicks } from './logic'
import { judge } from './match'
import {
  NO_PHOTO,
  promptKey,
  type SoundtrackConfig,
  type SoundtrackPlayerView,
  type SoundtrackPublicState,
  type SoundtrackState,
  type TypedPart,
} from './types'

const game = new SoundtrackGame()
const GAME = 'lydspor-1'

const SONGS = [
  { title: 'Paper Lanterns', singer: 'Mira Holm', caption: 'The harbour, 2009', alsoTitles: [], alsoSingers: ['Mira'] },
  { title: 'Seven Ferries', singer: 'Coldwave', caption: 'Island trip, 2012', alsoTitles: [], alsoSingers: [] },
  { title: 'Under the Old Oak Tree', singer: 'The Lanterns', caption: 'The allotment, 2019', alsoTitles: ['Old Oak'], alsoSingers: [] },
]

/** Settings with three invented songs and two extra photos. */
function settings(overrides: Record<string, unknown> = {}, songOverrides: Record<string, unknown>[] = []): Record<string, unknown> {
  return {
    songs: SONGS.map((song, i) => ({
      ...song,
      photo: `test/lydspor/song-${i + 1}.jpg`,
      startAt: 40,
      note: '',
      inPhoto: [],
      ...songOverrides[i],
    })),
    extraPhotos: [
      { photo: 'test/lydspor/extra-1.jpg', caption: 'A wedding, 2015' },
      { photo: 'test/lydspor/extra-2.jpg', caption: 'Ski trip, 2017' },
    ],
    storyteller: 'Ida',
    ...overrides,
  }
}

const parse = (input: Record<string, unknown>) => game.parseConfig({ ...game.defaultConfig, ...input })

// A party in memory: the real step(), game_load and game_commit rules, and submit_answer's checks.

function startParty(players = 6, overrides: Record<string, unknown> = {}, songOverrides: Record<string, unknown>[] = []) {
  const p = simulateParty({ games: [new SoundtrackGame()], players })
  const ids = p.players.map((pl) => pl.id)
  p.addGame(GAME, 'soundtrack', 'Lydspor', settings(overrides, songOverrides))
  const started = p.send(p.hostUser, { type: 'start', gameId: GAME })
  expect(started.kind).toBe('commit')
  return { p, ids }
}

const hostAct = (p: FakeParty, action: unknown, close?: string[]) => p.send(p.hostUser, { type: 'host-action', gameId: GAME, action, close })
const stateOf = (p: FakeParty) => p.stateOf(GAME)!.state as SoundtrackState
const pub = (p: FakeParty) => p.game(GAME).publicState as SoundtrackPublicState
const viewOf = (p: FakeParty, id: PlayerId) => p.game(GAME).views[id] as SoundtrackPlayerView
const typeIn = (p: FakeParty, n: number, part: TypedPart, id: PlayerId, text: string) => p.submit(GAME, promptKey(n, part), id, { text })
/** Song n's own photo (right), or any wall letter. */
const rightPhoto = (p: FakeParty, n: number) => stateOf(p).wall.indexOf(n - 1)
const pickPhoto = (p: FakeParty, n: number, id: PlayerId, letter: number | typeof NO_PHOTO) =>
  p.submit(GAME, promptKey(n, 'event'), id, { choice: [String(letter)] })
/** A wall letter that is nobody's song: an extra photo. */
const extraPhoto = (p: FakeParty, k = 0) => stateOf(p).wall.map((w, letter) => (w >= SONGS.length ? letter : -1)).filter((l) => l >= 0)[k]
const play = (p: FakeParty, index: number) => hostAct(p, { type: 'play', index })
const playAll = (p: FakeParty, songs = SONGS.length) => {
  for (let i = 0; i < songs; i++) expect(play(p, i).kind).toBe('commit')
}
/** Lock now, as the host page sends it: with every played key in the close list. */
const lockNow = (p: FakeParty) => hostAct(p, { type: 'lock' }, playedKeys(stateOf(p).playedAt.length))
/** A whole answer for song n. */
function answer(p: FakeParty, n: number, id: PlayerId, title: string | null, singer: string | null, photo: number | null) {
  if (title !== null) typeIn(p, n, 'title', id, title)
  if (singer !== null) typeIn(p, n, 'singer', id, singer)
  if (photo !== null) pickPhoto(p, n, id, photo)
}
const reveal = (p: FakeParty, index: number) => hostAct(p, { type: 'reveal', index })
const accept = (p: FakeParty, index: number, part: TypedPart, key: string, accepted = true) =>
  hostAct(p, { type: 'accept', index, part, key, accepted })
const recapOf = (p: FakeParty) => p.recapRounds(GAME)[0] as RecapRound<SoundtrackState, SoundtrackConfig>

describe('settings', () => {
  it('takes the songs, fills the defaults and keeps nothing real in the bundle', () => {
    const config = parse(settings())
    expect(config.points).toEqual({ event: 2, title: 1, singer: 1 })
    expect(config).toMatchObject({ lastCallSeconds: 60, standingsEvery: 4, hints: false, boardMax: 20, intro: '', storyteller: 'Ida', sitOut: [] })
    expect(config.songs[0]).toEqual({
      title: 'Paper Lanterns',
      singer: 'Mira Holm',
      alsoTitles: [],
      alsoSingers: ['Mira'],
      photo: 'test/lydspor/song-1.jpg',
      caption: 'The harbour, 2009',
      startAt: 40,
      note: '',
      inPhoto: [],
    })
    expect(game.defaultConfig).toMatchObject({ songs: [], extraPhotos: [] })
  })

  it('trims texts, drops empty extra rows and takes numbers from a form', () => {
    const config = parse(
      settings({ points: { event: '3', title: 1, singer: '2' }, lastCallSeconds: '45', intro: '  Eight songs.  ' }, [
        { title: '  Paper Lanterns ', alsoTitles: ['', ' Lanterns ', '   '], startAt: '75' },
      ]),
    )
    expect(config.points).toEqual({ event: 3, title: 1, singer: 2 })
    expect(config.lastCallSeconds).toBe(45)
    expect(config.intro).toBe('Eight songs.')
    expect(config.songs[0]).toMatchObject({ title: 'Paper Lanterns', alsoTitles: ['Lanterns'], startAt: 75 })
  })

  it('counts lengths in code points, as Postgres does', () => {
    const title = `${'🎵'.repeat(59)}a`
    expect(parse(settings({}, [{ title }])).songs[0].title).toBe(title)
    expect(() => parse(settings({}, [{ title: `${title}b` }]))).toThrow('Song 1: the title is at most 60 characters')
  })

  const twelve = Array.from({ length: 13 }, (_, i) => ({ ...SONGS[0], title: `Song number ${i + 1}`, photo: `test/s${i}.jpg`, inPhoto: [] }))
  it.each([
    [{ songs: [] }, [], 'Add at least one song in the settings'],
    [{ songs: twelve }, [], 'Lydspor takes at most 12 songs'],
    [{}, [{ photo: '' }], 'Song 1 needs its photo'],
    [{}, [{ photo: '../secret.png' }], "Song 1: that photo isn't valid. Upload it again."],
    [{}, [{ singer: '  ' }], 'Song 1 needs a title and a singer'],
    [{}, [{ title: '?!' }], 'Song 1: the title needs a letter or a digit'],
    [{}, [{}, { singer: '...' }], 'Song 2: the singer needs a letter or a digit'],
    [{}, [{}, { title: 'paper lanterns!' }], 'Two songs are called Paper Lanterns'],
    [{}, [{}, { photo: 'test/lydspor/song-1.jpg' }], 'The same photo is used twice'],
    [{}, [{ alsoTitles: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }], 'Song 1 takes at most 6 extra titles'],
    [{}, [{ alsoSingers: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }], 'Song 1 takes at most 6 extra singers'],
    [{}, [{ alsoSingers: ['--'] }], 'Song 1: an extra answer needs a letter or a digit'],
    [{}, [{ startAt: 3600 }], 'Song 1: the start must be within the first hour'],
    [{}, [{ caption: '' }], 'Song 1 needs a caption'],
    [{}, [{ caption: 'x'.repeat(31) }], 'Song 1: the caption is at most 30 characters'],
    [{}, [{ note: 'x'.repeat(141) }], 'Song 1: the story note is at most 140 characters'],
    [{}, [{ inPhoto: Array.from({ length: 11 }, (_, i) => `p${i}`) }], 'Song 1: at most 10 people in its photo'],
    [{ extraPhotos: [] }, [], "Add at least 2 extra photos, so the last song's photo isn't free"],
    [{ extraPhotos: Array.from({ length: 5 }, (_, i) => ({ photo: `test/e${i}.jpg`, caption: 'x' })) }, [], 'Lydspor takes at most 4 extra photos'],
    [{ extraPhotos: [{ photo: 'test/e.jpg', caption: '' }, { photo: 'test/f.jpg', caption: 'x' }] }, [], 'Extra photo 1 needs a caption'],
    [{ points: { event: 6, title: 1, singer: 1 } }, [], 'Points must be whole numbers from 0 to 5'],
    [{ points: { event: 2, title: 1.5, singer: 1 } }, [], 'Points must be whole numbers from 0 to 5'],
    [{ lastCallSeconds: 10 }, [], 'Last call takes 20 to 180 seconds'],
    [{ boardMax: 0 }, [], 'The most on the night board is a whole number from 1 to 25'],
    [{ storyteller: 'x'.repeat(41) }, [], "The storyteller's name is at most 40 characters"],
  ] as const)('refuses %j %j: %s', (overrides, songs, message) => {
    expect(() => parse(settings(overrides, [...songs]))).toThrow(new GameError(message))
  })

  it('needs extra photos only from 3 songs on', () => {
    expect(() => parse(settings({ songs: (settings().songs as unknown[]).slice(0, 2), extraPhotos: [] }))).not.toThrow()
  })

  it('lists every problem in order for the editor, and the first is what the start refuses', () => {
    const { problems } = checkConfig(settings({ lastCallSeconds: 5 }, [{ photo: '' }, { singer: '' }]))
    expect(problems).toEqual(['Song 1 needs its photo', 'Song 2 needs a title and a singer', 'Last call takes 20 to 180 seconds'])
  })

  it('warns without refusing', () => {
    const { problems, warnings } = checkConfig(
      settings({ extraPhotos: settings().extraPhotos }, [
        { caption: 'The harbour on a windy day' },
        { title: 'Glow', alsoTitles: ['glow!'] },
        { singer: 'Mira Holm feat. Kasper Lind', alsoSingers: ['Kasper'] },
      ]),
    )
    expect(problems).toEqual([])
    expect(warnings).toEqual([
      'Only 2 extra photos: 4 keep the last songs hard to place.',
      'Song 1: a caption over 20 characters wraps on a small phone.',
      'Song 2: the title is short: only the exact spelling counts. Add extra answers if it has a common misspelling.',
      'Song 2: “glow!” counts already.',
      'Song 3: only Mira Holm is needed to score: the feat. part may be left out.',
      'Songs 1 and 3 share a singer. Fine: singers can repeat.',
    ])
  })

  it('warns about titles a typed answer could count for twice', () => {
    const { warnings } = checkConfig(settings({}, [{}, { title: 'Paper Lantern' }]))
    expect(warnings).toContain('Songs 1 and 2 have near titles: a typed answer could count for both.')
  })

  it("takes the bot's settings", () => {
    const config = parse(bot.settings!(['a', 'b', 'c']))
    expect(config.songs).toHaveLength(3)
    expect(config.songs[0].inPhoto).toEqual(['b'])
    expect(checkConfig(bot.settings!(['a', 'b'])).problems).toEqual([])
  })

  it('knows eight songs for a rehearsal of the night, and counts its right answers and one-letter slips on each', () => {
    const { config, problems } = checkConfig(botSettings(['a', 'b'], 8))
    expect(problems).toEqual([])
    expect(config.songs).toHaveLength(8)
    expect(config.extraPhotos).toHaveLength(4)
    expect(config.standingsEvery).toBe(4)
    const random = seededRandom(5)
    for (const song of config.songs) {
      for (const [part, right, extras] of [
        ['title', song.title, song.alsoTitles],
        ['singer', song.singer, song.alsoSingers],
      ] as const) {
        const accepted = [right, ...extras]
        expect(judge(right.toLowerCase(), part, accepted, []).verdict).toBe('exact')
        for (let k = 0; k < 5; k++) expect(['exact', 'typo']).toContain(judge(misspell(right, 1, random, true), part, accepted, []).verdict)
      }
    }
  })
})

describe('the deal and the prompts', () => {
  it('shuffles the photos onto a wall lettered from A, and announces nothing', () => {
    const { p } = startParty()
    const state = stateOf(p)
    expect([...state.wall].sort()).toEqual([0, 1, 2, 3, 4])
    expect(state).toMatchObject({ phase: 'lobby', playedAt: [], picks: null, review: null, revealed: 0, credits: null })
    expect(p.promptsOf(GAME)).toEqual([])
    expect(p.feed).toEqual([])
    expect(pub(p).wall.map((w) => w.path).sort()).toEqual(
      ['test/lydspor/extra-1.jpg', 'test/lydspor/extra-2.jpg', 'test/lydspor/song-1.jpg', 'test/lydspor/song-2.jpg', 'test/lydspor/song-3.jpg'],
    )
  })

  it('deals the same wall for the same random source', () => {
    const deal = (seed: number) => {
      const { ctx } = createGameContext(testInfo(parse(settings()), ['a']), seededRandom(seed))
      return game.setup(ctx).wall
    }
    expect(deal(5)).toEqual(deal(5))
  })

  it('opens three prompts per song: two typed, one photo, none final, never an answer in a spec', () => {
    const { p } = startParty()
    expect(play(p, 0).kind).toBe('commit')
    const prompts = p.promptsOf(GAME)
    expect(prompts.map((x) => x.key)).toEqual(['s1.title', 's1.singer', 's1.event'])
    expect(prompts[0].spec).toEqual({ kind: 'text', max_length: 60 })
    expect(prompts[1].spec).toEqual(TEXT_SPEC)
    expect(prompts[2].spec).toEqual({ kind: 'choice', options: ['none', '0', '1', '2', '3', '4'] })
    expect(prompts.every((x) => x.closesAt === null)).toBe(true)
    expect(JSON.stringify(prompts)).not.toMatch(/Paper|Mira|harbour/i)
    expect(eventSpec(2)).toEqual({ kind: 'choice', options: ['none', '0', '1'] })
    expect(stateOf(p).phase).toBe('playing')
    expect(pub(p).playedAt).toEqual([p.now])
  })

  it('plays the songs in order; a double tap does nothing', () => {
    const { p } = startParty()
    expect(play(p, 1)).toMatchObject({ kind: 'refuse', message: 'Play the songs in order' })
    expect(play(p, 0).kind).toBe('commit')
    expect(play(p, 0).kind).toBe('skip')
    p.tick(60_000)
    expect(play(p, 1).kind).toBe('commit')
    expect(play(p, 2).kind).toBe('commit')
    expect(play(p, 3)).toMatchObject({ kind: 'refuse', message: 'That was the last song. Tap Last call.' })
    expect(stateOf(p).playedAt).toHaveLength(3)
  })

  it('takes typed answers, trimmed, changeable, never empty; photos and no photo', () => {
    const { p, ids } = startParty()
    play(p, 0)
    typeIn(p, 1, 'title', ids[0], '  Paper Lantrens ')
    typeIn(p, 1, 'title', ids[0], 'Paper Lanterns')
    expect(p.answersOf(GAME, ids[0])['s1.title']).toEqual({ text: 'Paper Lanterns' })
    expect(() => typeIn(p, 1, 'singer', ids[0], '   ')).toThrow('Answers are 1 to 60 characters')
    expect(() => typeIn(p, 1, 'singer', ids[0], 'x'.repeat(61))).toThrow('Answers are 1 to 60 characters')
    pickPhoto(p, 1, ids[0], 2)
    pickPhoto(p, 1, ids[0], NO_PHOTO)
    expect(p.answersOf(GAME, ids[0])['s1.event']).toEqual({ choice: ['none'] })
    expect(() => pickPhoto(p, 1, ids[0], 9)).toThrow('That is not one of the options')
    // A tally counts first answers only, so the TV's numbers never go down.
    expect(p.talliesOf(GAME)).toEqual({ 's1.title': 1, 's1.singer': 0, 's1.event': 1 })
  })

  it('refuses moves: answers are prompts', () => {
    expect(() => (game.parseAction as (input: unknown) => never)({ type: 'play' })).toThrow(GameError)
  })
})

describe('the last call and the lock', () => {
  it('locks by itself: the timer closes every prompt, then reads them all a second later', () => {
    const { p, ids } = startParty()
    playAll(p)
    answer(p, 1, ids[0], 'Paper Lanterns', 'Mira Holm', 0)
    expect(hostAct(p, { type: 'lastCall', after: 3 }).kind).toBe('commit')
    expect(hostAct(p, { type: 'lastCall', after: 3 }).kind).toBe('skip')
    const lockAt = p.now + 60_000
    expect(stateOf(p)).toMatchObject({ phase: 'lastCall', lockAt, extended: 0, closingAt: null })
    expect(p.game(GAME).wakeAt).toBe(lockAt)
    expect(pub(p).lockAt).toBe(lockAt)

    // Anything still changes during the last call.
    typeIn(p, 2, 'title', ids[0], 'Seven Ferries')
    expect(play(p, 3)).toMatchObject({ kind: 'refuse', message: 'The answers are locking' })

    p.tick(60_000)
    expect(p.sync(GAME).kind).toBe('commit')
    expect(stateOf(p)).toMatchObject({ phase: 'lastCall', closingAt: p.now })
    expect(p.game(GAME).wakeAt).toBe(p.now + 1000)
    expect(() => typeIn(p, 2, 'singer', ids[0], 'Coldwave')).toThrow('Too late, answers are closed')
    expect(p.promptsOf(GAME).every((x) => x.closedAt !== null)).toBe(true)

    p.tick(1000)
    expect(p.sync(GAME).kind).toBe('commit')
    const state = stateOf(p)
    expect(state).toMatchObject({ phase: 'locked', lockedAt: p.now, closingAt: null })
    expect(p.game(GAME).wakeAt).toBeNull()
    expect(state.picks).toEqual({ [ids[0]]: { event: [0, null, null], title: ['Paper Lanterns', 'Seven Ferries', null], singer: ['Mira Holm', null, null] } })
    expect(state.review).toHaveLength(3)
    expect(p.promptsOf(GAME).every((x) => x.revealedAt !== null)).toBe(true)
    // Once revealed, prompts drop out of the tallies.
    expect(p.talliesOf(GAME)).toEqual({})
    expect(pub(p).lockedAt).toBe(p.now)
    expect(viewOf(p, ids[0]).mine).toEqual(state.picks![ids[0]])
    expect(viewOf(p, ids[1]).mine).toBeNull()
  })

  it('closes again when an answer list is still missing at the second step', () => {
    const config = parse(settings())
    const { ctx: setupCtx } = createGameContext(testInfo(config, ['a']), seededRandom())
    const state: SoundtrackState = { ...game.setup(setupCtx), phase: 'lastCall', playedAt: [500], lockAt: 2_000, closingAt: 1_000 }
    const prompts: Record<string, Prompt> = Object.fromEntries(
      playedKeys(1).map((key) => [key, { key, spec: TEXT_SPEC, openedAt: 500, closesAt: null, closedAt: 1_000, revealedAt: null }]),
    )
    const { ctx, effects } = createGameContext(
      testInfo(config, ['a'], { now: 2_000, prompts, answers: { 's1.title': [], 's1.singer': [] } }),
      seededRandom(),
    )
    const next = game.onWake(state, ctx)
    expect(next).toMatchObject({ phase: 'lastCall', closingAt: 2_000 })
    expect(effects.prompts.close).toEqual(['s1.event'])
    expect(game.wakeAt(next)).toBe(3_000)
  })

  it('gives More time twice, from the later of the deadline and now; a double tap does nothing', () => {
    const { p } = startParty()
    playAll(p, 1)
    expect(hostAct(p, { type: 'more', n: 1 })).toMatchObject({ kind: 'refuse', message: 'Tap Last call first' })
    hostAct(p, { type: 'lastCall', after: 1 })
    const lockAt = stateOf(p).lockAt!
    expect(hostAct(p, { type: 'more', n: 1 }).kind).toBe('commit')
    expect(hostAct(p, { type: 'more', n: 1 }).kind).toBe('skip')
    expect(stateOf(p)).toMatchObject({ lockAt: lockAt + 30_000, extended: 1 })
    expect(hostAct(p, { type: 'more', n: 2 }).kind).toBe('commit')
    expect(hostAct(p, { type: 'more', n: 3 })).toMatchObject({ kind: 'refuse', message: "That's all the extra time" })
    expect(stateOf(p).lockAt).toBe(lockAt + 60_000)
    // Once the timer has closed the prompts, there is no more time to give.
    p.tick(120_000)
    p.sync(GAME)
    expect(stateOf(p).closingAt).toBe(p.now)
    p.tick(1000)
    p.sync(GAME)
    expect(hostAct(p, { type: 'more', n: 3 }).kind).toBe('skip')
  })

  it('locks now from the host with the close list; without it the answers are still coming in', () => {
    const { p, ids } = startParty()
    expect(hostAct(p, { type: 'lock' })).toMatchObject({ kind: 'refuse', message: 'Play song 1 first' })
    expect(hostAct(p, { type: 'lastCall', after: 0 })).toMatchObject({ kind: 'refuse', message: 'Play song 1 first' })
    playAll(p, 2)
    answer(p, 2, ids[1], 'seven ferries', 'Coldwave', 1)
    expect(hostAct(p, { type: 'lock' })).toMatchObject({ kind: 'refuse', message: 'The answers are still coming in' })
    // A lock after song 2: song 3 never plays, and its title appears nowhere.
    expect(lockNow(p).kind).toBe('commit')
    expect(lockNow(p).kind).toBe('skip')
    expect(stateOf(p).picks![ids[1]]).toEqual({ event: [null, 1], title: [null, 'seven ferries'], singer: [null, 'Coldwave'] })
    expect(() => typeIn(p, 1, 'title', ids[2], 'Paper Lanterns')).toThrow('Too late, answers are closed')
    expect(play(p, 2)).toMatchObject({ kind: 'refuse', message: 'The answers are locking' })
    expect(hostAct(p, { type: 'lastCall', after: 2 }).kind).toBe('skip')
  })

  it('races the timer: Lock now after the timer locked is a skip, and the timer after Lock now does nothing', () => {
    const { p } = startParty()
    playAll(p, 1)
    hostAct(p, { type: 'lastCall', after: 1 })
    expect(lockNow(p).kind).toBe('commit')
    expect(p.game(GAME).wakeAt).toBeNull()
    p.tick(61_000)
    expect(p.sync(GAME).kind).toBe('skip')
    expect(lockNow(p).kind).toBe('skip')
  })
})

describe('the review of typed answers', () => {
  const config = parse(settings())
  const answers = {
    's1.title': answersOf(0, [
      ['a', { text: 'Papir Lanterner' }, 100],
      ['b', { text: 'papir lanterner!' }, 200],
      ['c', { text: 'Papir  Lanterner' }, 300],
      ['d', { text: 'Paper Lantrens' }, 400],
      ['e', { text: 'Mira Holm' }, 500],
      ['f', { text: '???' }, 600],
      ['g', { text: 'paper lanterns' }, 700],
      ['h', { text: 'Night Harbour' }, 800],
      ['i', { text: 'Lanterns' }, 900],
    ]),
    's1.singer': answersOf(0, [
      ['a', { text: 'Holm Mira' }, 100],
      ['b', { text: 'Mira' }, 200],
    ]),
  }
  const review = buildReview({ playedAt: [0] }, config, answers)

  it('groups answers by their normalised key, with the guests in arrival order and the spelling most of them typed', () => {
    const close = review[0].title.find((row) => row.key === 'papirlanterner')!
    expect(close).toEqual({
      key: 'papirlanterner',
      // "Papir Lanterner" and "Papir  Lanterner" tie at one each: the first to arrive wins; "papir lanterner!" is one too.
      text: 'Papir Lanterner',
      players: ['a', 'b', 'c'],
      verdict: 'close',
      reason: 'spelling',
      off: 3,
      accepted: false,
    })
  })

  it('judges each group once, and orders close, wrong, typo, exact; more guests first', () => {
    expect(review[0].title.map((row) => [row.key, row.verdict, row.reason])).toEqual([
      ['papirlanterner', 'close', 'spelling'],
      ['lanterns', 'close', 'part'],
      ['miraholm', 'close', 'otherPart'],
      ['', 'wrong', null],
      ['nightharbour', 'wrong', null],
      ['paperlantrens', 'typo', null],
      ['paperlanterns', 'exact', null],
    ])
    expect(review[0].singer.map((row) => [row.key, row.verdict])).toEqual([
      ['holmmira', 'exact'],
      ['mira', 'exact'],
    ])
  })

  it('gives spellings of one key the rule judges differently a row each, so nobody is judged by someone else\'s spelling', () => {
    const song = { ...config.songs[0], title: 'Someone Like You', alsoTitles: [] }
    const split = buildReview({ playedAt: [0] }, { ...config, songs: [song] }, {
      's1.title': answersOf(0, [
        ['a', { text: 'Some1 like you' }, 100],
        ['b', { text: 'Some one like you' }, 200],
        ['c', { text: 'Some1 like you' }, 300],
      ]),
    })
    expect(split[0].title.map((row) => [row.key, row.text, row.players, row.verdict])).toEqual([
      ['some1likeyou', 'Some1 like you', ['a', 'c'], 'close'],
      ['some1likeyou#2', 'Some one like you', ['b'], 'exact'],
    ])
  })

  it('reads picks: wall indices, no photo as null, texts as saved', () => {
    const picks = readPicks(
      { playedAt: [0, 0], wall: [0, 1, 2, 3, 4] },
      {
        's1.event': answersOf(0, [['a', { choice: ['3'] }, 1], ['b', { choice: ['none'] }, 2]]),
        's2.title': answersOf(0, [['c', { text: ' Glow ' }, 1]]),
      },
    )
    expect(picks).toEqual({
      a: { event: [3, null], title: [null, null], singer: [null, null] },
      b: { event: [null, null], title: [null, null], singer: [null, null] },
      c: { event: [null, null], title: [null, 'Glow'], singer: [null, null] },
    })
  })
})

/** A party of 6 with every song played and these answers, locked. */
function lockedParty(
  script: (p: FakeParty, ids: PlayerId[]) => void,
  { players = 6, overrides = {}, songOverrides = [] }: { players?: number; overrides?: Record<string, unknown>; songOverrides?: Record<string, unknown>[] } = {},
) {
  const party = startParty(players, overrides, songOverrides)
  playAll(party.p)
  script(party.p, party.ids)
  expect(lockNow(party.p).kind).toBe('commit')
  return party
}

describe('reveals', () => {
  it('reveal in order, after the lock; a double tap does nothing', () => {
    const { p } = startParty()
    playAll(p)
    expect(reveal(p, 0)).toMatchObject({ kind: 'refuse', message: 'Lock the answers first' })
    lockNow(p)
    expect(reveal(p, 1)).toMatchObject({ kind: 'refuse', message: 'Reveal the songs in order' })
    expect(reveal(p, 0).kind).toBe('commit')
    expect(reveal(p, 0).kind).toBe('skip')
    reveal(p, 1)
    reveal(p, 2)
    expect(reveal(p, 3)).toMatchObject({ kind: 'refuse', message: 'Every song is revealed. Crown Lydspor.' })
    expect(stateOf(p)).toMatchObject({ phase: 'reveal', revealed: 3 })
  })

  it("shows the song's truth and the room's counts, and each guest how it went", () => {
    const { p, ids } = lockedParty((p, ids) => {
      answer(p, 1, ids[0], 'paper lanterns', 'Mira Holm', rightPhoto(p, 1))
      answer(p, 1, ids[1], 'Paper Lantrens', 'Mira', rightPhoto(p, 2))
      answer(p, 1, ids[2], 'Papir Lanterner', 'Coldwave', null)
      typeIn(p, 2, 'title', ids[3], 'Seven Ferries')
    })
    expect(pub(p).reveal).toBeNull()
    reveal(p, 0)
    expect(pub(p).reveal).toEqual({
      n: 1,
      event: rightPhoto(p, 1),
      title: 'Paper Lanterns',
      singer: 'Mira Holm',
      caption: 'The harbour, 2009',
      counts: { event: 1, title: 2, singer: 2 },
      // Guests with any answer at the lock: ids[3] typed only song 2's title, and still counts.
      scoring: 4,
    })
    expect(viewOf(p, ids[0]).songs).toEqual([{ n: 1, points: 4, inPhoto: false, event: 'right', title: 'exact', singer: 'exact' }])
    expect(viewOf(p, ids[1]).songs).toEqual([{ n: 1, points: 2, inPhoto: false, event: 'wrong', title: 'typo', singer: 'exact' }])
    expect(viewOf(p, ids[2]).songs).toEqual([{ n: 1, points: 0, inPhoto: false, event: 'none', title: 'close', singer: 'wrong' }])
    expect(viewOf(p, ids[3]).songs).toEqual([{ n: 1, points: 0, inPhoto: false, event: 'none', title: 'none', singer: 'none' }])
    expect(viewOf(p, ids[0])).toMatchObject({ points: 4, rank: 1 })
    expect(viewOf(p, ids[1])).toMatchObject({ points: 2, rank: 2 })
    expect(viewOf(p, ids[2])).toMatchObject({ points: 0, rank: null })
    // The night board doesn't move until the crown.
    expect(p.game(GAME).scores).toEqual({})
    expect(p.log.filter((row) => row.data.type === 'song_revealed').map((row) => row.data)).toEqual([
      expect.objectContaining({ n: 1, counts: { event: 1, title: 2, singer: 2 }, scoring: 4 }),
    ])
  })

  it('shows the photos that fit no song after the last reveal only, with the songs never played', () => {
    const { p } = startParty()
    playAll(p, 2)
    lockNow(p)
    reveal(p, 0)
    expect(pub(p).extras).toBeNull()
    reveal(p, 1)
    const extras = pub(p).extras!
    expect(extras.map((x) => x.caption).sort()).toEqual(['A wedding, 2015', 'Ski trip, 2017', 'The allotment, 2019'])
    // In wall order, so the TV can letter them.
    const wall = pub(p).wall.map((w) => w.path)
    expect(extras.map((x) => wall.indexOf(x.path))).toEqual([...extras.map((x) => wall.indexOf(x.path))].sort((a, b) => a - b))
  })
})

describe('accept', () => {
  const closeTitles = () =>
    lockedParty((p, ids) => {
      answer(p, 1, ids[0], 'Papir Lanterner', 'Mira Holm', rightPhoto(p, 1))
      answer(p, 1, ids[1], 'papir lanterner', 'Coldwave', null)
      answer(p, 1, ids[2], 'Paper Lanterns', 'Night Harbour', null)
      typeIn(p, 1, 'title', ids[3], 'Mira Holm')
    })

  it('counts a close answer for everyone who typed it, and Undo takes it back', () => {
    const { p, ids } = closeTitles()
    reveal(p, 0)
    expect(pub(p).reveal!.counts.title).toBe(1)
    expect(viewOf(p, ids[0]).songs[0]).toMatchObject({ title: 'close', points: 3 })

    expect(accept(p, 0, 'title', 'papirlanterner').kind).toBe('commit')
    expect(pub(p).reveal!.counts.title).toBe(3)
    expect(viewOf(p, ids[0]).songs[0]).toMatchObject({ title: 'accepted', points: 4 })
    expect(viewOf(p, ids[1]).songs[0]).toMatchObject({ title: 'accepted', points: 1 })
    expect(pub(p).top.map((row) => [row.playerId, row.points])).toEqual([
      [ids[0], 4],
      [ids[1], 1],
      [ids[2], 1],
    ])
    // A double tap asks for what is there already.
    expect(accept(p, 0, 'title', 'papirlanterner').kind).toBe('skip')
    expect(stateOf(p).review![0].title.find((row) => row.key === 'papirlanterner')).toMatchObject({ accepted: true, players: [ids[0], ids[1]] })
    expect(p.log.filter((row) => row.data.type === 'answer_accepted').map((row) => row.data)).toEqual([
      expect.objectContaining({ n: 1, part: 'title', key: 'papirlanterner', players: 2 }),
    ])

    expect(accept(p, 0, 'title', 'papirlanterner', false).kind).toBe('commit')
    expect(pub(p).reveal!.counts.title).toBe(1)
    expect(viewOf(p, ids[1]).songs[0]).toMatchObject({ title: 'close', points: 0 })
    expect(accept(p, 0, 'title', 'papirlanterner', false).kind).toBe('skip')
    // Nothing is announced: phones and the TV follow the save.
    expect(p.feed).toEqual([])
  })

  it('accepts a wrong answer too, from Other answers', () => {
    const { p, ids } = closeTitles()
    reveal(p, 0)
    expect(accept(p, 0, 'singer', 'nightharbour').kind).toBe('commit')
    expect(viewOf(p, ids[2]).songs[0]).toMatchObject({ singer: 'accepted', points: 2 })
  })

  it('refuses what it cannot accept', () => {
    const { p } = closeTitles()
    expect(accept(p, 0, 'title', 'papirlanterner')).toMatchObject({ kind: 'refuse', message: 'Reveal song 1 first' })
    reveal(p, 0)
    expect(accept(p, 1, 'title', 'sevenferries')).toMatchObject({ kind: 'refuse', message: 'Reveal song 2 first' })
    expect(accept(p, 0, 'title', 'glow')).toMatchObject({ kind: 'refuse', message: 'Nobody typed that for song 1' })
    expect(accept(p, 0, 'title', 'paperlanterns')).toMatchObject({ kind: 'refuse', message: 'That answer counts already' })
    expect(accept(p, 0, 'singer', 'miraholm', false)).toMatchObject({ kind: 'refuse', message: 'That answer counts already' })
  })

  it('works for any revealed song until the crown, then refuses', () => {
    const { p, ids } = closeTitles()
    reveal(p, 0)
    hostAct(p, { type: 'standings', after: 1 })
    expect(stateOf(p).phase).toBe('standings')
    expect(accept(p, 0, 'title', 'papirlanterner').kind).toBe('commit')
    reveal(p, 1)
    reveal(p, 2)
    expect(accept(p, 0, 'title', 'papirlanterner', false).kind).toBe('commit')
    expect(accept(p, 0, 'title', 'papirlanterner').kind).toBe('commit')
    expect(hostAct(p, { type: 'crown' }).kind).toBe('commit')
    // The accept landed before the payout: 4 of 12 for ids[0].
    expect(pub(p).final!.find((row) => row.playerId === ids[0])).toMatchObject({ points: 4, paid: Math.round((4 * 20) / 12) })
    expect(accept(p, 0, 'title', 'papirlanterner', false)).toMatchObject({ kind: 'refuse', status: 409, code: 'not_running' })
    // And in the rules themselves: Lydspor is over.
    const done = stateOf(p)
    const { ctx } = createGameContext(testInfo(parse(settings()), ids), seededRandom())
    expect(() => game.handleHostAction(done, { type: 'accept', index: 0, part: 'title', key: 'papirlanterner', accepted: false }, ctx)).toThrow(
      'Lydspor is over',
    )
  })
})

describe('scoring', () => {
  it('pays nothing for a photo left on two songs at the lock: the guard', () => {
    const { p, ids } = lockedParty((p, ids) => {
      pickPhoto(p, 1, ids[0], rightPhoto(p, 1))
      pickPhoto(p, 2, ids[0], rightPhoto(p, 1))
      pickPhoto(p, 1, ids[1], rightPhoto(p, 1))
      pickPhoto(p, 2, ids[1], rightPhoto(p, 2))
    })
    reveal(p, 0)
    reveal(p, 1)
    expect(viewOf(p, ids[0]).songs.map((s) => [s.event, s.points])).toEqual([
      ['doubled', 0],
      ['doubled', 0],
    ])
    expect(viewOf(p, ids[1]).songs.map((s) => [s.event, s.points])).toEqual([
      ['right', 2],
      ['right', 2],
    ])
  })

  it('takes a photo from another song, which is left without one', () => {
    const { p, ids } = lockedParty((p, ids) => {
      pickPhoto(p, 1, ids[0], rightPhoto(p, 2))
      // Song 2 takes it: the phone writes song 1 to no photo first.
      pickPhoto(p, 1, ids[0], NO_PHOTO)
      pickPhoto(p, 2, ids[0], rightPhoto(p, 2))
    })
    expect(stateOf(p).picks![ids[0]].event).toEqual([null, rightPhoto(p, 2), null])
    reveal(p, 0)
    reveal(p, 1)
    expect(viewOf(p, ids[0]).songs.map((s) => s.event)).toEqual(['none', 'right'])
  })

  it('lets two songs share a singer, and the same typed singer scores on both', () => {
    const { p, ids } = lockedParty(
      (p, ids) => {
        typeIn(p, 1, 'singer', ids[0], 'Mira Holm')
        typeIn(p, 2, 'singer', ids[0], 'Mira Holm')
      },
      { songOverrides: [{}, { singer: 'Mira Holm' }] },
    )
    reveal(p, 0)
    reveal(p, 1)
    expect(viewOf(p, ids[0]).songs.map((s) => s.singer)).toEqual(['exact', 'exact'])
  })

  it('scores a guest in a photo as their own average at the crown, and leaves them out of that song', () => {
    const party = startParty(6)
    const { p, ids } = party
    hostAct(p, { type: 'setInPhoto', index: 0, playerIds: [ids[0]] })
    expect(hostAct(p, { type: 'setInPhoto', index: 0, playerIds: [ids[0]] }).kind).toBe('skip')
    playAll(p)
    // In the photo of song 1: their answers there are ignored.
    answer(p, 1, ids[0], 'Paper Lanterns', 'Mira Holm', rightPhoto(p, 1))
    answer(p, 2, ids[0], 'Seven Ferries', 'Coldwave', rightPhoto(p, 2))
    answer(p, 3, ids[0], 'Old Oak', 'Night Harbour', extraPhoto(p))
    answer(p, 1, ids[1], 'Paper Lanterns', null, null)
    lockNow(p)
    reveal(p, 0)
    expect(pub(p).reveal).toMatchObject({ counts: { event: 0, title: 1, singer: 0 }, scoring: 1 })
    expect(viewOf(p, ids[0]).songs[0]).toEqual({ n: 1, points: 0, inPhoto: true, event: 'right', title: 'exact', singer: 'exact' })
    reveal(p, 1)
    expect(viewOf(p, ids[0])).toMatchObject({ points: 4, credit: 0 })
    reveal(p, 2)
    // Every song played is revealed: the own average counts now, on the phone and in the last top 5, as the crown will.
    expect(viewOf(p, ids[0])).toMatchObject({ points: 4 + 1 + 3, credit: 3, rank: 1 })
    hostAct(p, { type: 'standings', after: 3 })
    expect(pub(p).top).toEqual([
      { playerId: ids[0], points: 8, credit: 3, rank: 1, gained: 5 },
      { playerId: ids[1], points: 1, credit: 0, rank: 2, gained: 1 },
    ])
    hostAct(p, { type: 'crown' })
    // Earned 5 over the 2 songs played: round(5 / 2 * 1) = 3 for the song in the photo.
    expect(stateOf(p).credits).toEqual({ [ids[0]]: 3, [ids[1]]: 0 })
    expect(viewOf(p, ids[0]).final).toEqual({ points: 8, credit: 3, place: 1, paid: Math.round((8 * 20) / 12) })
    expect(p.game(GAME).scores).toEqual({ [ids[0]]: 13, [ids[1]]: 2 })
    expect(p.game(GAME).winners).toEqual([ids[0]])
  })

  it('pays the night board on a scale to at most boardMax, from the songs revealed', () => {
    const { p, ids } = lockedParty(
      (p, ids) => {
        for (const n of [1, 2]) answer(p, n, ids[0], SONGS[n - 1].title, SONGS[n - 1].singer, rightPhoto(p, n))
        answer(p, 1, ids[1], SONGS[0].title, null, null)
      },
      { overrides: { boardMax: 10 } },
    )
    reveal(p, 0)
    reveal(p, 1)
    // Crowned early: song 3 never counts. The most is 2 songs of 4 points.
    hostAct(p, { type: 'crown' })
    expect(pub(p).final).toEqual([
      { playerId: ids[0], points: 8, place: 1, paid: 10 },
      { playerId: ids[1], points: 1, place: 2, paid: 1 },
    ])
    expect(p.game(GAME).scores).toEqual({ [ids[0]]: 10, [ids[1]]: 1 })
  })

  it('crowns everyone tied at the top, and nobody at 0', () => {
    const tie = lockedParty((p, ids) => {
      typeIn(p, 1, 'title', ids[0], 'Paper Lanterns')
      typeIn(p, 1, 'title', ids[1], 'paper lanterns')
      typeIn(p, 1, 'title', ids[2], 'Night Harbour')
    })
    reveal(tie.p, 0)
    hostAct(tie.p, { type: 'crown' })
    expect(tie.p.game(GAME).winners).toEqual([tie.ids[0], tie.ids[1]])
    expect(pub(tie.p).final!.map((row) => row.place)).toEqual([1, 1, 3])
    expect(tie.p.feed.map((item) => item.message)).toEqual(['Guest 1 and Guest 2 win Lydspor!', 'You won Lydspor!'])

    const nobody = lockedParty((p, ids) => typeIn(p, 1, 'title', ids[0], 'Night Harbour'))
    reveal(nobody.p, 0)
    hostAct(nobody.p, { type: 'crown' })
    expect(nobody.p.game(GAME).winners).toEqual([])
    expect(nobody.p.feed).toEqual([expect.objectContaining({ message: 'Lydspor is over', detail: 'Nobody scored this time' })])
  })

  it("shows the top 5 with each guest's gain since the last top 5", () => {
    const { p, ids } = lockedParty((p, ids) => {
      for (const n of [1, 2, 3]) answer(p, n, ids[0], SONGS[n - 1].title, null, null)
      answer(p, 3, ids[1], SONGS[2].title, SONGS[2].singer, null)
    })
    reveal(p, 0)
    expect(hostAct(p, { type: 'standings', after: 0 }).kind).toBe('skip')
    expect(hostAct(p, { type: 'standings', after: 1 }).kind).toBe('commit')
    expect(hostAct(p, { type: 'standings', after: 1 }).kind).toBe('skip')
    expect(pub(p).top).toEqual([{ playerId: ids[0], points: 1, credit: 0, rank: 1, gained: 1 }])
    reveal(p, 1)
    reveal(p, 2)
    hostAct(p, { type: 'standings', after: 3 })
    expect(pub(p).top).toEqual([
      { playerId: ids[0], points: 3, credit: 0, rank: 1, gained: 2 },
      { playerId: ids[1], points: 2, credit: 0, rank: 2, gained: 2 },
    ])
  })
})

describe('the crown', () => {
  it('is refused while songs play, and announces the winner once', () => {
    const { p, ids } = startParty()
    playAll(p, 1)
    expect(hostAct(p, { type: 'crown' })).toMatchObject({ kind: 'refuse', message: 'Lock the answers first' })
    answer(p, 1, ids[0], 'Paper Lanterns', 'Mira Holm', rightPhoto(p, 1))
    lockNow(p)
    reveal(p, 0)
    expect(p.feed).toEqual([])
    expect(hostAct(p, { type: 'crown' }).kind).toBe('commit')
    expect(p.game(GAME)).toMatchObject({ status: 'finished', finishedBy: 'game', winners: [ids[0]] })
    expect(p.feed).toEqual([
      expect.objectContaining({ message: 'Guest 1 wins Lydspor!', detail: '4 Lydspor points', sound: 'fanfare', interrupt: true, audience: null }),
      expect.objectContaining({ message: 'You won Lydspor!', detail: '+20 on the night board', audience: [ids[0]] }),
    ])
    expect(p.players[0].profile.soundtrack).toEqual({ wins: 1 })
    expect(hostAct(p, { type: 'crown' })).toMatchObject({ kind: 'refuse', code: 'not_running' })
  })

  it('crowns from the lobby with nobody, and ends like a crown when the host ends it', () => {
    const lobby = startParty()
    expect(hostAct(lobby.p, { type: 'crown' }).kind).toBe('commit')
    expect(lobby.p.game(GAME).winners).toEqual([])

    const { p, ids } = startParty()
    playAll(p, 1)
    answer(p, 1, ids[0], 'Paper Lanterns', null, null)
    lockNow(p)
    reveal(p, 0)
    expect(p.send(p.hostUser, { type: 'end', gameId: GAME }).kind).toBe('commit')
    // 1 of the 4 points one song gives, scaled to 20.
    expect(p.game(GAME)).toMatchObject({ status: 'finished', finishedBy: 'host', winners: [ids[0]], scores: { [ids[0]]: 5 } })
    expect(p.feed[0]).toMatchObject({ message: 'Lydspor is over', detail: 'Guest 1 won with 1 Lydspor point' })
  })
})

describe('sitting out', () => {
  it('leaves them out of every count, ranking and payout, and their phone shows nothing to answer', () => {
    const { p, ids } = startParty(6, { sitOut: [] })
    expect(pub(p).playing).toBe(6)
    expect(hostAct(p, { type: 'sitOut', playerIds: [ids[5], ids[4]] }).kind).toBe('commit')
    expect(hostAct(p, { type: 'sitOut', playerIds: [ids[4], ids[5]] }).kind).toBe('skip')
    expect(pub(p).playing).toBe(4)
    playAll(p, 1)
    answer(p, 1, ids[5], 'Paper Lanterns', 'Mira Holm', rightPhoto(p, 1))
    answer(p, 1, ids[0], 'Paper Lanterns', null, null)
    lockNow(p)
    reveal(p, 0)
    expect(pub(p).reveal).toMatchObject({ counts: { event: 0, title: 1, singer: 0 }, scoring: 1 })
    expect(viewOf(p, ids[5])).toEqual({ sittingOut: true, mine: null, songs: [], points: 0, credit: 0, rank: null, final: null })
    expect(pub(p).top.map((row) => row.playerId)).toEqual([ids[0]])
    // Taken off the list, they count from then on: their locked answers score.
    hostAct(p, { type: 'sitOut', playerIds: [ids[4]] })
    expect(pub(p).reveal).toMatchObject({ counts: { event: 1, title: 2, singer: 1 }, scoring: 2 })
    hostAct(p, { type: 'crown' })
    expect(Object.keys(p.game(GAME).scores).sort()).toEqual([ids[0], ids[5]].sort())
    expect(hostAct(p, { type: 'sitOut', playerIds: [] })).toMatchObject({ kind: 'refuse', code: 'not_running' })
  })

  it('starts from the settings list', () => {
    const { p, ids } = startParty(4)
    hostAct(p, { type: 'sitOut', playerIds: [ids[0]] })
    expect(stateOf(p).sitOut).toEqual([ids[0]])
    expect(parse(settings({ sitOut: ['x', 'x', 'y'] })).sitOut).toEqual(['x', 'y'])
  })
})

describe('guests leaving and joining late', () => {
  it('lets a late joiner answer every song played so far, and drops a leaver from the counts and the board', () => {
    const { p, ids } = startParty(4)
    playAll(p, 2)
    const late = p.addPlayer('Late guest')
    expect(p.sync(GAME).kind).not.toBe('refuse')
    expect(viewOf(p, late.id)).toMatchObject({ sittingOut: false, mine: null, songs: [] })
    expect(pub(p).playing).toBe(5)
    answer(p, 1, late.id, 'Paper Lanterns', 'Mira Holm', rightPhoto(p, 1))
    answer(p, 1, ids[3], 'Paper Lanterns', 'Mira Holm', rightPhoto(p, 1))
    p.removePlayer(ids[3])
    p.sync(GAME)
    expect(pub(p).playing).toBe(4)
    lockNow(p)
    // Leaving the party takes the leaver's answers with them.
    expect(Object.keys(stateOf(p).picks!)).toEqual([late.id])
    reveal(p, 0)
    expect(pub(p).reveal).toMatchObject({ counts: { event: 1, title: 1, singer: 1 }, scoring: 1 })
    expect(viewOf(p, late.id).points).toBe(4)
    // Someone who joins after the lock has no answers: their phone shows each revealed song as no answer.
    const later = p.addPlayer('After the lock')
    p.sync(GAME)
    expect(viewOf(p, later.id).songs).toEqual([{ n: 1, points: 0, inPhoto: false, event: 'none', title: 'none', singer: 'none' }])
    hostAct(p, { type: 'crown' })
    expect(Object.keys(p.game(GAME).scores)).toEqual([late.id])
  })
})

describe('a guest who leaves after the lock', () => {
  it('drops their locked answers, and with them the counts, the top 5 and the payout', () => {
    const { p, ids } = lockedParty((p, ids) => {
      answer(p, 1, ids[0], 'Paper Lanterns', 'Mira Holm', rightPhoto(p, 1))
      answer(p, 1, ids[1], 'Paper Lanterns', null, null)
    })
    reveal(p, 0)
    expect(pub(p).reveal).toMatchObject({ counts: { event: 1, title: 2, singer: 1 }, scoring: 2 })
    p.removePlayer(ids[0])
    p.sync(GAME)
    // Gone with them, so whoever takes a freed name next starts with nothing (docs/guest-list.md, 9.3).
    expect(Object.keys(stateOf(p).picks!)).toEqual([ids[1]])
    expect(pub(p).reveal).toMatchObject({ counts: { event: 0, title: 1, singer: 0 }, scoring: 1 })
    expect(pub(p).top.map((row) => row.playerId)).toEqual([ids[1]])
    hostAct(p, { type: 'crown' })
    expect(p.game(GAME).winners).toEqual([ids[1]])
    expect(Object.keys(p.game(GAME).scores)).toEqual([ids[1]])
  })
})

// The guest list (docs/guest-list.md, 9.3): "Doesn't play this game" and who is
// in a photo may name guests the host listed who haven't joined. Only the
// guests here answer and score; a name freed and taken again starts with nothing.

describe('guests on the list who are not here', () => {
  /** A party of `players` with Zelda, Ulrik, Quentin and Ximena listed and not joined, Lydspor set up from `make`. */
  function listedParty(players: number, make: (listed: Record<'zelda' | 'ulrik' | 'quentin' | 'ximena', PlayerId>, ids: PlayerId[]) => Record<string, unknown>) {
    const p = simulateParty({ games: [new SoundtrackGame()], players })
    const ids = p.players.map((pl) => pl.id)
    const listed = {
      zelda: p.listGuest('Zelda').id,
      ulrik: p.listGuest('Ulrik').id,
      quentin: p.listGuest('Quentin').id,
      ximena: p.listGuest('Ximena').id,
    }
    p.addGame(GAME, 'soundtrack', 'Lydspor', make(listed, ids))
    expect(p.send(p.hostUser, { type: 'start', gameId: GAME }).kind).toBe('commit')
    return { p, ids, listed }
  }

  it('sits a listed guest out from the moment they join, puts one in a photo once they join, and lets the ones who never come change nothing', () => {
    const { p, ids, listed } = listedParty(4, (g, ids) =>
      settings({ sitOut: [g.ulrik, g.ximena] }, [{ inPhoto: [g.zelda] }, { inPhoto: [g.quentin, ids[0]] }]),
    )
    expect(stateOf(p).sitOut).toEqual([listed.ulrik, listed.ximena])
    expect(stateOf(p).inPhoto).toEqual([[listed.zelda], [listed.quentin, ids[0]], []])
    // Only the guests here count: nobody listed is in the room's numbers.
    expect(pub(p).playing).toBe(4)
    playAll(p, 2)
    p.claimGuest(listed.zelda) // in song 1's photo
    p.claimGuest(listed.ximena) // sits out
    p.sync(GAME)
    expect(pub(p).playing).toBe(5)
    expect(viewOf(p, listed.ximena)).toMatchObject({ sittingOut: true, songs: [] })
    expect(viewOf(p, listed.zelda)).toMatchObject({ sittingOut: false, mine: null })
    answer(p, 1, listed.zelda, 'Paper Lanterns', 'Mira Holm', rightPhoto(p, 1)) // her own photo: scores nothing on it
    answer(p, 2, listed.zelda, 'Seven Ferries', 'Coldwave', rightPhoto(p, 2))
    answer(p, 1, listed.ximena, 'Paper Lanterns', 'Mira Holm', rightPhoto(p, 1)) // sits out: scores nothing
    answer(p, 1, ids[1], 'Paper Lanterns', 'Mira Holm', rightPhoto(p, 1))
    answer(p, 2, ids[1], 'Seven Ferries', 'Coldwave', rightPhoto(p, 2))
    answer(p, 2, ids[0], 'Seven Ferries', 'Coldwave', rightPhoto(p, 2)) // in song 2's photo
    lockNow(p)
    reveal(p, 0)
    expect(pub(p).reveal).toMatchObject({ n: 1, counts: { event: 1, title: 1, singer: 1 }, scoring: 2 })
    expect(viewOf(p, listed.zelda).songs[0]).toMatchObject({ inPhoto: true, points: 0 })
    reveal(p, 1)
    // Quentin never came; Ana (ids[0]) is in song 2's photo with him: the song still counts as hers.
    expect(pub(p).reveal).toMatchObject({ n: 2, counts: { event: 2, title: 2, singer: 2 }, scoring: 2 })
    expect(viewOf(p, ids[0]).songs[1]).toMatchObject({ inPhoto: true, points: 0 })
    hostAct(p, { type: 'crown' })
    const scores = p.game(GAME).scores
    expect(Object.keys(scores).sort()).toEqual([ids[1], listed.zelda].sort())
    for (const id of [listed.ulrik, listed.quentin, listed.ximena]) expect(scores).not.toHaveProperty(id)
    // Nothing about a listed guest reaches the room: not in the public state, not a view of their own.
    const room = JSON.stringify(pub(p))
    for (const id of [listed.ulrik, listed.quentin]) {
      expect(room).not.toContain(id)
      expect(p.game(GAME).views).not.toHaveProperty(id)
    }
  })

  it('gives a freed name taken again nothing from the round: no picks, no review rows, no points', () => {
    const p = simulateParty({ games: [new SoundtrackGame()], players: 4 })
    const ids = p.players.map((pl) => pl.id)
    const zelda = p.listGuest('Zelda')
    p.claimGuest(zelda.id)
    p.addGame(GAME, 'soundtrack', 'Lydspor', settings({ sitOut: [] }, [{ inPhoto: [zelda.id] }]))
    p.send(p.hostUser, { type: 'start', gameId: GAME })
    playAll(p)
    answer(p, 2, zelda.id, 'Seven Ferries', 'Coldwave', rightPhoto(p, 2))
    answer(p, 3, zelda.id, 'Old Oak', 'The Lanterns', rightPhoto(p, 3))
    answer(p, 2, ids[0], 'Seven Ferries', null, null)
    expect(lockNow(p).kind).toBe('commit')
    expect(Object.keys(stateOf(p).picks!).sort()).toEqual([ids[0], zelda.id].sort())
    p.tick(1000)
    p.freeGuest(zelda.id) // the wrong phone had her name
    p.sync(GAME)
    expect(stateOf(p).picks).not.toHaveProperty(zelda.id)
    p.tick(1000)
    p.claimGuest(zelda.id) // the real Zelda takes it
    p.sync(GAME)
    const review = stateOf(p).review!
    expect(review.flatMap((song) => [...song.title, ...song.singer]).flatMap((row) => row.players)).not.toContain(zelda.id)
    // A row only she typed went with her: Coldwave, and all of song 3.
    expect(review[1].singer).toEqual([])
    expect(review[2]).toEqual({ title: [], singer: [] })
    // The listed guest is still in song 1's photo: the id names her, not the phone.
    expect(stateOf(p).inPhoto[0]).toEqual([zelda.id])
    reveal(p, 0)
    reveal(p, 1)
    expect(pub(p).reveal).toMatchObject({ n: 2, counts: { event: 0, title: 1, singer: 0 }, scoring: 1 })
    expect(viewOf(p, zelda.id)).toMatchObject({ sittingOut: false, mine: null, points: 0 })
    reveal(p, 2)
    hostAct(p, { type: 'crown' })
    expect(Object.keys(p.game(GAME).scores)).toEqual([ids[0]])
    expect(p.game(GAME).winners).toEqual([ids[0]])
  })

  it("drops a leaver's picks, review rows, top 5 points and own average, and keeps who sits out and who is in a photo", () => {
    const { p, ids } = lockedParty(
      (p, ids) => {
        // In song 2's photo, so her own average comes at the crown.
        hostAct(p, { type: 'setInPhoto', index: 1, playerIds: [ids[0]] })
        answer(p, 1, ids[0], 'Paper Lanterns', 'Mira Holm', rightPhoto(p, 1))
        answer(p, 1, ids[1], 'Paper Lantern', 'Mira', rightPhoto(p, 1))
        answer(p, 2, ids[1], 'Seven Ferries', 'Coldwave', rightPhoto(p, 2))
      },
      { overrides: { sitOut: [] } },
    )
    reveal(p, 0)
    hostAct(p, { type: 'standings', after: 1 })
    reveal(p, 1)
    reveal(p, 2)
    hostAct(p, { type: 'crown' })
    const done = stateOf(p)
    expect(done.shownTop).toHaveProperty(ids[0])
    expect(done.credits).toHaveProperty(ids[0])
    const sat = { ...done, sitOut: [ids[0]] }
    const left = game.onPlayerLeave(sat, ids[0])
    expect(left.picks).not.toHaveProperty(ids[0])
    expect(left.shownTop).not.toHaveProperty(ids[0])
    expect(left.credits).not.toHaveProperty(ids[0])
    const rows = left.review!.flatMap((song) => [...song.title, ...song.singer])
    expect(rows.flatMap((row) => row.players)).not.toContain(ids[0])
    expect(rows.every((row) => row.players.length > 0)).toBe(true)
    // "Paper Lanterns" and "Mira Holm" were only hers; "Paper Lantern" and "Mira" stay with Bo.
    expect(left.review![0].title.map((row) => row.text)).toEqual(['Paper Lantern'])
    expect(left.sitOut).toEqual([ids[0]])
    expect(left.inPhoto).toEqual(done.inPhoto)
    // Someone with nothing in the round changes nothing.
    expect(game.onPlayerLeave(done, 'never-here')).toBe(done)
  })
})

describe('secrets', () => {
  it('never puts an unrevealed title, singer or caption, a typed answer or who is in a photo in public', () => {
    const { p, ids } = startParty(6, {}, [{ inPhoto: [] }])
    hostAct(p, { type: 'setInPhoto', index: 1, playerIds: [ids[5]] })
    const secret = (from: number) => SONGS.slice(from).flatMap((s) => [s.title, s.singer, s.caption, ...s.alsoTitles, ...s.alsoSingers])
    const typed = ['Papir Lanterner', 'Sevn Ferries', 'Holm Mira', 'Old Oack']
    const check = (revealed: number) => {
      const text = canonicalJson(pub(p))
      for (const word of secret(revealed)) expect(text, word).not.toContain(word)
      for (const word of typed) expect(text, word).not.toContain(word)
      expect(text).not.toContain('inPhoto')
      expect(text).not.toContain('also')
      // Phones see their own answers only.
      for (const id of ids.slice(1)) {
        const view = canonicalJson(viewOf(p, id))
        for (const word of [...secret(revealed), ...typed]) expect(view, word).not.toContain(word)
      }
    }
    check(0)
    playAll(p)
    typeIn(p, 1, 'title', ids[0], typed[0])
    typeIn(p, 2, 'title', ids[0], typed[1])
    typeIn(p, 1, 'singer', ids[0], typed[2])
    typeIn(p, 3, 'title', ids[0], typed[3])
    check(0)
    lockNow(p)
    check(0)
    expect(viewOf(p, ids[0]).mine!.title).toEqual([typed[0], typed[1], typed[3]])
    for (let i = 0; i < SONGS.length; i++) {
      reveal(p, i)
      check(i + 1)
      expect(canonicalJson(pub(p))).toContain(SONGS[i].title)
    }
    expect(JSON.stringify(p.promptsOf(GAME).map((x) => x.spec))).not.toMatch(/Lanterns|Ferries|Oak/)
  })

  it('shows captions under the photos only with hints on', () => {
    expect(pub(startParty().p).wall.every((w) => w.hint === null)).toBe(true)
    const hinted = pub(startParty(3, { hints: true }).p).wall.map((w) => w.hint).sort()
    expect(hinted).toEqual(['A wedding, 2015', 'Island trip, 2012', 'Ski trip, 2017', 'The allotment, 2019', 'The harbour, 2009'])
  })
})

describe('host actions from the page', () => {
  it('refuses garbage with a GameError, and reads every step', () => {
    for (const input of [null, {}, { type: 'play' }, { type: 'play', index: -1 }, { type: 'accept', index: 0, part: 'event', key: 'x', accepted: true }]) {
      expect(() => game.parseHostAction(input)).toThrow(GameError)
    }
    expect(() => game.parseHostAction({ type: 'setInPhoto', index: 0, playerIds: Array.from({ length: 11 }, (_, i) => `p${i}`) })).toThrow(
      'At most 10 people in a photo',
    )
    expect(game.parseHostAction({ type: 'sitOut', playerIds: ['a', 'a', 'b'] })).toEqual({ type: 'sitOut', playerIds: ['a', 'b'] })
    expect(game.parseHostAction({ type: 'accept', index: 2, part: 'singer', key: 'miraholm', accepted: false })).toEqual({
      type: 'accept',
      index: 2,
      part: 'singer',
      key: 'miraholm',
      accepted: false,
    })
  })

  it('refuses who is in a photo for a song that is not there', () => {
    const { p } = startParty()
    expect(hostAct(p, { type: 'setInPhoto', index: 5, playerIds: [] })).toMatchObject({ kind: 'refuse', message: 'There is no such song' })
  })
})

describe('recap', () => {
  it('returns nothing while the round runs', () => {
    const { p } = lockedParty(() => {})
    expect(game.recap(recapOf(p))).toEqual([])
  })

  it('names the champion and, from revealed songs only, the best known and the hardest song; never a typed answer', () => {
    const { p, ids } = lockedParty((p, ids) => {
      for (const id of ids.slice(0, 4)) answer(p, 1, id, 'Paper Lanterns', 'Mira Holm', rightPhoto(p, 1))
      answer(p, 2, ids[0], 'Sevn Ferries', null, null)
      answer(p, 3, ids[0], 'Old Oak', 'The Lanterns', rightPhoto(p, 3))
    })
    reveal(p, 0)
    reveal(p, 1)
    hostAct(p, { type: 'crown' })
    const highlights = game.recap(recapOf(p))
    expect(highlights).toEqual([
      expect.objectContaining({ title: 'Lydspor champion: Guest 1', detail: '5 Lydspor points', players: [ids[0]], weight: 'headline' }),
      expect.objectContaining({ title: 'Best known song: “Paper Lanterns” by Mira Holm', detail: '4 of 4 placed its photo, 4 typed the title, 4 the singer' }),
      expect.objectContaining({ title: 'Hardest song: “Seven Ferries” by Coldwave', detail: '0 of 4 placed its photo, 1 typed the title, 0 the singer' }),
    ])
    const text = JSON.stringify(highlights)
    for (const hidden of ['Under the Old Oak Tree', 'The Lanterns', 'Sevn']) expect(text).not.toContain(hidden)
  })
})

describe('the contract', () => {
  it('keeps its contract over an example with typed answers, a swap, a join, a leave and an accept', () => {
    const roster = simulateParty({ games: [game], players: 4 }).players.map((pl) => pl.id)
    const text = (n: number, part: TypedPart, player: number, value: string) =>
      ({ kind: 'answer', player, key: promptKey(n, part), answer: { text: value } satisfies AnswerPayload }) as const
    const example: ContractExample = {
      config: settings({}, [{ inPhoto: [roster[1]] }]),
      players: 4,
      steps: [
        { kind: 'host', action: { type: 'play', index: 0 } },
        text(1, 'title', 0, 'Papir Lanterner'),
        text(1, 'singer', 0, 'Mira Holm'),
        { kind: 'answer', player: 0, key: 's1.event', answer: { choice: ['0'] } },
        { kind: 'join' },
        text(1, 'title', 4, 'Paper Lanterns'),
        { kind: 'host', action: { type: 'play', index: 1 } },
        { kind: 'host', action: { type: 'play', index: 1 } },
        { kind: 'answer', player: 0, key: 's2.event', answer: { choice: ['0'] } },
        { kind: 'answer', player: 0, key: 's1.event', answer: { choice: ['1'] } },
        { kind: 'leave', player: 3 },
        { kind: 'host', action: { type: 'play', index: 2 } },
        { kind: 'host', action: { type: 'lastCall', after: 3 } },
        { kind: 'host', action: { type: 'more', n: 1 } },
        { kind: 'tick', ms: 90_000 },
        { kind: 'sync' },
        { kind: 'tick', ms: 1_000 },
        { kind: 'sync' },
        { kind: 'host', action: { type: 'reveal', index: 0 } },
        { kind: 'host', action: { type: 'accept', index: 0, part: 'title', key: 'papirlanterner', accepted: true } },
        { kind: 'host', action: { type: 'accept', index: 0, part: 'title', key: 'papirlanterner', accepted: true } },
        { kind: 'host', action: { type: 'standings', after: 1 } },
        { kind: 'host', action: { type: 'reveal', index: 1 } },
        { kind: 'host', action: { type: 'setInPhoto', index: 2, playerIds: [roster[2]] } },
        { kind: 'host', action: { type: 'reveal', index: 2 } },
        { kind: 'host', action: { type: 'crown' } },
      ],
    }
    expect(checkGameContract(game, example)).toEqual([])
  })

  it('keeps its contract over a round its bot plays', () => {
    const result = botExample(game, bot)
    if ('refused' in result) throw new Error(result.refused)
    expect(checkGameContract(game, result.example)).toEqual([])
    // The bot's round reaches the crown by itself.
    expect(result.example.steps.some((s) => s.kind === 'host' && (s.action as { type: string }).type === 'crown')).toBe(true)
  })

  it('plays a party of 24 through the bot: 3 songs, the timer locks, reveals with accepts, the crown and a capped payout', () => {
    const p = simulateParty({ games: [new SoundtrackGame()], players: 24 })
    const ids = p.players.map((pl) => pl.id)
    p.addGame(GAME, 'soundtrack', 'Lydspor', bot.settings!(ids))
    p.send(p.hostUser, { type: 'start', gameId: GAME })
    const random = seededRandom(11)
    const players = () => p.players.map((pl) => ({ id: pl.id, name: pl.name, code: p.codeOf(pl.id) }))
    let accepts = 0
    for (let second = 0; second < 200 && p.game(GAME).status === 'active'; second++) {
      for (const id of ids) {
        const move = bot.move({
          playerId: id,
          players: players(),
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
        players: players(),
        publicState: p.game(GAME).publicState,
        prompts: p.promptsOf(GAME),
        now: p.now,
        random,
        state: stored.state,
        config: stored.config,
        tallies: p.talliesOf(GAME),
      })
      if (hostMove) {
        const result = hostAct(p, hostMove.action, hostMove.close)
        expect(result.kind, JSON.stringify(hostMove.action)).not.toBe('refuse')
        if ((hostMove.action as { type: string }).type === 'accept' && result.kind === 'commit') accepts++
      }
      p.tick(1000)
      const wake = p.game(GAME).wakeAt
      if (wake !== null && wake <= p.now) p.sync(GAME)
    }
    const final = p.game(GAME)
    expect(final.status).toBe('finished')
    expect(stateOf(p)).toMatchObject({ phase: 'done', revealed: 3 })
    expect(accepts).toBeGreaterThan(0)
    expect(final.winners.length).toBeGreaterThan(0)
    expect(Math.max(...Object.values(final.scores))).toBeLessThanOrEqual(20)
    // Every guest typed and placed something; the photo guest's song is their own average.
    expect(Object.keys(stateOf(p).picks!)).toHaveLength(24)
    expect(stateOf(p).credits![ids[1]]).toBeGreaterThanOrEqual(0)
  })
})

describe('the bot', () => {
  it('types misspellings the rule forgives, close ones it puts before the host, and never moves outside play', () => {
    const random = seededRandom(3)
    for (let i = 0; i < 20; i++) {
      expect(judge(misspell('Paper Lanterns', 1, random), 'title', ['Paper Lanterns'], []).verdict).toMatch(/exact|typo/)
      expect(judge(misspell('Paper Lanterns', 3, random), 'title', ['Paper Lanterns'], []).verdict).toMatch(/close|typo/)
    }
    const sight = { playerId: 'a', players: [], view: null, prompts: [], myAnswers: {}, now: 0, random }
    expect(bot.move({ ...sight, publicState: { phase: 'locked', wall: [] } })).toBeNull()
    expect(bot.move({ ...sight, publicState: { phase: 'playing', wall: [] }, view: { sittingOut: true } })).toBeNull()
  })
})
