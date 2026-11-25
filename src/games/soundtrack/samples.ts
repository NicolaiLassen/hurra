// Sample Lydspor rounds for the fixture scenes (src/lib/fixtures.ts), so the
// TV, the phone and the host room can be built and tested without a live
// party. Every song, singer, caption and answer here is invented: the owner's
// real songs live only in the game's settings on the night.
//
// Each scene is played through the real logic (setup, Play song n, the last
// call, the timer's lock, reveals, an accept, the top 5, the crown) on the
// fixture party, so its state, public state, views and points always agree.
import { createGameContext } from '../core/context'
import type { Answer, AnswerPayload, GameContext, GameInfo, GamePlayer, PlayerId, Prompt, PromptSpec } from '../core/Game'
import { seededRandom } from '../core/testing'
import { misspell } from './bot'
import { SoundtrackGame } from './logic'
import {
  promptKey,
  type SoundtrackConfig,
  type SoundtrackHostAction,
  type SoundtrackPlayerView,
  type SoundtrackPublicState,
  type SoundtrackState,
  type TypedPart,
} from './types'

export const SOUNDTRACK_SCENES = ['lobby', 'playing', 'last-call', 'locked', 'reveal', 'standings', 'final'] as const
export type SoundtrackScene = (typeof SOUNDTRACK_SCENES)[number]

/** Eight invented songs, in play order. */
export const SAMPLE_SONGS = [
  { title: 'Paper Lanterns', singer: 'Mira Holm', caption: 'The harbour, 2009', startAt: 48, also: [[], []] },
  { title: 'Seven Ferries', singer: 'Coldwave', caption: 'Island trip, 2012', startAt: 62, also: [[], []] },
  { title: 'Blå Mandag', singer: 'Søren Bækgaard', caption: 'First flat, 2014', startAt: 35, also: [[], ['Søren B']] },
  { title: 'Salt & Sand', singer: 'Ditte & Vincent', caption: 'Graduation, 2016', startAt: 71, also: [[], []] },
  { title: 'Natlys (Radio Edit)', singer: 'R.O.S.A.', caption: 'Road trip, 2018', startAt: 20, also: [[], []] },
  { title: 'Under the Old Oak Tree', singer: 'The Lanterns', caption: 'The allotment, 2019', startAt: 54, also: [['Old Oak'], []] },
  { title: "Rock 'n' Roll Harbour", singer: 'Chloé Ølstad', caption: 'Festival, 2021', startAt: 88, also: [[], []] },
  { title: 'Route 41', singer: 'Mira Holm feat. Kasper Lind', caption: 'New job, 2023', startAt: 40, also: [[], ['Mira']] },
] as const

const EXTRA_CAPTIONS = ['A wedding, 2015', 'Ski trip, 2017', 'Moving day, 2020', 'Concert, 2022']
const WRONG = ['Night Harbour', 'Glass Rain', 'Copper Sun', 'Lake Dancers', 'The Tin Owls', 'Velvet Roads', 'Coldplay']

/** A sample game-media path, uuid-shaped like an upload's, so nothing in it names a song. */
const photoPath = (n: number) => `f1c7a000-0000-4000-8000-000000001001/f1c7a000-0000-4000-8000-000000003005/f1c7a000-0000-4000-8000-${String(7000 + n).padStart(12, '0')}.jpg`

export type SampleCast = {
  /** The party, in join order. Index 3 is the phone's guest, 5 the operator, 6 the storyteller. */
  players: readonly { id: PlayerId; name: string }[]
}

/** A prompt as the snapshot carries it, without its game id. */
export type SamplePrompt = {
  key: string
  spec: PromptSpec
  opened_at: number
  closes_at: number | null
  closed_at: number | null
  revealed_at: number | null
}

export type SoundtrackSample = {
  config: SoundtrackConfig
  state: SoundtrackState
  publicState: SoundtrackPublicState
  views: Record<PlayerId, SoundtrackPlayerView>
  /** Each guest's own answers, by prompt key: what `myAnswers` reads back. */
  answers: Record<PlayerId, Record<string, AnswerPayload>>
  prompts: SamplePrompt[]
  /** First answers per open prompt: what the TV and the host page count. */
  tallies: Record<string, number>
  /** scores(): nothing until the crown, then the payout. */
  points: Record<PlayerId, number>
  winners: PlayerId[]
  startedAt: number
  /** The crown's time in the final scene. */
  finishedAt: number | null
  /** What the round announced, oldest first (only the crown does). */
  announcements: { message: string; detail?: string; to?: PlayerId[]; sound?: string; icon?: string; tone?: string; interrupt?: boolean; at: number }[]
}

