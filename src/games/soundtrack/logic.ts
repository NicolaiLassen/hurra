// Lydspor, the photo and song game (.design/lydspor/spec.md; docs/engine-v2.md,
// 8.5). The host plays songs from someone's life on Spotify, never from the
// app, and taps Play song n. Every phone asks three things about the song:
// its title and who sings it, typed, and its event, a tap on one of the
// lettered photos on the wall. Anything stays changeable until the last call;
// then everything locks at once, and the host reveals the songs one by one
// while the storyteller tells each story.
//
// Answers are prompts, never actions: three per song (s5.title, s5.singer,
// s5.event), opened by Play and answered straight to the database. The lock
// (the host's Lock now, or the timer after the last call) reads every answer
// once into `picks`, judges the typed ones (match.ts) into `review`, and
// reveals the prompts. From then on nothing changes but how an answer scores:
// the host may accept a close or wrong answer for everyone who typed it.
// Every point is computed from the state when read, so an accept moves the
// counts, the top 5, the phones and (at the crown) the payout together.
//
// The secrets are which photo is each song's (the wall is shuffled at the
// start), the titles and singers in the host-only settings, and every typed
// answer: a song reaches publicState only at its reveal, and a typed answer
// never does. Relative imports only: the Netlify function bundles this file.
import { shuffle } from '../core/context'
import {
  Game,
  GameError,
  type Answer,
  type AnswerPayload,
  type GameContext,
  type GameInfo,
  type GamePlayer,
  type Highlight,
  type PlayerId,
  type PromptSpec,
  type RecapRound,
  type Scores,
} from '../core/Game'
import { counts as verdictCounts, judge, normalise } from './match'
import {
  MAX_TYPED,
  NO_PHOTO,
  letterOf,
  promptKey,
  type EventResult,
  type PartResult,
  type Picks,
  type ReviewRow,
  type SongReview,
  type SoundtrackConfig,
  type SoundtrackHostAction,
  type SoundtrackPhoto,
  type SoundtrackPlayerView,
  type SoundtrackPoints,
  type SoundtrackPublicState,
  type SoundtrackReveal,
  type SoundtrackSong,
  type SoundtrackSongView,
  type SoundtrackState,
  type TypedPart,
} from './types'

/** Lasting achievements across rounds, shown as badges. */
export type SoundtrackProfile = { wins?: number }

export const MAX_SONGS = 12
export const MAX_EXTRA_PHOTOS = 4
/** With this many songs or more, the wall needs MIN_EXTRA_PHOTOS photos that fit no song. */
export const EXTRAS_NEEDED_FROM = 3
export const MIN_EXTRA_PHOTOS = 2
/** Fewer extra photos than this is allowed, with a warning. */
export const SUGGESTED_EXTRA_PHOTOS = 4
export const MAX_ALSO = 6
export const MAX_CAPTION = 30
/** A caption longer than this wraps on a 320 px phone: a warning. */
export const LONG_CAPTION = 20
export const MAX_NOTE = 140
export const MAX_INTRO = 120
export const MAX_STORYTELLER = 40
export const MAX_IN_PHOTO = 10
export const MAX_POINTS = 5
export const MIN_LAST_CALL = 20
export const MAX_LAST_CALL = 180
/** The hook's start, in whole seconds: within the first hour. */
export const MAX_START = 3599
export const MAX_STANDINGS_EVERY = 12
export const MIN_BOARD_MAX = 1
export const MAX_BOARD_MAX = 25
/** What More time adds, and how often. */
export const MORE_MS = 30_000
export const MAX_MORE = 2
/** After the timer closes the prompts, the next sync locks this much later. */
export const CLOSING_RETRY_MS = 1000
/** Lydspor's top 5. */
export const TOP_SIZE = 5
/** A typed answer of this many characters or fewer, once normalised, counts only exactly. */
export const SHORT_ANSWER = 4

export const DEFAULT_POINTS: SoundtrackPoints = { event: 2, title: 1, singer: 1 }

/** Title and singer: any text up to MAX_TYPED characters, changeable until the lock. Never an answer in it: specs are public. */
export const TEXT_SPEC: PromptSpec = { kind: 'text', max_length: MAX_TYPED }

/** The event: a wall index, or NO_PHOTO (a take leaves the other song without one). Changeable until the lock. */
export const eventSpec = (wallSize: number): PromptSpec => ({
  kind: 'choice',
  options: [NO_PHOTO, ...Array.from({ length: wallSize }, (_, i) => String(i))],
})

const PARTS = ['title', 'singer', 'event'] as const
const TYPED: readonly TypedPart[] = ['title', 'singer']

/** A game-media path as uploads make them: `<session>/<game>/<uuid>.jpg`, nothing that climbs or points elsewhere. */
const MEDIA_PATH = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\.jpg$/

/** The points one song can give: event, title and singer. */
export const pointsPerSong = (points: SoundtrackPoints) => points.event + points.title + points.singer

/** Every prompt key of the songs played so far, song by song. */
export const playedKeys = (played: number): string[] =>
  Array.from({ length: played }, (_, i) => PARTS.map((part) => promptKey(i + 1, part))).flat()

/** A typed answer's text as saved (trimmed), or null for anything else. */
export function textOf(answer: AnswerPayload | undefined | null): string | null {
  if (!answer || !('text' in answer) || typeof answer.text !== 'string') return null
  const text = answer.text.trim()
  return text === '' ? null : text
}

/** An event answer's wall index, null for no photo, or undefined for anything else. */
export function photoOf(answer: AnswerPayload | undefined | null, wallSize: number): number | null | undefined {
  if (!answer || !('choice' in answer) || !Array.isArray(answer.choice) || answer.choice.length !== 1) return undefined
  const [choice] = answer.choice
  if (choice === NO_PHOTO) return null
  const index = Number(choice)
  return Number.isInteger(index) && index >= 0 && index < wallSize && String(index) === choice ? index : undefined
}

/** "Ana", "Ana and Bo", "Ana, Bo and Cy". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

// Settings -----------------------------------------------------------------------

/** Length in code points, as Postgres char_length counts. */
const length = (text: string) => Array.from(text).length

const record = (value: unknown) =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const trimmed = (value: unknown) => (typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '')

/** A whole number, also from a numeric string (a settings form), else null. */
function whole(value: unknown): number | null {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof number === 'number' && Number.isInteger(number) ? number : null
}

const isPlayerId = (value: unknown): value is PlayerId => typeof value === 'string' && value.length > 0 && value.length <= 64

