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
//
// Typed moments (momentTyped, default off): each song's own photo shows while
// it plays (public from its Play on, secret before), and the phones type its
// moment (s5.moment) instead of tapping a photo; the moment is judged like the
// title and singer and scores the event's points. No wall, no extra photos.
//
// The AI check (aiCheck, default off) never runs in here: a step must stay
// deterministic. After the lock the host page asks the server
// (netlify/functions/lydspor-ai.mts), which asks an AI about every close or
// wrong row (ai.ts) and sends its yeses back as the host action `ai`, applied
// here once per lock: a yes accepts the row unless the host decided it.
//
// "Doesn't play this game" is typed names, not tied to the guest list
// (people.ts): a guest here sits out when their name folds to one on it, so
// one who joins later with that name sits out from then on, and a name nobody
// joins with changes nothing. Everyone else answers and scores every song the
// same way, whoever is in its photo.
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
import { MAX_NAME_LENGTH, uniqueNames } from '../core/names'
import { counts as verdictCounts, judge, normalise, type Judgement } from './match'
import { MAX_SIT_OUT, sameNames, sitOutNames, sittingOut } from './people'
import {
  MAX_MOMENT,
  MAX_MOMENT_TYPED,
  MAX_TYPED,
  NO_PHOTO,
  letterOf,
  promptKey,
  type EventResult,
  type PartResult,
  type Picks,
  type ReviewRow,
  type SongReview,
  type AiYes,
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

/** The typed moment: any text up to MAX_MOMENT_TYPED characters, changeable until the lock. */
export const MOMENT_SPEC: PromptSpec = { kind: 'text', max_length: MAX_MOMENT_TYPED }

/** The most yeses one `ai` action carries. */
export const MAX_AI_YES = 400

/** The event: a wall index, or NO_PHOTO (a take leaves the other song without one). Changeable until the lock. */
export const eventSpec = (wallSize: number): PromptSpec => ({
  kind: 'choice',
  options: [NO_PHOTO, ...Array.from({ length: wallSize }, (_, i) => String(i))],
})

const PARTS = ['title', 'singer', 'event'] as const
const TYPED_PARTS = ['title', 'singer', 'moment'] as const
/** The parts a guest types: the title and singer, and the moment with typed moments on. */
export const typedParts = (momentTyped: boolean): readonly TypedPart[] => (momentTyped ? TYPED_PARTS : ['title', 'singer'])

/** A game-media path as uploads make them: `<session>/<game>/<uuid>.jpg`, nothing that climbs or points elsewhere. */
const MEDIA_PATH = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\.jpg$/

/** The points one song can give: event, title and singer. */
export const pointsPerSong = (points: SoundtrackPoints) => points.event + points.title + points.singer

/** Every prompt key of the songs played so far, song by song: with typed moments on, the moment instead of the event. */
export const playedKeys = (played: number, momentTyped = false): string[] =>
  Array.from({ length: played }, (_, i) => (momentTyped ? TYPED_PARTS : PARTS).map((part) => promptKey(i + 1, part))).flat()

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

/**
 * "Doesn't play this game" as saved: typed names (or guests' ids, from before
 * names), trimmed, each once by nameKey, with a problem for a name over
 * MAX_NAME_LENGTH or a list over MAX_SIT_OUT.
 */
function sitOutList(value: unknown, problems: string[]): string[] {
  const typed = (Array.isArray(value) ? value : []).filter((item): item is string => typeof item === 'string')
  // An id stays as saved: only setup knows the guest list it names.
  const names = uniqueNames(typed)
  if (names.some((name) => length(name) > MAX_NAME_LENGTH)) problems.push(`A name under Doesn't play this game is at most ${MAX_NAME_LENGTH} characters`)
  if (names.length > MAX_SIT_OUT) problems.push(`Doesn't play this game takes at most ${MAX_SIT_OUT} names`)
  return names.slice(0, MAX_SIT_OUT)
}

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
  const momentTyped = raw.momentTyped === true
  if (rawSongs.length === 0) problems.push('Add at least one song in the settings')
  else if (rawSongs.length > MAX_SONGS) problems.push(`Lydspor takes at most ${MAX_SONGS} songs`)
  const songs = rawSongs.slice(0, MAX_SONGS).map((song, i) => checkSong(song, i + 1, problems, momentTyped))

  const rawExtras = Array.isArray(raw.extraPhotos) ? raw.extraPhotos : []
  if (rawExtras.length > MAX_EXTRA_PHOTOS) problems.push(`Lydspor takes at most ${MAX_EXTRA_PHOTOS} extra photos`)
  const extraPhotos = rawExtras.slice(0, MAX_EXTRA_PHOTOS).map((photo, i) => checkExtraPhoto(photo, i + 1, problems))

  // Two songs whose titles read the same: a typed answer would count for both.
  const titleKeys = songs.map((song) => normalise(song.title))
  const twice = titleKeys.findIndex((key, i) => key !== '' && titleKeys.indexOf(key) !== i)
  if (twice >= 0) problems.push(`Two songs are called ${songs[titleKeys.indexOf(titleKeys[twice])].title}`)
  const photos = [...songs.map((song) => song.photo), ...extraPhotos.map((photo) => photo.photo)].filter(Boolean)
  if (new Set(photos).size !== photos.length) problems.push('The same photo is used twice')
  // Typed moments need no decoys: nobody places a photo.
  if (!momentTyped && songs.length >= EXTRAS_NEEDED_FROM && extraPhotos.length < MIN_EXTRA_PHOTOS) {
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
    momentTyped,
    aiCheck: raw.aiCheck === true,
    boardMax: boardMax ?? 20,
    intro,
    storyteller,
    sitOut: sitOutList(raw.sitOut, problems),
  }
  warnings.push(...configWarnings(config))
  return { config, problems, warnings }
}