/** The settings of the sample round: 8 songs, 4 extra photos, the storyteller and the operator sitting out. */
export function sampleSettings(cast: SampleCast): SoundtrackConfig {
  const id = (i: number) => cast.players[i]?.id
  const people = (...indices: number[]) => indices.map(id).filter((x): x is PlayerId => x !== undefined)
  const inPhoto: Record<number, PlayerId[]> = { 1: people(2), 3: people(3), 5: people(1, 4) }
  return {
    songs: SAMPLE_SONGS.map((song, i) => ({
      title: song.title,
      singer: song.singer,
      alsoTitles: [...song.also[0]],
      alsoSingers: [...song.also[1]],
      photo: photoPath(i + 1),
      caption: song.caption,
      startAt: song.startAt,
      note: i === 0 ? 'The night the boat broke down.' : '',
      inPhoto: inPhoto[i] ?? [],
    })),
    extraPhotos: EXTRA_CAPTIONS.map((caption, k) => ({ photo: photoPath(20 + k), caption })),
    points: { event: 2, title: 1, singer: 1 },
    lastCallSeconds: 60,
    standingsEvery: 4,
    hints: false,
    boardMax: 20,
    intro: '',
    storyteller: cast.players[6]?.name ?? '',
    sitOut: people(5, 6),
  }
}

/** The phone's guest's own answers, by song: [title, singer, event] with 'right', 'extra' or 'none' for the event. */
const MINE: [string | null, string | null, 'right' | 'extra' | 'none'][] = [
  ['Papir Lanterner', 'Coldwave', 'right'],
  ['Seven ferries', 'Coldwave', 'extra'],
  ['Bla mandag', null, 'right'],
  ['salt and sand', 'Ditte & Vincent', 'right'],
  ['Natlys', 'Rosa', 'extra'],
  ['Under the old oak tree', 'Lanterns', 'right'],
  ['Rock and roll harbor', 'Chloe Olstad', 'none'],
  ['Route 41', 'Mira Holm', 'right'],
]

/** Scripted answers beside the generated ones: [player index, song from 1, part, text]. */
const SCRIPTED: [number, number, TypedPart, string][] = [
  // The same close title as the phone's guest: one row, two guests, accepted at the reveal.
  [9, 1, 'title', 'Papir Lanterner'],
  // A close singer the host leaves alone.
  [7, 1, 'singer', 'Myra Holmes'],
  // The title in the singer field.
  [0, 2, 'singer', 'Seven Ferries'],
]

const GAP = 100_000
const REVEAL_GAP = 150_000

/** Every guest's answers to every song, as they stand at the lock. */
function script(cast: SampleCast, config: SoundtrackConfig, wall: readonly number[]) {
  const sitOut = new Set(config.sitOut)
  const byPlayer: Record<PlayerId, Record<string, AnswerPayload>> = {}
  cast.players.forEach((player, g) => {
    if (sitOut.has(player.id)) return
    const random = seededRandom(1000 + g * 7919)
    // A small seed's first draw is always tiny: skip it.
    random()
    const mine: Record<string, AnswerPayload> = {}
    const used = new Set<number>()
    const extras = wall.map((k, letter) => (k >= config.songs.length ? letter : -1)).filter((letter) => letter >= 0)
    config.songs.forEach((song, i) => {
      const n = i + 1
      if (g === 3) {
        const [title, singer, event] = MINE[i]
        if (title) mine[promptKey(n, 'title')] = { text: title }
        if (singer) mine[promptKey(n, 'singer')] = { text: singer }
        const letter = event === 'right' ? wall.indexOf(i) : event === 'extra' ? extras.find((x) => !used.has(x)) : undefined
        if (letter !== undefined) {
          used.add(letter)
          mine[promptKey(n, 'event')] = { choice: [String(letter)] }
        }
        return
      }
      for (const part of ['title', 'singer'] as const) {
        const scripted = SCRIPTED.find(([who, song, p]) => who === g && song === n && p === part)
        const text = scripted ? scripted[3] : typedSample(part === 'title' ? song.title : song.singer, random)
        if (text) mine[promptKey(n, part)] = { text }
      }
      const roll = random()
      if (roll < 0.08) return
      const right = wall.indexOf(i)
      const free = wall.map((_, letter) => letter).filter((letter) => !used.has(letter))
      const letter = roll < 0.6 && !used.has(right) ? right : free[Math.floor(random() * free.length)]
      if (letter === undefined) return
      used.add(letter)
      mine[promptKey(n, 'event')] = { choice: [String(letter)] }
    })
    byPlayer[player.id] = mine
  })
  return byPlayer
}