/** Player ids, once each, in their order. */
const ids = (value: unknown): PlayerId[] => [...new Set(Array.isArray(value) ? value.filter(isPlayerId) : [])]

/** A list of extra answers: texts trimmed, empty rows dropped. */
const texts = (value: unknown): string[] => (Array.isArray(value) ? value.map(trimmed).filter(Boolean) : [])

/**
 * The settings, cleaned, with every problem in them (in the order a host
 * would fix them) and every warning. parseConfig refuses the first problem;
 * the settings editor shows them all as you type, each under its field.
 */
export function checkConfig(input: unknown): { config: SoundtrackConfig; problems: string[]; warnings: string[] } {
  const raw = record(input)
  const problems: string[] = []
  const warnings: string[] = []
  const rawSongs = Array.isArray(raw.songs) ? raw.songs : []
  if (rawSongs.length === 0) problems.push('Add at least one song in the settings')
  else if (rawSongs.length > MAX_SONGS) problems.push(`Lydspor takes at most ${MAX_SONGS} songs`)
  const songs = rawSongs.slice(0, MAX_SONGS).map((song, i) => checkSong(song, i + 1, problems))

  const rawExtras = Array.isArray(raw.extraPhotos) ? raw.extraPhotos : []
  if (rawExtras.length > MAX_EXTRA_PHOTOS) problems.push(`Lydspor takes at most ${MAX_EXTRA_PHOTOS} extra photos`)
  const extraPhotos = rawExtras.slice(0, MAX_EXTRA_PHOTOS).map((photo, i) => checkExtraPhoto(photo, i + 1, problems))

  // Two songs whose titles read the same: a typed answer would count for both.
  const titleKeys = songs.map((song) => normalise(song.title))
  const twice = titleKeys.findIndex((key, i) => key !== '' && titleKeys.indexOf(key) !== i)
  if (twice >= 0) problems.push(`Two songs are called ${songs[titleKeys.indexOf(titleKeys[twice])].title}`)
  const photos = [...songs.map((song) => song.photo), ...extraPhotos.map((photo) => photo.photo)].filter(Boolean)
  if (new Set(photos).size !== photos.length) problems.push('The same photo is used twice')
  if (songs.length >= EXTRAS_NEEDED_FROM && extraPhotos.length < MIN_EXTRA_PHOTOS) {
    problems.push(`Add at least ${MIN_EXTRA_PHOTOS} extra photos, so the last song's photo isn't free`)
  }

  const rawPoints = record(raw.points)
  const points = {
    event: whole(rawPoints.event ?? DEFAULT_POINTS.event),
    title: whole(rawPoints.title ?? DEFAULT_POINTS.title),
    singer: whole(rawPoints.singer ?? DEFAULT_POINTS.singer),
  }
  if (Object.values(points).some((p) => p === null || p < 0 || p > MAX_POINTS)) {
    problems.push(`Points must be whole numbers from 0 to ${MAX_POINTS}`)
  }
  const lastCallSeconds = whole(raw.lastCallSeconds ?? 60)
  if (lastCallSeconds === null || lastCallSeconds < MIN_LAST_CALL || lastCallSeconds > MAX_LAST_CALL) {
    problems.push(`Last call takes ${MIN_LAST_CALL} to ${MAX_LAST_CALL} seconds`)
  }
  const standingsEvery = whole(raw.standingsEvery ?? 4)
  if (standingsEvery === null || standingsEvery < 0 || standingsEvery > MAX_STANDINGS_EVERY) {
    problems.push(`The top 5 shows every 0 to ${MAX_STANDINGS_EVERY} songs`)
  }
  const boardMax = whole(raw.boardMax ?? 20)
  if (boardMax === null || boardMax < MIN_BOARD_MAX || boardMax > MAX_BOARD_MAX) {
    problems.push(`The most on the night board is a whole number from ${MIN_BOARD_MAX} to ${MAX_BOARD_MAX}`)
  }
  const intro = trimmed(raw.intro)
  if (length(intro) > MAX_INTRO) problems.push(`The intro line is at most ${MAX_INTRO} characters`)
  const storyteller = trimmed(raw.storyteller)
  if (length(storyteller) > MAX_STORYTELLER) problems.push(`The storyteller's name is at most ${MAX_STORYTELLER} characters`)

  const config: SoundtrackConfig = {
    songs,
    extraPhotos,
    points: { event: points.event ?? 2, title: points.title ?? 1, singer: points.singer ?? 1 },
    lastCallSeconds: lastCallSeconds ?? 60,
    standingsEvery: standingsEvery ?? 4,
    hints: raw.hints === true,
    boardMax: boardMax ?? 20,
    intro,
    storyteller,
    sitOut: ids(raw.sitOut),
  }
  warnings.push(...configWarnings(config))
  return { config, problems, warnings }
}

function checkSong(input: unknown, n: number, problems: string[]): SoundtrackSong {
  const raw = record(input)
  const photo = trimmed(raw.photo)
  if (!photo) problems.push(`Song ${n} needs its photo`)
  else if (photo.length > 300 || !MEDIA_PATH.test(photo)) problems.push(`Song ${n}: that photo isn't valid. Upload it again.`)

  const title = trimmed(raw.title)
  const singer = trimmed(raw.singer)
  if (!title || !singer) problems.push(`Song ${n} needs a title and a singer`)
  for (const [part, text] of [
    ['title', title],
    ['singer', singer],
  ] as const) {
    if (!text) continue
    if (length(text) > MAX_TYPED) problems.push(`Song ${n}: the ${part} is at most ${MAX_TYPED} characters`)
    else if (normalise(text) === '') problems.push(`Song ${n}: the ${part} needs a letter or a digit`)
  }

  const alsoTitles = texts(raw.alsoTitles)
  const alsoSingers = texts(raw.alsoSingers)
  if (alsoTitles.length > MAX_ALSO) problems.push(`Song ${n} takes at most ${MAX_ALSO} extra titles`)
  if (alsoSingers.length > MAX_ALSO) problems.push(`Song ${n} takes at most ${MAX_ALSO} extra singers`)
  const extras = [...alsoTitles, ...alsoSingers]
  if (extras.some((text) => length(text) > MAX_TYPED)) problems.push(`Song ${n}: an extra answer is at most ${MAX_TYPED} characters`)
  else if (extras.some((text) => normalise(text) === '')) problems.push(`Song ${n}: an extra answer needs a letter or a digit`)

  const caption = trimmed(raw.caption)
  if (!caption) problems.push(`Song ${n} needs a caption`)
  else if (length(caption) > MAX_CAPTION) problems.push(`Song ${n}: the caption is at most ${MAX_CAPTION} characters`)

  const startAt = raw.startAt === undefined || raw.startAt === null || raw.startAt === '' ? 0 : whole(raw.startAt)
  if (startAt === null || startAt < 0 || startAt > MAX_START) problems.push(`Song ${n}: the start must be within the first hour`)

  const note = trimmed(raw.note)
  if (length(note) > MAX_NOTE) problems.push(`Song ${n}: the story note is at most ${MAX_NOTE} characters`)

  const inPhoto = ids(raw.inPhoto)
  if (inPhoto.length > MAX_IN_PHOTO) problems.push(`Song ${n}: at most ${MAX_IN_PHOTO} people in its photo`)

  return {
    title,
    singer,
    alsoTitles: alsoTitles.slice(0, MAX_ALSO),
    alsoSingers: alsoSingers.slice(0, MAX_ALSO),
    photo,
    caption,
    startAt: startAt ?? 0,
    note,
    inPhoto: inPhoto.slice(0, MAX_IN_PHOTO),
  }
}