function checkSong(input: unknown, n: number, problems: string[], momentTyped: boolean): SoundtrackSong {
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

  // With typed moments on, the moment says what the caption would: a caption is optional.
  const caption = trimmed(raw.caption)
  if (!caption && !momentTyped) problems.push(`Song ${n} needs a caption`)
  else if (length(caption) > MAX_CAPTION) problems.push(`Song ${n}: the caption is at most ${MAX_CAPTION} characters`)

  const moment = trimmed(raw.moment)
  const alsoMoments = texts(raw.alsoMoments)
  if (momentTyped) {
    if (!moment) problems.push(`Song ${n} needs its moment`)
    else if (normalise(moment) === '') problems.push(`Song ${n}: the moment needs a letter or a digit`)
  }
  if (length(moment) > MAX_MOMENT) problems.push(`Song ${n}: the moment is at most ${MAX_MOMENT} characters`)
  if (alsoMoments.length > MAX_ALSO) problems.push(`Song ${n} takes at most ${MAX_ALSO} extra moments`)
  if (alsoMoments.some((text) => length(text) > MAX_MOMENT)) problems.push(`Song ${n}: an extra moment is at most ${MAX_MOMENT} characters`)
  else if (alsoMoments.some((text) => normalise(text) === '')) problems.push(`Song ${n}: an extra moment needs a letter or a digit`)

  const startAt = raw.startAt === undefined || raw.startAt === null || raw.startAt === '' ? 0 : whole(raw.startAt)
  if (startAt === null || startAt < 0 || startAt > MAX_START) problems.push(`Song ${n}: the start must be within the first hour`)

  const note = trimmed(raw.note)
  if (length(note) > MAX_NOTE) problems.push(`Song ${n}: the story note is at most ${MAX_NOTE} characters`)

  // Who was in the photo (settings from before 26 November) is read no more: everyone scores every song.
  return {
    title,
    singer,
    alsoTitles: alsoTitles.slice(0, MAX_ALSO),
    alsoSingers: alsoSingers.slice(0, MAX_ALSO),
    photo,
    caption,
    startAt: startAt ?? 0,
    note,
    moment,
    alsoMoments: alsoMoments.slice(0, MAX_ALSO),
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
  if (!config.momentTyped && songs.length > 0 && extraPhotos.length < SUGGESTED_EXTRA_PHOTOS) {
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
  momentTyped = false,
): Record<PlayerId, Picks> {
  const played = state.playedAt.length
  const picks: Record<PlayerId, Picks> = {}
  const empty = () => Array.from({ length: played }, () => null)
  const entry = (id: PlayerId) =>
    (picks[id] ??= momentTyped
      ? { event: empty(), title: empty(), singer: empty(), moment: empty() }
      : { event: empty(), title: empty(), singer: empty() })
  for (let i = 0; i < played; i++) {
    if (!momentTyped) {
      for (const answer of answers[promptKey(i + 1, 'event')] ?? []) {
        const photo = photoOf(answer.answer, state.wall.length)
        if (photo !== undefined) entry(answer.playerId).event[i] = photo
      }
    }
    for (const part of typedParts(momentTyped)) {
      for (const answer of answers[promptKey(i + 1, part)] ?? []) {
        const text = textOf(answer.answer)
        if (text !== null) (entry(answer.playerId)[part] ??= empty())[i] = text
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

/**
 * One part's answers, in arrival order, grouped by their normalised key. Each
 * spelling is judged on its own, and spellings of one key the rule judges
 * differently get rows of their own ("some1likeyou" and "some1likeyou#2"), so
 * nobody's answer is judged by the spelling someone else typed.
 */
function reviewPart(list: readonly Answer[], part: TypedPart, accepted: readonly string[], other: readonly string[]): ReviewRow[] {
  type Group = { players: PlayerId[]; spellings: Map<string, number>; judged: Judgement }
  const groups = new Map<string, Group>()
  const judgedText = new Map<string, Judgement>()
  /** Per normalised key, the row key of each way its spellings were judged, in arrival order. */
  const rowKeys = new Map<string, Map<string, string>>()
  for (const answer of list) {
    const text = textOf(answer.answer)
    if (text === null) continue
    const base = normalise(text)
    let judged = judgedText.get(text)
    if (!judged) {
      judged = base === '' ? { verdict: 'wrong', reason: null, off: null } : judge(text, part, accepted, other)
      judgedText.set(text, judged)
    }
    const how = `${judged.verdict}:${judged.reason ?? ''}:${judged.off ?? ''}`
    const ways = rowKeys.get(base) ?? new Map<string, string>()
    rowKeys.set(base, ways)
    let key = ways.get(how)
    if (key === undefined) {
      key = ways.size === 0 ? base : `${base}#${ways.size + 1}`
      ways.set(how, key)
    }
    let group = groups.get(key)
    if (!group) {
      group = { players: [], spellings: new Map(), judged }
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
    const { verdict, reason, off } = group.judged
    rows.push({ key, text, players: group.players, verdict, reason, off, accepted: false })
  }
  return rows.sort(byReviewOrder)
}

/** A row the AI check is asked about: the rule didn't count it, and the host hasn't accepted or decided it. */
export const aiAskable = (row: ReviewRow) => (row.verdict === 'close' || row.verdict === 'wrong') && !row.byHost && !row.accepted

/** The accepted texts of one part of a song: the truth, then the settings' extras. */
export const acceptedFor = (song: SoundtrackSong, part: TypedPart): string[] =>
  part === 'title'
    ? [song.title, ...song.alsoTitles]
    : part === 'singer'
      ? [song.singer, ...song.alsoSingers]
      : [song.moment ?? '', ...(song.alsoMoments ?? [])].filter((text) => text !== '')

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
    const momentTyped = config.momentTyped === true
    const review: SongReview = momentTyped ? { title: [], singer: [], moment: [] } : { title: [], singer: [] }
    if (!song) return review
    for (const part of typedParts(momentTyped)) {
      // A moment has no other part to mix it up with.
      const other = part === 'title' ? acceptedFor(song, 'singer') : part === 'singer' ? acceptedFor(song, 'title') : []
      review[part] = reviewPart(answers[promptKey(i + 1, part)] ?? [], part, acceptedFor(song, part), other)
    }
    return review
  })
}

// Scoring, from the state when read ------------------------------------------------

/** How one revealed song went for one guest. */
type Outcome = { event: EventResult; title: PartResult; singer: PartResult; moment: PartResult; points: number }

/** Everything the projections need, computed from the state, the settings and who is here. */
type Sheet = {
  /** Present guests, not sitting out, with any answer at the lock: party order. */
  participants: PlayerId[]
  outcomes: Map<PlayerId, Outcome[]>
  /** Lydspor points so far. */
  earned: Map<PlayerId, number>
  /** Per revealed song: scoring guests who got each part, and how many could. */
  songs: { counts: { event: number; title: number; singer: number }; scoring: number }[]
  /** Per revealed song and typed part: each guest's review row. */
  rows: { title: Map<PlayerId, ReviewRow>; singer: Map<PlayerId, ReviewRow>; moment: Map<PlayerId, ReviewRow> }[]
}

/** How a typed part went: its row's verdict, or 'accepted' for a close or wrong row the host accepted. */
function partResult(row: ReviewRow | undefined): PartResult {
  if (!row) return 'none'
  if (row.verdict === 'exact' || row.verdict === 'typo') return row.verdict
  return row.accepted ? 'accepted' : row.verdict
}

const partCounts = (result: PartResult) => result === 'exact' || result === 'typo' || result === 'accepted'

function outcomeOf(
  state: SoundtrackState,
  config: Pick<SoundtrackConfig, 'points' | 'momentTyped'>,
  sheetRows: Sheet['rows'],
  playerId: PlayerId,
  i: number,
): Outcome {
  const { points } = config
  const title = partResult(sheetRows[i]?.title.get(playerId))
  const singer = partResult(sheetRows[i]?.singer.get(playerId))
  let event: EventResult
  let moment: PartResult = 'none'
  if (config.momentTyped === true) {
    // The typed moment scores the event's points: 'right' when it counts.
    moment = partResult(sheetRows[i]?.moment.get(playerId))
    event = partCounts(moment) ? 'right' : moment === 'none' ? 'none' : 'wrong'
  } else {
    const mine = state.picks?.[playerId]
    const e = mine?.event[i] ?? null
    // The guard: a photo on two of a guest's songs at the lock scores on neither.
    const doubled = e !== null && (mine?.event ?? []).filter((x) => x === e).length > 1
    event = e === null ? 'none' : doubled ? 'doubled' : e === state.wall.indexOf(i) ? 'right' : 'wrong'
  }
  const earned = (event === 'right' ? points.event : 0) + (partCounts(title) ? points.title : 0) + (partCounts(singer) ? points.singer : 0)
  return { event, title, singer, moment, points: earned }
}

let memo: { state: SoundtrackState; config: SoundtrackConfig; players: readonly unknown[]; sheet: Sheet } | null = null

/** Someone here, by id and name: who sits out is matched by name. */
type Here = Pick<GamePlayer, 'id' | 'name'>

/** The sit out list a state holds: names, or ids in a save from before names. */
const sitOutOf = (state: SoundtrackState): string[] => (Array.isArray(state.sitOut) ? state.sitOut.filter((x) => typeof x === 'string') : [])

/** The scores of every revealed song for everyone here (spec 8.2). Memoised for one state, as project() asks once per player. */
function sheetOf(state: SoundtrackState, config: SoundtrackConfig, players: readonly Here[]): Sheet {
  if (memo && memo.state === state && memo.config === config && memo.players === players) return memo.sheet
  const revealed = Math.min(state.revealed, state.playedAt.length, state.review?.length ?? 0)
  const rows: Sheet['rows'] = Array.from({ length: revealed }, (_, i) => {
    const byPlayer = (list: readonly ReviewRow[] | undefined) => {
      const map = new Map<PlayerId, ReviewRow>()
      for (const row of list ?? []) for (const id of row.players) map.set(id, row)
      return map
    }
    return { title: byPlayer(state.review?.[i]?.title), singer: byPlayer(state.review?.[i]?.singer), moment: byPlayer(state.review?.[i]?.moment) }
  })
  const sitOut = sittingOut(sitOutOf(state), players)
  const picks = state.picks ?? {}
  const participants = players.map((p) => p.id).filter((id) => !sitOut.has(id) && Object.hasOwn(picks, id))
  const sheet: Sheet = {
    participants,
    outcomes: new Map(),
    earned: new Map(),
    songs: Array.from({ length: revealed }, () => ({ counts: { event: 0, title: 0, singer: 0 }, scoring: 0 })),
    rows,
  }
  for (const id of participants) {
    const outcomes = Array.from({ length: revealed }, (_, i) => outcomeOf(state, config, rows, id, i))
    let earned = 0
    outcomes.forEach((outcome, i) => {
      earned += outcome.points
      const song = sheet.songs[i]
      song.scoring++
      if (outcome.event === 'right') song.counts.event++
      if (partCounts(outcome.title)) song.counts.title++
      if (partCounts(outcome.singer)) song.counts.singer++
    })
    sheet.outcomes.set(id, outcomes)
    sheet.earned.set(id, earned)
  }
  memo = { state, config, players, sheet }
  return sheet
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

/** Lydspor's final rows, once crowned: every participant's points, place and payout. */
function finalRows(state: SoundtrackState, config: SoundtrackConfig, players: readonly Here[]) {
  const sheet = sheetOf(state, config, players)
  const most = Math.min(state.revealed, state.playedAt.length) * pointsPerSong(config.points)
  const rows = sheet.participants.map((playerId) => {
    const points = sheet.earned.get(playerId) ?? 0
    // The night board never gets raw Lydspor points: a scale to at most boardMax.
    const paid = most > 0 ? Math.round((points * config.boardMax) / most) : 0
    return { playerId, points, paid }
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
    momentTyped: false,
    aiCheck: false,
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

  /**
   * Deals the wall: the songs' photos and the extra photos, shuffled, lettered
   * A on. Who sits out becomes names here, the first place the guest list is
   * known: an id from settings saved before names is its guest's name. Nothing
   * is announced: the TV's title card opens the game.
   */
  setup(ctx: GameContext<SoundtrackConfig>): SoundtrackState {
    const { songs, extraPhotos } = ctx.config
    return {
      phase: 'lobby',
      // Typed moments: no wall to place photos on, each song keeps its own (index i is song i).
      wall:
        ctx.config.momentTyped === true
          ? songs.map((_, i) => i)
          : shuffle(
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
      sitOut: sitOutNames(ctx.config.sitOut, ctx.guests, ctx.players),
      shownTop: {},
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
          (action.part === 'title' || action.part === 'singer' || action.part === 'moment') &&
          typeof action.key === 'string' &&
          action.key.length <= 400 &&
          typeof action.accepted === 'boolean'
        ) {
          return { type: 'accept', index: action.index, part: action.part, key: action.key, accepted: action.accepted }
        }
        break
      case 'ai': {
        const list = action.yes
        if (!Array.isArray(list) || list.length > MAX_AI_YES) break
        const yes: AiYes[] = []
        for (const item of list) {
          const row = item !== null && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : {}
          if (!step(row.index) || (row.part !== 'title' && row.part !== 'singer' && row.part !== 'moment')) throw new GameError('Unknown Lydspor step')
          if (typeof row.key !== 'string' || row.key.length > 400) throw new GameError('Unknown Lydspor step')
          yes.push({ index: row.index, part: row.part, key: row.key })
        }
        return { type: 'ai', yes }
      }
      case 'standings':
        if (step(action.after)) return { type: 'standings', after: action.after }
        break
      case 'crown':
        return { type: 'crown' }
      case 'sitOut': {
        // Typed names; a host page from before names sends the guests' ids, which setup's rule turns into names.
        const list = Array.isArray(action.names) ? action.names : action.playerIds
        if (Array.isArray(list) && list.length <= MAX_SIT_OUT && list.every((item) => typeof item === 'string')) {
          // Ids stay as sent: handleHostAction knows the guest list they name.
          const names = uniqueNames(list as string[])
          if (names.some((name) => length(name) > MAX_NAME_LENGTH)) throw new GameError(`Names are at most ${MAX_NAME_LENGTH} characters`)
          return { type: 'sitOut', names }
        }
        break
      }
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
      case 'ai':
        return this.aiVerdicts(state, action.yes, ctx)
      case 'standings':
        if (state.phase !== 'reveal' || action.after !== state.revealed) return stale(state)
        return { ...state, phase: 'standings' }
      case 'crown':
        if (state.phase === 'done') return stale(state)
        if (state.phase === 'playing' || state.phase === 'lastCall') throw new GameError('Lock the answers first')
        return this.finish(state, ctx, 'crown')
      case 'sitOut': {
        if (state.phase === 'done') throw new GameError('Lydspor is over')
        const names = sitOutNames(action.names, ctx.guests, ctx.players)
        if (sameNames(sitOutNames(sitOutOf(state), ctx.guests, ctx.players), names)) return stale(state)
        return { ...state, sitOut: names }
      }
    }
  }

  /** In last call: at lockAt the timer closes every prompt; a second later it locks, once every answer list is in. */
  wakeAt(state: SoundtrackState): number | null {
    if (state.phase !== 'lastCall' || state.lockAt === null) return null
    return state.closingAt === null ? state.lockAt : state.closingAt + CLOSING_RETRY_MS
  }

  onWake(state: SoundtrackState, ctx: GameContext<SoundtrackConfig>): SoundtrackState {
    if (state.phase !== 'lastCall') return state
    const keys = playedKeys(state.playedAt.length, ctx.config.momentTyped === true)
    // Closed already (a host's close list got there first): lock now.
    if (keys.every((key) => ctx.answers[key])) return this.lock(state, ctx)
    // Close what is still open; the next sync, a second later, reads the answers.
    for (const key of keys) if (!ctx.answers[key]) ctx.closePrompt(key)
    return { ...state, closingAt: ctx.now }
  }

  /**
   * Someone left the party: removed, or the host freed their name, which
   * someone else may take next under the same id (docs/guest-list.md, 9.3).
   * Their answers go: their picks, their place in every review row (a row left
   * with nobody goes) and their points at the last top 5. `sitOut` keeps its
   * names: a name, not a phone. Before the lock their answers are prompt
   * answers, which the database deletes with them.
   */
  onPlayerLeave(state: SoundtrackState, playerId: PlayerId): SoundtrackState {
    const picked = state.picks !== null && Object.hasOwn(state.picks, playerId)
    const reviewed = (state.review ?? []).some((song) =>
      [...song.title, ...song.singer, ...(song.moment ?? [])].some((row) => row.players.includes(playerId)),
    )
    const shown = Object.hasOwn(state.shownTop, playerId)
    if (!picked && !reviewed && !shown) return state
    const rows = (list: ReviewRow[]) =>
      list
        .map((row) => (row.players.includes(playerId) ? { ...row, players: row.players.filter((id) => id !== playerId) } : row))
        .filter((row) => row.players.length > 0)
    return {
      ...state,
      picks: state.picks === null ? null : without(state.picks, playerId),
      review:
        state.review === null
          ? null
          : state.review.map((song) => ({
              title: rows(song.title),
              singer: rows(song.singer),
              ...(song.moment ? { moment: rows(song.moment) } : {}),
            })),
      shownTop: without(state.shownTop, playerId),
    }
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
    const typed = config.momentTyped === true
    const sheet = sheetOf(state, config, info.players)
    const revealed = sheet.songs.length
    const sitOut = sittingOut(sitOutOf(state), info.players)
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
            moment: typed ? (song.moment ?? '') : '',
            counts: { ...sheet.songs[last].counts },
            scoring: sheet.songs[last].scoring,
          }
        : null
    const afterLast = revealed > 0 && revealed === state.playedAt.length && ['reveal', 'standings', 'done'].includes(state.phase)
    return {
      phase: state.phase,
      total: config.songs.length,
      playedAt: [...state.playedAt],
      // Typed moments: only the played songs' own photos, in play order; the rest stay secret.
      wall: (typed ? state.wall.slice(0, state.playedAt.length) : state.wall).map((k) => {
        const photo = photoAt(config, k)
        return { path: photo.photo, hint: config.hints && photo.caption !== '' ? photo.caption : null }
      }),
      momentTyped: typed,
      points: { ...config.points },
      lockAt: state.lockAt,
      lockedAt: state.lockedAt,
      playing: info.players.filter((p) => !sitOut.has(p.id)).length,
      revealed,
      reveal,
      // The photos that fit no played song: the extras, and songs never played.
      extras: afterLast && !typed
        ? state.wall
            .filter((k) => k >= state.playedAt.length)
            .map((k) => {
              const photo = photoAt(config, k)
              return { path: photo.photo, caption: photo.caption }
            })
        : null,
      top: ranked(sheet.participants.map((playerId) => ({ playerId, points: sheet.earned.get(playerId) ?? 0 })).filter((row) => row.points > 0))
        .slice(0, TOP_SIZE)
        // The gain counts what was earned since the last top 5.
        .map((row) => ({ ...row, gained: row.points - (state.shownTop[row.playerId] ?? 0) })),
      final:
        state.phase === 'done'
          ? finalRows(state, config, info.players).map(({ playerId, points, place, paid }) => ({ playerId, points, place, paid }))
          : null,
      intro: config.intro,
      storyteller: config.storyteller,
    }
  }

  playerView(state: SoundtrackState, playerId: PlayerId, info: GameInfo<SoundtrackConfig>): SoundtrackPlayerView {
    if (sittingOut(sitOutOf(state), info.players).has(playerId)) return { sittingOut: true, mine: null, songs: [], points: 0, rank: null, final: null }
    const sheet = sheetOf(state, info.config, info.players)
    const mine = state.picks && Object.hasOwn(state.picks, playerId) ? state.picks[playerId] : null
    const outcomes = sheet.outcomes.get(playerId) ?? sheet.songs.map((_, i) => outcomeOf(state, info.config, sheet.rows, playerId, i))
    const songs: SoundtrackSongView[] = outcomes.map((outcome, i) => ({
      n: i + 1,
      points: sheet.outcomes.has(playerId) ? outcome.points : 0,
      event: outcome.event,
      title: outcome.title,
      singer: outcome.singer,
      moment: outcome.moment,
    }))
    // Ranked as the TV's top 5 ranks.
    const points = sheet.outcomes.has(playerId) ? (sheet.earned.get(playerId) ?? 0) : 0
    const rank =
      points > 0
        ? (ranked(sheet.participants.map((id) => ({ id, points: sheet.earned.get(id) ?? 0 })).filter((row) => row.points > 0)).find(
            (row) => row.id === playerId,
          )?.rank ?? null)
        : null
    const final = state.phase === 'done' ? finalRows(state, info.config, info.players).find((row) => row.playerId === playerId) : undefined
    return {
      sittingOut: false,
      mine: mine
        ? { event: [...mine.event], title: [...mine.title], singer: [...mine.singer], ...(mine.moment ? { moment: [...mine.moment] } : {}) }
        : null,
      songs,
      points,
      rank,
      final: final ? { points: final.points, place: final.place, paid: final.paid } : null,
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
          detail: `${counts.event} of ${scoring} ${config.momentTyped === true ? 'named its moment' : 'placed its photo'}, ${counts.title} typed the title, ${counts.singer} the singer`,
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
    if (ctx.config.momentTyped === true) ctx.openPrompt(promptKey(n, 'moment'), { ...MOMENT_SPEC })
    else ctx.openPrompt(promptKey(n, 'event'), eventSpec(state.wall.length))
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
    const typed = ctx.config.momentTyped === true
    const keys = playedKeys(state.playedAt.length, typed)
    if (keys.some((key) => !ctx.answers[key])) throw new GameError('The answers are still coming in')
    const picks = readPicks(state, ctx.answers, typed)
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
    const row = (state.review[index][part] ?? []).find((r) => r.key === key)
    if (!row) throw new GameError(`Nobody typed that for song ${n}`)
    if (row.verdict === 'exact' || row.verdict === 'typo') throw new GameError('That answer counts already')
    // A double tap asks for what is there already.
    if (row.accepted === accepted) return stale(state)
    // With the AI check on, the host's own decision (an undo of an AI yes too) is one the AI never changes.
    const mark = ctx.config.aiCheck === true ? { byHost: true as const } : {}
    const review = state.review.map((song, i) =>
      i === index ? { ...song, [part]: (song[part] ?? []).map((r) => (r.key === key ? { ...r, accepted, ...mark } : r)) } : song,
    )
    const present = new Set(ctx.players.map((p) => p.id))
    ctx.record(
      accepted ? 'answer_accepted' : 'answer_unaccepted',
      { n, part, key, players: row.players.length },
      { about: row.players.filter((id) => present.has(id)) },
    )
    return { ...state, review }
  }

  /**
   * The AI check's verdicts, once per lock: every close or wrong row was
   * asked; a yes accepts it, a no leaves it; a row the host decided keeps the
   * host's decision. Deterministic: the verdicts come in the action, the AI
   * call was the server's (netlify/functions/lydspor-ai.mts).
   */
  private aiVerdicts(state: SoundtrackState, yes: readonly AiYes[], ctx: GameContext<SoundtrackConfig>): SoundtrackState {
    if (ctx.config.aiCheck !== true) throw new GameError('The AI check is off for this game')
    if (state.phase === 'done') throw new GameError('Lydspor is over')
    if (state.phase === 'lobby' || state.phase === 'playing' || state.phase === 'lastCall' || !state.review) {
      throw new GameError('Lock the answers first')
    }
    // Once per lock: a second host page's check, or a retry that raced the first, changes nothing.
    if (state.ai) return stale(state)
    const said = new Set(yes.map((y) => `${y.index}|${y.part}|${y.key}`))
    let asked = 0
    let accepted = 0
    const judged = (index: number, part: TypedPart, rows: ReviewRow[]) =>
      rows.map((row) => {
        if (!aiAskable(row)) return row
        asked++
        const ok = said.has(`${index}|${part}|${row.key}`)
        if (ok) accepted++
        return { ...row, ai: ok ? ('yes' as const) : ('no' as const), accepted: ok }
      })
    const review = state.review.map((song, i) => ({
      ...song,
      title: judged(i, 'title', song.title),
      singer: judged(i, 'singer', song.singer),
      ...(song.moment ? { moment: judged(i, 'moment', song.moment) } : {}),
    }))
    ctx.record('ai_checked', { asked, accepted })
    return { ...state, review, ai: { at: ctx.now, asked, accepted } }
  }

  /** The crown (or End by the host): the payout and the winner. */
  private finish(state: SoundtrackState, ctx: GameContext<SoundtrackConfig>, how: 'crown' | 'end'): SoundtrackState {
    const done: SoundtrackState = { ...state, phase: 'done', closingAt: null }
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

/** A wall index's photo: a song's, or an extra one. A song's caption may be empty with typed moments on. */
function photoAt(config: SoundtrackConfig, k: number): { photo: string; caption: string } {
  const song = config.songs[k]
  if (song) return { photo: song.photo, caption: song.caption }
  const extra = config.extraPhotos[k - config.songs.length]
  return { photo: extra?.photo ?? '', caption: extra?.caption ?? '' }
}

/** Lydspor points so far per participant: the next top 5's base. */
function pointsNow(state: SoundtrackState, info: Pick<GameInfo<SoundtrackConfig>, 'config' | 'players'>): Record<PlayerId, number> {
  const sheet = sheetOf(state, info.config, info.players)
  const points: Record<PlayerId, number> = {}
  for (const id of sheet.participants) {
    const earned = sheet.earned.get(id) ?? 0
    if (earned !== 0) points[id] = earned
  }
  return points
}

/** A record without one id's entry. */
function without<T>(record: Readonly<Record<PlayerId, T>>, id: PlayerId): Record<PlayerId, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== id))
}