/** What a sample guest types: right 50 percent, one typo 20, 3 letters off 10, wrong 10, nothing 10. */
function typedSample(right: string, random: () => number): string | null {
  const roll = random()
  if (roll < 0.1) return null
  if (roll < 0.6) return random() < 0.5 ? right.toLowerCase() : right
  if (roll < 0.8) return misspell(right, 1, random)
  if (roll < 0.9) return misspell(right, 3, random)
  return WRONG[Math.floor(random() * WRONG.length)]
}

/** One sample round of Lydspor in the given scene, played through the real logic at the fixture's `now`. */
export function soundtrackSample(scene: SoundtrackScene, cast: SampleCast, now: number): SoundtrackSample {
  const game = new SoundtrackGame()
  const players: GamePlayer[] = cast.players.map((p) => ({ id: p.id, name: p.name, profile: {} }))
  const config = game.parseConfig({ ...game.defaultConfig, ...sampleSettings(cast) })
  const prompts: Record<string, { -readonly [K in keyof Prompt]: Prompt[K] }> = {}
  const announcements: SoundtrackSample['announcements'] = []
  const random = seededRandom(2026)

  // The timeline: songs GAP apart, a 60 s last call, the timer's lock, reveals REVEAL_GAP apart.
  const reveals = { lobby: 0, playing: 0, 'last-call': 0, locked: 0, reveal: 1, standings: 4, final: 8 }[scene]
  const played = scene === 'lobby' ? 0 : scene === 'playing' ? 5 : config.songs.length
  const lockedAt =
    scene === 'locked'
      ? now - 60_000
      : scene === 'reveal'
        ? now - 120_000
        : scene === 'standings'
          ? now - 50_000 - 60_000 - 3 * REVEAL_GAP
          : now - 20_000 - 60_000 - 60_000 - 7 * REVEAL_GAP
  const lockAt = scene === 'last-call' ? now + 38_000 : lockedAt - 1000
  const lastCallAt = lockAt - config.lastCallSeconds * 1000
  const playedAt = (k: number) => (scene === 'playing' ? now - 40_000 - (played - k) * GAP : lastCallAt - 90_000 - (played - k) * GAP)
  const startedAt = scene === 'lobby' ? now - 2 * 60_000 : playedAt(1) - 3 * 60_000

  function info(at: number, answers: GameInfo<SoundtrackConfig>['answers'] = {}): GameInfo<SoundtrackConfig> {
    return {
      gameId: 'sample',
      round: 1,
      session: { id: 'sample', name: 'Birthday party', data: {} },
      players,
      scoreboard: {},
      config,
      now: at,
      prompts: Object.fromEntries(Object.entries(prompts).map(([key, p]) => [key, { ...p }])),
      answers,
    }
  }

  function step(at: number, hook: (ctx: GameContext<SoundtrackConfig>) => SoundtrackState, answers: GameInfo<SoundtrackConfig>['answers'] = {}) {
    const { ctx, effects } = createGameContext(info(at, answers), random)
    const next = hook(ctx)
    for (const open of effects.prompts.open) {
      prompts[open.key] = { key: open.key, spec: open.spec, openedAt: at, closesAt: null, closedAt: null, revealedAt: null }
    }
    for (const key of effects.prompts.close) prompts[key].closedAt ??= at
    for (const key of effects.prompts.reveal) {
      prompts[key].closedAt ??= at
      prompts[key].revealedAt ??= at
    }
    for (const a of effects.announcements) announcements.push({ ...a, at })
    return next
  }

  const host = (state: SoundtrackState, at: number, action: SoundtrackHostAction) => step(at, (ctx) => game.handleHostAction(state, action, ctx))

  let state = step(startedAt, (ctx) => game.setup(ctx))
  const all = script(cast, config, state.wall)
  // In the playing scene, song 5 is on: the phone's guest hasn't named it yet, and about half the room has.
  const answered = (g: number, n: number, part: string) =>
    scene !== 'playing' || n < played || (g !== 3 && (g + n + part.length) % 3 !== 0)
  const answersNow: Record<PlayerId, Record<string, AnswerPayload>> = {}
  cast.players.forEach((player, g) => {
    const mine = all[player.id]
    if (!mine) return
    const kept = Object.entries(mine).filter(([key]) => {
      const [, n, part] = /^s(\d+)\.(\w+)$/.exec(key)!
      return Number(n) <= played && answered(g, Number(n), part)
    })
    if (kept.length > 0) answersNow[player.id] = Object.fromEntries(kept)
  })

  for (let k = 1; k <= played; k++) state = host(state, playedAt(k), { type: 'play', index: k - 1 })
  if (scene !== 'lobby' && scene !== 'playing') state = host(state, lastCallAt, { type: 'lastCall', after: played })
  if (scene !== 'lobby' && scene !== 'playing' && scene !== 'last-call') {
    state = step(lockAt, (ctx) => game.onWake(state, ctx))
    // The timer's second step reads every answer, in the order they arrived.
    const lists: Record<string, Answer[]> = {}
    for (const key of Object.keys(prompts)) {
      lists[key] = cast.players
        .map((player, g) => ({ player, g, answer: answersNow[player.id]?.[key] }))
        .filter((row): row is { player: (typeof cast.players)[number]; g: number; answer: AnswerPayload } => row.answer !== undefined)
        .map(({ player, g, answer }) => {
          const firstAt = prompts[key].openedAt + 4000 + ((g * 7919) % 40) * 1000
          return { playerId: player.id, answer, firstAt, at: firstAt, ms: firstAt - prompts[key].openedAt, changes: 0 }
        })
        .sort((a, b) => a.firstAt - b.firstAt)
    }
    state = step(lockAt + 1000, (ctx) => game.onWake(state, ctx), lists)
  }
  for (let r = 1; r <= reveals; r++) {
    const at = lockedAt + 60_000 + (r - 1) * REVEAL_GAP
    state = host(state, at, { type: 'reveal', index: r - 1 })
    if (r === 1) {
      // The host accepts the close title two guests typed.
      const row = state.review?.[0].title.find((x) => x.verdict === 'close' && x.players.includes(cast.players[3].id))
      if (row) state = host(state, at + 20_000, { type: 'accept', index: 0, part: 'title', key: row.key, accepted: true })
    }
    if (r % config.standingsEvery === 0 && (scene === 'final' || r === reveals)) {
      state = host(state, at + 30_000, { type: 'standings', after: r })
    }
  }
  const finishedAt = scene === 'final' ? now - 20_000 : null
  if (finishedAt !== null) state = host(state, finishedAt, { type: 'crown' })

  const at = info(now)
  const views: Record<PlayerId, SoundtrackPlayerView> = {}
  for (const player of players) views[player.id] = game.playerView(state, player.id, at)
  const tallies: Record<string, number> = {}
  for (const [key, prompt] of Object.entries(prompts)) {
    if (prompt.revealedAt !== null) continue
    tallies[key] = Object.values(answersNow).filter((mine) => key in mine).length
  }
  return {
    config,
    state,
    publicState: game.publicState(state, at),
    views,
    answers: answersNow,
    prompts: Object.values(prompts).map((p) => ({
      key: p.key,
      spec: p.spec,
      opened_at: p.openedAt,
      closes_at: p.closesAt,
      closed_at: p.closedAt,
      revealed_at: p.revealedAt,
    })),
    tallies,
    points: game.scores(state, at),
    winners: state.phase === 'done' ? game.winners(state, at) : [],
    startedAt,
    finishedAt,
    announcements,
  }
}