function checkExtraPhoto(input: unknown, k: number, problems: string[]): SoundtrackPhoto {
  const raw = record(input)
  const photo = trimmed(raw.photo)
  if (!photo) problems.push(`Extra photo ${k} needs its photo`)
  else if (photo.length > 300 || !MEDIA_PATH.test(photo)) problems.push(`Extra photo ${k}: that photo isn't valid. Upload it again.`)
  const caption = trimmed(raw.caption)
  if (!caption) problems.push(`Extra photo ${k} needs a caption`)
  else if (length(caption) > MAX_CAPTION) problems.push(`Extra photo ${k}: the caption is at most ${MAX_CAPTION} characters`)
  return { photo, caption }
}

/** What the editor warns about without refusing (spec 11.1). */
function configWarnings(config: SoundtrackConfig): string[] {
  const warnings: string[] = []
  const { songs, extraPhotos } = config
  if (songs.length > 0 && extraPhotos.length < SUGGESTED_EXTRA_PHOTOS) {
    warnings.push(`${extraPhotos.length === 0 ? 'No' : `Only ${extraPhotos.length}`} extra ${extraPhotos.length === 1 ? 'photo' : 'photos'}: ${SUGGESTED_EXTRA_PHOTOS} keep the last songs hard to place.`)
  }
  songs.forEach((song, i) => {
    const n = i + 1
    if (length(song.caption) > LONG_CAPTION) warnings.push(`Song ${n}: a caption over ${LONG_CAPTION} characters wraps on a small phone.`)
    for (const [part, text] of [
      ['title', song.title],
      ['singer', song.singer],
    ] as const) {
      const key = normalise(text)
      if (key !== '' && key.length <= SHORT_ANSWER) {
        warnings.push(`Song ${n}: the ${part} is short: only the exact spelling counts. Add extra answers if it has a common misspelling.`)
      }
    }
    for (const [part, extras, truth] of [
      ['title', song.alsoTitles, song.title],
      ['singer', song.alsoSingers, song.singer],
    ] as const) {
      for (const extra of extras) {
        if (!truth || normalise(extra) === '') continue
        if (verdictCounts(judge(extra, part, [truth], []).verdict)) warnings.push(`Song ${n}: “${extra}” counts already.`)
      }
    }
    const feat = /\s(?:feat\.?|ft\.?|featuring)\s/i.exec(` ${song.singer} `)
    if (feat && feat.index > 0) {
      const main = song.singer.slice(0, feat.index - 1).trim()
      if (main) warnings.push(`Song ${n}: only ${main} is needed to score: the feat. part may be left out.`)
    }
  })
  for (let a = 0; a < songs.length; a++) {
    for (let b = a + 1; b < songs.length; b++) {
      const [x, y] = [songs[a], songs[b]]
      if (x.singer && y.singer && normalise(x.singer) !== '' && judge(y.singer, 'singer', [x.singer], []).verdict === 'exact') {
        warnings.push(`Songs ${a + 1} and ${b + 1} share a singer. Fine: singers can repeat.`)
      }
      if (!x.title || !y.title || normalise(x.title) === '' || normalise(x.title) === normalise(y.title)) continue
      const near = verdictCounts(judge(y.title, 'title', [x.title], []).verdict) || verdictCounts(judge(x.title, 'title', [y.title], []).verdict)
      if (near) warnings.push(`Songs ${a + 1} and ${b + 1} have near titles: a typed answer could count for both.`)
    }
  }
  return warnings
}

// The lock: answers in, judged once ----------------------------------------------

/** Every guest with any answer, per played song: wall indices and texts as saved. */
export function readPicks(
  state: Pick<SoundtrackState, 'playedAt' | 'wall'>,
  answers: Readonly<Record<string, readonly Answer[]>>,
): Record<PlayerId, Picks> {
  const played = state.playedAt.length
  const picks: Record<PlayerId, Picks> = {}
  const entry = (id: PlayerId) =>
    (picks[id] ??= {
      event: Array.from({ length: played }, () => null),
      title: Array.from({ length: played }, () => null),
      singer: Array.from({ length: played }, () => null),
    })
  for (let i = 0; i < played; i++) {
    for (const answer of answers[promptKey(i + 1, 'event')] ?? []) {
      const photo = photoOf(answer.answer, state.wall.length)
      if (photo !== undefined) entry(answer.playerId).event[i] = photo
    }
    for (const part of TYPED) {
      for (const answer of answers[promptKey(i + 1, part)] ?? []) {
        const text = textOf(answer.answer)
        if (text !== null) entry(answer.playerId)[part][i] = text
      }
    }
  }
  return picks
}

const VERDICT_ORDER = { close: 0, wrong: 1, typo: 2, exact: 3 } as const

/** Review rows in the order the host reads them: close first, then wrong, typo and exact; more guests first, then fewer letters off, then the key A to Z. */
function byReviewOrder(a: ReviewRow, b: ReviewRow): number {
  return (
    VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] ||
    b.players.length - a.players.length ||
    (a.off ?? Infinity) - (b.off ?? Infinity) ||
    (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  )
}

/** One part's answers, in arrival order, grouped by their normalised key and judged once per group. */
function reviewPart(list: readonly Answer[], part: TypedPart, accepted: readonly string[], other: readonly string[]): ReviewRow[] {
  const groups = new Map<string, { players: PlayerId[]; spellings: Map<string, number> }>()
  for (const answer of list) {
    const text = textOf(answer.answer)
    if (text === null) continue
    const key = normalise(text)
    let group = groups.get(key)
    if (!group) {
      group = { players: [], spellings: new Map() }
      groups.set(key, group)
    }
    if (group.players.includes(answer.playerId)) continue
    group.players.push(answer.playerId)
    group.spellings.set(text, (group.spellings.get(text) ?? 0) + 1)
  }
  const rows: ReviewRow[] = []
  for (const [key, group] of groups) {
    // The spelling most of them typed; on a tie, the first to arrive (Map keeps arrival order).
    let text = ''
    let most = 0
    for (const [spelling, count] of group.spellings) {
      if (count > most) {
        text = spelling
        most = count
      }
    }
    const judged = key === '' ? { verdict: 'wrong' as const, reason: null, off: null } : judge(text, part, accepted, other)
    rows.push({ key, text, players: group.players, verdict: judged.verdict, reason: judged.reason, off: judged.off, accepted: false })
  }
  return rows.sort(byReviewOrder)
}

/** The accepted texts of one part of a song: the truth, then the settings' extras. */
const acceptedFor = (song: SoundtrackSong, part: TypedPart) =>
  part === 'title' ? [song.title, ...song.alsoTitles] : [song.singer, ...song.alsoSingers]

/**
 * Every played song's typed answers, grouped and judged, built once at the
 * lock (spec 11.6). The one source for typed points: accepts change its rows.
 */
export function buildReview(
  state: Pick<SoundtrackState, 'playedAt'>,
  config: SoundtrackConfig,
  answers: Readonly<Record<string, readonly Answer[]>>,
): SongReview[] {
  return state.playedAt.map((_, i) => {
    const song = config.songs[i]
    const review: SongReview = { title: [], singer: [] }
    if (!song) return review
    for (const part of TYPED) {
      const other: TypedPart = part === 'title' ? 'singer' : 'title'
      review[part] = reviewPart(answers[promptKey(i + 1, part)] ?? [], part, acceptedFor(song, part), acceptedFor(song, other))
    }
    return review
  })
}

// Scoring, from the state when read ------------------------------------------------

/** How one revealed song went for one guest. */
type Outcome = { inPhoto: boolean; event: EventResult; title: PartResult; singer: PartResult; points: number }

/** Everything the projections need, computed from the state, the settings and who is here. */
type Sheet = {
  /** Present guests, not sitting out, with any answer at the lock: party order. */
  participants: PlayerId[]
  outcomes: Map<PlayerId, Outcome[]>
  /** Lydspor points so far, before the own average. */
  earned: Map<PlayerId, number>
  /** Revealed songs each participant could score on, and revealed songs they are in the photo of. */
  played: Map<PlayerId, number>
  inPhoto: Map<PlayerId, number>
  /** Per revealed song: scoring guests who got each part, and how many could. */
  songs: { counts: { event: number; title: number; singer: number }; scoring: number }[]
  /** Per revealed song and typed part: each guest's review row. */
  rows: { title: Map<PlayerId, ReviewRow>; singer: Map<PlayerId, ReviewRow> }[]
}

/** How a typed part went: its row's verdict, or 'accepted' for a close or wrong row the host accepted. */
function partResult(row: ReviewRow | undefined): PartResult {
  if (!row) return 'none'
  if (row.verdict === 'exact' || row.verdict === 'typo') return row.verdict
  return row.accepted ? 'accepted' : row.verdict
}

const partCounts = (result: PartResult) => result === 'exact' || result === 'typo' || result === 'accepted'

function outcomeOf(state: SoundtrackState, points: SoundtrackPoints, sheetRows: Sheet['rows'], playerId: PlayerId, i: number): Outcome {
  const inPhoto = (state.inPhoto[i] ?? []).includes(playerId)
  const mine = state.picks?.[playerId]
  const e = mine?.event[i] ?? null
  // The guard: a photo on two of a guest's songs at the lock scores on neither.
  const doubled = e !== null && (mine?.event ?? []).filter((x) => x === e).length > 1
  const event: EventResult = e === null ? 'none' : doubled ? 'doubled' : e === state.wall.indexOf(i) ? 'right' : 'wrong'
  const title = partResult(sheetRows[i]?.title.get(playerId))
  const singer = partResult(sheetRows[i]?.singer.get(playerId))
  const earned = (event === 'right' ? points.event : 0) + (partCounts(title) ? points.title : 0) + (partCounts(singer) ? points.singer : 0)
  return { inPhoto, event, title, singer, points: inPhoto ? 0 : earned }
}

let memo: { state: SoundtrackState; config: SoundtrackConfig; players: readonly unknown[]; sheet: Sheet } | null = null

/** The scores of every revealed song for everyone here (spec 8.2). Memoised for one state, as project() asks once per player. */
function sheetOf(state: SoundtrackState, config: SoundtrackConfig, players: readonly Pick<GamePlayer, 'id'>[]): Sheet {
  if (memo && memo.state === state && memo.config === config && memo.players === players) return memo.sheet
  const revealed = Math.min(state.revealed, state.playedAt.length, state.review?.length ?? 0)
  const rows: Sheet['rows'] = Array.from({ length: revealed }, (_, i) => {
    const byPlayer = (list: readonly ReviewRow[] | undefined) => {
      const map = new Map<PlayerId, ReviewRow>()
      for (const row of list ?? []) for (const id of row.players) map.set(id, row)
      return map
    }
    return { title: byPlayer(state.review?.[i]?.title), singer: byPlayer(state.review?.[i]?.singer) }
  })
  const sitOut = new Set(state.sitOut)
  const picks = state.picks ?? {}
  const participants = players.map((p) => p.id).filter((id) => !sitOut.has(id) && Object.hasOwn(picks, id))
  const sheet: Sheet = {
    participants,
    outcomes: new Map(),
    earned: new Map(),
    played: new Map(),
    inPhoto: new Map(),
    songs: Array.from({ length: revealed }, () => ({ counts: { event: 0, title: 0, singer: 0 }, scoring: 0 })),
    rows,
  }
  for (const id of participants) {
    const outcomes = Array.from({ length: revealed }, (_, i) => outcomeOf(state, config.points, rows, id, i))
    let earned = 0
    let played = 0
    let inPhoto = 0
    outcomes.forEach((outcome, i) => {
      if (outcome.inPhoto) {
        inPhoto++
        return
      }
      played++
      earned += outcome.points
      const song = sheet.songs[i]
      song.scoring++
      if (outcome.event === 'right') song.counts.event++
      if (partCounts(outcome.title)) song.counts.title++
      if (partCounts(outcome.singer)) song.counts.singer++
    })
    sheet.outcomes.set(id, outcomes)
    sheet.earned.set(id, earned)
    sheet.played.set(id, played)
    sheet.inPhoto.set(id, inPhoto)
  }
  memo = { state, config, players, sheet }
  return sheet
}

/** The own average: a guest in a song's photo scores that song as their average over the songs they could score on. */
function creditOf(sheet: Sheet, id: PlayerId): number {
  const played = sheet.played.get(id) ?? 0
  const inPhoto = sheet.inPhoto.get(id) ?? 0
  return played >= 1 && inPhoto >= 1 ? Math.round(((sheet.earned.get(id) ?? 0) / played) * inPhoto) : 0
}

/**
 * A guest's Lydspor points as the room sees them: what they earned, plus the
 * own average once every song played is revealed (it can't grow after that,
 * only follow an accept), so the last top 5 ranks the way the crown will.
 * The crown's own averages are kept in the state.
 */
function standingOf(state: SoundtrackState, sheet: Sheet, id: PlayerId): { points: number; credit: number } {
  const earned = sheet.earned.get(id) ?? 0
  const allRevealed = sheet.songs.length > 0 && sheet.songs.length === state.playedAt.length
  const credit = !allRevealed ? 0 : (state.credits?.[id] ?? creditOf(sheet, id))
  return { points: earned + credit, credit }
}

/** Competition ranks (1, 2, 2, 4) of the rows, highest first; ties keep their order. */
function ranked<T extends { points: number }>(rows: T[]): (T & { rank: number })[] {
  const sorted = rows.map((row, order) => ({ row, order })).sort((a, b) => b.row.points - a.row.points || a.order - b.order)
  let rank = 0
  return sorted.map(({ row }, i) => {
    if (i === 0 || sorted[i - 1].row.points !== row.points) rank = i + 1
    return { ...row, rank }
  })
}

/** Lydspor's final rows, once crowned: every participant's points with the own average, place and payout. */
function finalRows(state: SoundtrackState, config: SoundtrackConfig, players: readonly Pick<GamePlayer, 'id'>[]) {
  const sheet = sheetOf(state, config, players)
  const most = Math.min(state.revealed, state.playedAt.length) * pointsPerSong(config.points)
  const rows = sheet.participants.map((playerId) => {
    const credit = state.credits?.[playerId] ?? creditOf(sheet, playerId)
    const points = (sheet.earned.get(playerId) ?? 0) + credit
    // The night board never gets raw Lydspor points: a scale to at most boardMax.
    const paid = most > 0 ? Math.round((points * config.boardMax) / most) : 0
    return { playerId, points, credit, paid }
  })
  return ranked(rows).map(({ rank, ...row }) => ({ ...row, place: rank }))
}

/** Everyone tied at the top of the final points; nobody at 0. */
const winnersOf = (rows: { playerId: PlayerId; points: number; place: number }[]) =>
  rows.filter((row) => row.place === 1 && row.points > 0).map((row) => row.playerId)

// The game ---------------------------------------------------------------------------

const stale = <T>(state: T) => state

export class SoundtrackGame extends Game<
  SoundtrackState,
  never,
  SoundtrackPublicState,
  SoundtrackPlayerView,
  SoundtrackConfig,
  SoundtrackHostAction
> {
  readonly type = 'soundtrack'
  readonly presentation = 'stage'
  readonly defaultConfig: SoundtrackConfig = {
    songs: [],
    extraPhotos: [],
    points: { ...DEFAULT_POINTS },
    lastCallSeconds: 60,
    standingsEvery: 4,
    hints: false,
    boardMax: 20,
    intro: '',
    storyteller: '',
    sitOut: [],
  }

  parseConfig(input: Record<string, unknown>): SoundtrackConfig {
    const { config, problems } = checkConfig(input)
    if (problems.length > 0) throw new GameError(problems[0])
    return config
  }

  /** Deals the wall: the songs' photos and the extra photos, shuffled, lettered A on. Nothing is announced: the TV's title card opens the game. */
  setup(ctx: GameContext<SoundtrackConfig>): SoundtrackState {
    const { songs, extraPhotos } = ctx.config
    return {
      phase: 'lobby',
      wall: shuffle(
        Array.from({ length: songs.length + extraPhotos.length }, (_, i) => i),
        ctx.random,
      ),
      playedAt: [],
      lockAt: null,
      extended: 0,
      closingAt: null,
      lockedAt: null,
      picks: null,
      review: null,
      revealed: 0,
      inPhoto: songs.map((song) => [...song.inPhoto]),
      sitOut: [...ctx.config.sitOut],
      shownTop: {},
      credits: null,
    }
  }

  parseAction(): never {
    throw new GameError('Lydspor takes answers, not moves')
  }

  handleAction(state: SoundtrackState): SoundtrackState {
    return state
  }

  parseHostAction(input: unknown): SoundtrackHostAction {
    const action = input !== null && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {}
    const step = (value: unknown, min = 0): value is number =>
      typeof value === 'number' && Number.isInteger(value) && value >= min && value < 100
    switch (action.type) {
      case 'play':
        if (step(action.index)) return { type: 'play', index: action.index }
        break
      case 'lastCall':
        if (step(action.after)) return { type: 'lastCall', after: action.after }
        break
      case 'more':
        if (step(action.n, 1)) return { type: 'more', n: action.n }
        break
      case 'lock':
        return { type: 'lock' }
      case 'reveal':
        if (step(action.index)) return { type: 'reveal', index: action.index }
        break
      case 'accept':
        if (
          step(action.index) &&
          (action.part === 'title' || action.part === 'singer') &&
          typeof action.key === 'string' &&
          action.key.length <= 400 &&
          typeof action.accepted === 'boolean'
        ) {
          return { type: 'accept', index: action.index, part: action.part, key: action.key, accepted: action.accepted }
        }
        break
      case 'standings':
        if (step(action.after)) return { type: 'standings', after: action.after }
        break
      case 'crown':
        return { type: 'crown' }
      case 'setInPhoto':
        if (step(action.index) && Array.isArray(action.playerIds) && action.playerIds.every(isPlayerId)) {
          if (new Set(action.playerIds).size > MAX_IN_PHOTO) throw new GameError(`At most ${MAX_IN_PHOTO} people in a photo`)
          return { type: 'setInPhoto', index: action.index, playerIds: ids(action.playerIds) }
        }
        break
      case 'sitOut':
        if (Array.isArray(action.playerIds) && action.playerIds.length <= 200 && action.playerIds.every(isPlayerId)) {
          return { type: 'sitOut', playerIds: ids(action.playerIds) }
        }
        break
    }
    throw new GameError('Unknown Lydspor step')
  }

  // Every host action names its step (docs/engine-v2.md, 3.5): a song, the
  // songs played or revealed, or a phase. One whose step has passed returns
  // the state unchanged, which the engine answers as skipped, so a double tap
  // or a race with the timer does nothing.
  handleHostAction(state: SoundtrackState, action: SoundtrackHostAction, ctx: GameContext<SoundtrackConfig>): SoundtrackState {
    switch (action.type) {
      case 'play':
        return this.play(state, action.index, ctx)
      case 'lastCall':
        if (state.phase === 'lobby') throw new GameError('Play song 1 first')
        if (state.phase !== 'playing' || action.after !== state.playedAt.length) return stale(state)
        return { ...state, phase: 'lastCall', lockAt: ctx.now + ctx.config.lastCallSeconds * 1000, extended: 0, closingAt: null }
      case 'more':
        return this.more(state, action.n, ctx)
      case 'lock':
        if (state.phase === 'lobby') throw new GameError('Play song 1 first')
        if (state.phase !== 'playing' && state.phase !== 'lastCall') return stale(state)
        return this.lock(state, ctx)
      case 'reveal':
        return this.reveal(state, action.index, ctx)
      case 'accept':
        return this.accept(state, action, ctx)
      case 'standings':
        if (state.phase !== 'reveal' || action.after !== state.revealed) return stale(state)
        return { ...state, phase: 'standings' }
      case 'crown':
        if (state.phase === 'done') return stale(state)
        if (state.phase === 'playing' || state.phase === 'lastCall') throw new GameError('Lock the answers first')
        return this.finish(state, ctx, 'crown')
      case 'setInPhoto': {
        if (state.phase === 'done') throw new GameError('Lydspor is over')
        if (action.index >= ctx.config.songs.length) throw new GameError('There is no such song')
        if (sameIds(state.inPhoto[action.index] ?? [], action.playerIds)) return stale(state)
        const inPhoto = ctx.config.songs.map((_, i) => (i === action.index ? [...action.playerIds] : [...(state.inPhoto[i] ?? [])]))
        return { ...state, inPhoto }
      }
      case 'sitOut':
        if (state.phase === 'done') throw new GameError('Lydspor is over')
        if (sameIds(state.sitOut, action.playerIds)) return stale(state)
        return { ...state, sitOut: [...action.playerIds] }
    }
  }

  /** In last call: at lockAt the timer closes every prompt; a second later it locks, once every answer list is in. */
  wakeAt(state: SoundtrackState): number | null {
    if (state.phase !== 'lastCall' || state.lockAt === null) return null
    return state.closingAt === null ? state.lockAt : state.closingAt + CLOSING_RETRY_MS
  }

  onWake(state: SoundtrackState, ctx: GameContext<SoundtrackConfig>): SoundtrackState {
    if (state.phase !== 'lastCall') return state
    const keys = playedKeys(state.playedAt.length)
    // Closed already (a host's close list got there first): lock now.
    if (keys.every((key) => ctx.answers[key])) return this.lock(state, ctx)
    // Close what is still open; the next sync, a second later, reads the answers.
    for (const key of keys) if (!ctx.answers[key]) ctx.closePrompt(key)
    return { ...state, closingAt: ctx.now }
  }

  isFinished(state: SoundtrackState): boolean {
    return state.phase === 'done'
  }

  winners(state: SoundtrackState, info: GameInfo<SoundtrackConfig>): PlayerId[] {
    return winnersOf(finalRows(state, info.config, info.players))
  }

  onEnd(state: SoundtrackState, ctx: GameContext<SoundtrackConfig>, by: 'game' | 'host'): SoundtrackState {
    // The crown announced the result already.
    if (by === 'game' || state.phase === 'done') return state
    return this.finish(state, ctx, 'end')
  }

  /** Nothing until the crown, so the night board moves once; then each guest's payout. */
  scores(state: SoundtrackState, info: GameInfo<SoundtrackConfig>): Scores {
    if (state.phase !== 'done') return {}
    const scores: Scores = {}
    for (const row of finalRows(state, info.config, info.players)) if (row.paid !== 0) scores[row.playerId] = row.paid
    return scores
  }

  publicState(state: SoundtrackState, info: GameInfo<SoundtrackConfig>): SoundtrackPublicState {
    const { config } = info
    const sheet = sheetOf(state, config, info.players)
    const revealed = sheet.songs.length
    const sitOut = new Set(state.sitOut)
    const last = revealed > 0 ? revealed - 1 : -1
    const song = last >= 0 ? config.songs[last] : undefined
    const reveal: SoundtrackReveal | null =
      song && last >= 0
        ? {
            n: last + 1,
            event: state.wall.indexOf(last),
            title: song.title,
            singer: song.singer,
            caption: song.caption,
            counts: { ...sheet.songs[last].counts },
            scoring: sheet.songs[last].scoring,
          }
        : null
    const afterLast = revealed > 0 && revealed === state.playedAt.length && ['reveal', 'standings', 'done'].includes(state.phase)
    return {
      phase: state.phase,
      total: config.songs.length,
      playedAt: [...state.playedAt],
      wall: state.wall.map((k) => {
        const photo = photoAt(config, k)
        return { path: photo.photo, hint: config.hints ? photo.caption : null }
      }),
      points: { ...config.points },
      lockAt: state.lockAt,
      lockedAt: state.lockedAt,
      playing: info.players.filter((p) => !sitOut.has(p.id)).length,
      revealed,
      reveal,
      // The photos that fit no played song: the extras, and songs never played.
      extras: afterLast
        ? state.wall
            .filter((k) => k >= state.playedAt.length)
            .map((k) => {
              const photo = photoAt(config, k)
              return { path: photo.photo, caption: photo.caption }
            })
        : null,
      top: ranked(sheet.participants.map((playerId) => ({ playerId, ...standingOf(state, sheet, playerId) })).filter((row) => row.points > 0))
        .slice(0, TOP_SIZE)
        // The gain counts what was earned since the last top 5; the own average shows on its own.
        .map((row) => ({ ...row, gained: row.points - row.credit - (state.shownTop[row.playerId] ?? 0) })),
      final:
        state.phase === 'done'
          ? finalRows(state, config, info.players).map(({ playerId, points, place, paid }) => ({ playerId, points, place, paid }))
          : null,
      intro: config.intro,
      storyteller: config.storyteller,
    }
  }

  playerView(state: SoundtrackState, playerId: PlayerId, info: GameInfo<SoundtrackConfig>): SoundtrackPlayerView {
    if (state.sitOut.includes(playerId)) return { sittingOut: true, mine: null, songs: [], points: 0, credit: 0, rank: null, final: null }
    const sheet = sheetOf(state, info.config, info.players)
    const mine = state.picks && Object.hasOwn(state.picks, playerId) ? state.picks[playerId] : null
    const outcomes =
      sheet.outcomes.get(playerId) ?? sheet.songs.map((_, i) => outcomeOf(state, info.config.points, sheet.rows, playerId, i))
    const songs: SoundtrackSongView[] = outcomes.map((outcome, i) => ({
      n: i + 1,
      points: sheet.outcomes.has(playerId) ? outcome.points : 0,
      inPhoto: outcome.inPhoto,
      event: outcome.event,
      title: outcome.title,
      singer: outcome.singer,
    }))
    // Ranked as the TV's top 5 ranks: with the own average once every song played is revealed.
    const { points, credit } = sheet.outcomes.has(playerId) ? standingOf(state, sheet, playerId) : { points: 0, credit: 0 }
    const rank =
      points > 0
        ? (ranked(sheet.participants.map((id) => ({ id, points: standingOf(state, sheet, id).points })).filter((row) => row.points > 0)).find(
            (row) => row.id === playerId,
          )?.rank ?? null)
        : null
    const final = state.phase === 'done' ? finalRows(state, info.config, info.players).find((row) => row.playerId === playerId) : undefined
    return {
      sittingOut: false,
      mine: mine ? { event: [...mine.event], title: [...mine.title], singer: [...mine.singer] } : null,
      songs,
      points,
      credit,
      rank,
      final: final ? { points: final.points, credit: final.credit, place: final.place, paid: final.paid } : null,
    }
  }

  /**
   * The finished round's highlights, from revealed songs only: a song the
   * host never revealed keeps its title secret. Never a typed answer.
   */
  recap(round: RecapRound<SoundtrackState, SoundtrackConfig>): Highlight[] {
    if (!round.finished || !round.state || !round.config || !Array.isArray(round.config.songs)) return []
    const { state, config } = round
    const nameOf = (id: PlayerId) => round.players.find((p) => p.id === id)?.name ?? 'A guest'
    const highlights: Highlight[] = []
    const winners = [...round.winners]
    if (winners.length > 0) {
      const points = Array.isArray(state.playedAt) ? finalRows(state, config, round.players).find((row) => row.playerId === winners[0])?.points : undefined
      highlights.push({
        title: `Lydspor champion: ${joinNames(winners.map(nameOf))}`,
        ...(points !== undefined ? { detail: plural(points, 'Lydspor point') } : {}),
        players: winners,
        ...(round.finishedAt !== null ? { at: round.finishedAt } : {}),
        icon: 'crown',
        tone: 'gold',
        weight: 'headline',
      })
    }
    if (!Array.isArray(state.playedAt) || !Array.isArray(state.wall)) return highlights
    const sheet = sheetOf(state, config, round.players)
    const share = (i: number) => {
      const { counts, scoring } = sheet.songs[i]
      return scoring > 0 ? (counts.event + counts.title + counts.singer) / (3 * scoring) : -1
    }
    const known = sheet.songs.map((_, i) => i).filter((i) => share(i) >= 0)
    if (known.length >= 2) {
      const revealedAt = (n: number) =>
        round.log.find((row) => row.kind === 'game.record' && row.data.type === 'song_revealed' && row.data.n === n)?.at
      const best = [...known].sort((a, b) => share(b) - share(a) || a - b)[0]
      const hardest = [...known].sort((a, b) => share(a) - share(b) || a - b)[0]
      for (const [i, title] of [
        [best, 'Best known song'],
        [hardest, 'Hardest song'],
      ] as const) {
        if (i === best && title === 'Hardest song') continue
        const song = config.songs[i]
        if (!song) continue
        const { counts, scoring } = sheet.songs[i]
        const at = revealedAt(i + 1)
        highlights.push({
          title: `${title}: “${song.title}” by ${song.singer}`,
          detail: `${counts.event} of ${scoring} placed its photo, ${counts.title} typed the title, ${counts.singer} the singer`,
          ...(at !== undefined ? { at } : {}),
          icon: title === 'Best known song' ? 'star' : 'target',
          weight: 'highlight',
        })
      }
    }
    return highlights
  }

  // Host steps -----------------------------------------------------------------------

  private play(state: SoundtrackState, index: number, ctx: GameContext<SoundtrackConfig>): SoundtrackState {
    if (index < state.playedAt.length) return stale(state)
    if (state.phase === 'done') throw new GameError('Lydspor is over')
    if (state.phase !== 'lobby' && state.phase !== 'playing') throw new GameError('The answers are locking')
    if (index > state.playedAt.length) throw new GameError('Play the songs in order')
    if (index >= ctx.config.songs.length) throw new GameError('That was the last song. Tap Last call.')
    const n = index + 1
    ctx.openPrompt(promptKey(n, 'title'), { ...TEXT_SPEC })
    ctx.openPrompt(promptKey(n, 'singer'), { ...TEXT_SPEC })
    ctx.openPrompt(promptKey(n, 'event'), eventSpec(state.wall.length))
    ctx.record('song_played', { n })
    return { ...state, phase: 'playing', playedAt: [...state.playedAt, ctx.now] }
  }

  private more(state: SoundtrackState, n: number, ctx: GameContext<SoundtrackConfig>): SoundtrackState {
    if (state.phase === 'lobby' || state.phase === 'playing') throw new GameError('Tap Last call first')
    // Locked already: the timer won the race.
    if (state.phase !== 'lastCall' || n <= state.extended) return stale(state)
    if (n > MAX_MORE) throw new GameError("That's all the extra time")
    if (state.closingAt !== null) throw new GameError('The answers are locking')
    if (n !== state.extended + 1) return stale(state)
    const lockAt = Math.max(state.lockAt ?? ctx.now, ctx.now) + MORE_MS
    return { ...state, lockAt, extended: n }
  }

  /** Reads every answer once, judges the typed ones, and reveals the prompts: from here nothing changes but how answers score. */
  private lock(state: SoundtrackState, ctx: GameContext<SoundtrackConfig>): SoundtrackState {
    const keys = playedKeys(state.playedAt.length)
    if (keys.some((key) => !ctx.answers[key])) throw new GameError('The answers are still coming in')
    const picks = readPicks(state, ctx.answers)
    const review = buildReview(state, ctx.config, ctx.answers)
    for (const key of keys) ctx.revealPrompt(key)
    ctx.record('locked', { songs: state.playedAt.length, answered: Object.keys(picks).length })
    return { ...state, phase: 'locked', closingAt: null, lockedAt: ctx.now, picks, review }
  }

  private reveal(state: SoundtrackState, index: number, ctx: GameContext<SoundtrackConfig>): SoundtrackState {
    if (state.phase === 'done') throw new GameError('Lydspor is over')
    if (state.phase === 'lobby' || state.phase === 'playing' || state.phase === 'lastCall') throw new GameError('Lock the answers first')
    if (index < state.revealed) return stale(state)
    if (index > state.revealed) throw new GameError('Reveal the songs in order')
    if (index >= state.playedAt.length) throw new GameError('Every song is revealed. Crown Lydspor.')
    // Leaving a top 5: its points are the next one's base for the gains.
    const shownTop = state.phase === 'standings' ? pointsNow(state, ctx) : state.shownTop
    const next: SoundtrackState = { ...state, phase: 'reveal', revealed: index + 1, shownTop }
    const song = sheetOf(next, ctx.config, ctx.players).songs[index]
    ctx.record('song_revealed', {
      n: index + 1,
      photo: letterOf(state.wall.indexOf(index)),
      counts: { ...song.counts },
      scoring: song.scoring,
    })
    return next
  }

  private accept(
    state: SoundtrackState,
    { index, part, key, accepted }: Extract<SoundtrackHostAction, { type: 'accept' }>,
    ctx: GameContext<SoundtrackConfig>,
  ): SoundtrackState {
    const n = index + 1
    if (state.phase === 'done') throw new GameError('Lydspor is over')
    if (index >= state.revealed || !state.review || !state.review[index]) throw new GameError(`Reveal song ${n} first`)
    const row = state.review[index][part].find((r) => r.key === key)
    if (!row) throw new GameError(`Nobody typed that for song ${n}`)
    if (row.verdict === 'exact' || row.verdict === 'typo') throw new GameError('That answer counts already')
    // A double tap asks for what is there already.
    if (row.accepted === accepted) return stale(state)
    const review = state.review.map((song, i) =>
      i === index ? { ...song, [part]: song[part].map((r) => (r.key === key ? { ...r, accepted } : r)) } : song,
    )
    const present = new Set(ctx.players.map((p) => p.id))
    ctx.record(
      accepted ? 'answer_accepted' : 'answer_unaccepted',
      { n, part, key, players: row.players.length },
      { about: row.players.filter((id) => present.has(id)) },
    )
    return { ...state, review }
  }

  /** The crown (or End by the host): the own averages, the payout and the winner. */
  private finish(state: SoundtrackState, ctx: GameContext<SoundtrackConfig>, how: 'crown' | 'end'): SoundtrackState {
    const sheet = sheetOf(state, ctx.config, ctx.players)
    const credits: Record<PlayerId, number> = {}
    for (const id of sheet.participants) credits[id] = creditOf(sheet, id)
    const done: SoundtrackState = { ...state, phase: 'done', closingAt: null, credits }
    const rows = finalRows(done, ctx.config, ctx.players)
    const winners = winnersOf(rows)
    const nameOf = (id: PlayerId) => ctx.players.find((p) => p.id === id)?.name ?? 'Someone'
    const top = rows.find((row) => row.playerId === winners[0])
    ctx.record('crowned', { winners, points: top?.points ?? 0, songs: Math.min(state.revealed, state.playedAt.length) }, { about: winners })
    if (!top) {
      ctx.announce('Lydspor is over', { detail: 'Nobody scored this time', icon: 'trophy', tone: 'gold', sound: 'gong' })
      return done
    }
    const names = joinNames(winners.map(nameOf))
    const points = plural(top.points, 'Lydspor point')
    const tie = winners.length > 1
    if (how === 'crown') {
      ctx.announce(`${names} ${tie ? 'win' : 'wins'} Lydspor!`, {
        detail: tie ? `A tie at ${points}` : points,
        icon: 'crown',
        tone: 'gold',
        sound: 'fanfare',
        interrupt: true,
      })
    } else {
      ctx.announce('Lydspor is over', { detail: `${names} won with ${points}`, icon: 'trophy', tone: 'gold', sound: 'fanfare', interrupt: true })
    }
    ctx.announce('You won Lydspor!', {
      detail: `+${top.paid} on the night board`,
      to: winners,
      icon: 'crown',
      tone: 'gold',
      sound: 'fanfare',
    })
    for (const id of winners) {
      const profile = (ctx.players.find((p) => p.id === id)?.profile[this.type] ?? {}) as SoundtrackProfile
      ctx.updateProfile(id, { wins: (typeof profile.wins === 'number' ? profile.wins : 0) + 1 })
    }
    return done
  }
}

/** A wall index's photo: a song's, or an extra one. */
function photoAt(config: SoundtrackConfig, k: number): { photo: string; caption: string } {
  const song = config.songs[k]
  if (song) return { photo: song.photo, caption: song.caption }
  const extra = config.extraPhotos[k - config.songs.length]
  return { photo: extra?.photo ?? '', caption: extra?.caption ?? '' }
}

/** Lydspor points so far per participant (before the own average): the next top 5's base. */
function pointsNow(state: SoundtrackState, info: Pick<GameInfo<SoundtrackConfig>, 'config' | 'players'>): Record<PlayerId, number> {
  const sheet = sheetOf(state, info.config, info.players)
  const points: Record<PlayerId, number> = {}
  for (const id of sheet.participants) {
    const earned = sheet.earned.get(id) ?? 0
    if (earned !== 0) points[id] = earned
  }
  return points
}

/** The same ids, whatever their order. */
const sameIds = (a: readonly PlayerId[], b: readonly PlayerId[]) =>
  a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n')
