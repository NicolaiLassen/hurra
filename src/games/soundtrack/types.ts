// Lydspor's shapes: the settings, the state, the host actions, the public
// state and each guest's view (.design/lydspor/spec.md, section 11). The
// logic, the TV, the phone and the host room build on this file in parallel,
// so it changes only when all four agree. Relative imports only: the Netlify
// function bundles it.
import type { PlayerId } from '../core/Game'

/** The two parts a guest types. */
export type TypedPart = 'title' | 'singer'

/** The three parts of a song, in the order the phone asks them. */
export type SongPart = TypedPart | 'event'

/** The longest typed answer in characters: the text prompts' max_length. */
export const MAX_TYPED = 60

/** The event prompt's choice for no photo (a take leaves the other song without one). */
export const NO_PHOTO = 'none'

/** The prompt for one part of song n, from 1: "s5.title". */
export const promptKey = (n: number, part: SongPart): string => `s${n}.${part}`

/** A wall index as its letter: 0 is A. */
export const letterOf = (index: number): string => String.fromCharCode(65 + index)

// Settings ------------------------------------------------------------------

export type SoundtrackSong = {
  /** 1 to 60 characters, as the reveal shows it. */
  title: string
  /** 1 to 60 characters, as the reveal shows it. */
  singer: string
  /** Other answers that count for the title: 0 to 6, each 1 to 60 characters. Never shown to guests. */
  alsoTitles: string[]
  /** Other answers that count for the singer: 0 to 6, each 1 to 60 characters. Never shown to guests. */
  alsoSingers: string[]
  /** A game-media path; its thumbnail sits beside it. */
  photo: string
  /** 1 to 30 characters, shown at the reveal (and under the photo with hints on). */
  caption: string
  /** Where the hook starts, whole seconds, 0 to 3599 (m:ss in the editor). */
  startAt: number
  /** 0 to 140 characters, host only: a story prompt on the cue card. */
  note: string
  /** Who is in the photo, at most 10: this song scores as their own average. */
  inPhoto: PlayerId[]
}

/** A photo that fits no song. */
export type SoundtrackPhoto = {
  photo: string
  /** 1 to 30 characters. */
  caption: string
}

export type SoundtrackPoints = { event: number; title: number; singer: number }

export type SoundtrackConfig = {
  /** 1 to 12, in play order. */
  songs: SoundtrackSong[]
  /** 0 to 4; songs plus extras at most 16. With 3 or more songs, at least 2. */
  extraPhotos: SoundtrackPhoto[]
  /** Whole numbers 0 to 5 each. Default event 2, title 1, singer 1. */
  points: SoundtrackPoints
  /** 20 to 180. Default 60. */
  lastCallSeconds: number
  /** Show the top 5 after every this many reveals; 0 never. Default 4. */
  standingsEvery: number
  /** Captions under the photos while songs play. Default false. */
  hints: boolean
  /** The most Lydspor pays on the night board, 1 to 25. Default 20. */
  boardMax: number
  /** 0 to 120 characters: the lobby's first line. */
  intro: string
  /** 0 to 40 characters: who tells the stories. */
  storyteller: string
  sitOut: PlayerId[]
}

// State (hosts only) ------------------------------------------------------------

export type SoundtrackPhase = 'lobby' | 'playing' | 'lastCall' | 'locked' | 'reveal' | 'standings' | 'done'

/** One guest's answers, per played song (index i is song i + 1). */
export type Picks = {
  /** A wall index, or null for no photo. */
  event: (number | null)[]
  /** The text as saved (the database trims it), or null when never typed. */
  title: (string | null)[]
  singer: (string | null)[]
}

/** How the matching rule judged a typed answer at the lock. */
export type Verdict =
  /** The same as an accepted text once normalised. Counts. */
  | 'exact'
  /** Within the allowed wrong letters of an accepted text. Counts. */
  | 'typo'
  /** Doesn't count unless the host accepts it: shown in the host's review. */
  | 'close'
  /** Doesn't count unless the host accepts it from Other answers. */
  | 'wrong'

/** Why a close answer is close: its tag in the host's review. */
export type CloseReason =
  /** Up to 2 more wrong letters than allowed, or a wrong first letter or number: "3 letters off". */
  | 'spelling'
  /** Some of the words and nothing else: "Part of it". */
  | 'part'
  /** All the words and more: "With extra words". */
  | 'extra'
  /** A title's words in another order: "Words in another order". */
  | 'order'
  /** It is the song's other part: "That's the singer", "That's the title". */
  | 'otherPart'

/** One distinct typed answer to one part of one song, with everyone who typed it. */
export type ReviewRow = {
  /**
   * The normalised answer (match.ts normalise): how answers group, and what
   * Accept names. Spellings of one key the rule judges differently get a row
   * each, the later ones keyed "some1likeyou#2".
   */
  key: string
  /** The spelling most of them typed (on a tie, the first to arrive), trimmed. */
  text: string
  /** Everyone who typed it, in the order their answers arrived. */
  players: PlayerId[]
  verdict: Verdict
  /** Set for 'close' only. */
  reason: CloseReason | null
  /** Wrong letters to the nearest accepted text, for reason 'spelling' only. */
  off: number | null
  /** The host accepted it. Only a 'close' or 'wrong' row can be. */
  accepted: boolean
}

/** One played song's typed answers, judged at the lock. */
export type SongReview = { title: ReviewRow[]; singer: ReviewRow[] }

export type SoundtrackState = {
  phase: SoundtrackPhase
  /** Per letter (A is 0): a song's photo (0 to songs - 1) or an extra photo (songs + k). */
  wall: number[]
  /** When each played song started (ms, database clock); its length is the songs played. */
  playedAt: number[]
  lockAt: number | null
  /** Last call extensions so far, 0 to 2. */
  extended: number
  /** Set when the timer closed the prompts, until the lock. */
  closingAt: number | null
  lockedAt: number | null
  /** Every guest with any answer, read once at the lock. */
  picks: Record<PlayerId, Picks> | null
  /** Per played song, built at the lock; accepts change its rows. */
  review: SongReview[] | null
  /** Songs revealed, 0 to playedAt.length. */
  revealed: number
  /** Per song: who is in its photo (from the settings, changed by setInPhoto). */
  inPhoto: PlayerId[][]
  sitOut: PlayerId[]
  /** Points at the last top 5, for its gains. */
  shownTop: Record<PlayerId, number>
  /** The own average per guest, set at the crown. */
  credits: Record<PlayerId, number> | null
}

// Host actions --------------------------------------------------------------------

export type SoundtrackHostAction =
  | { type: 'play'; index: number }
  | { type: 'lastCall'; after: number }
  | { type: 'more'; n: number }
  | { type: 'lock' }
  | { type: 'reveal'; index: number }
  | { type: 'accept'; index: number; part: TypedPart; key: string; accepted: boolean }
  | { type: 'standings'; after: number }
  | { type: 'crown' }
  | { type: 'setInPhoto'; index: number; playerIds: PlayerId[] }
  | { type: 'sitOut'; playerIds: PlayerId[] }

// What everyone sees ----------------------------------------------------------------

/** The song just revealed. */
export type SoundtrackReveal = {
  /** The song's number, from 1. */
  n: number
  /** Its photo's wall index. */
  event: number
  title: string
  singer: string
  caption: string
  /** Scoring guests who got each part, the host's accepts included. */
  counts: { event: number; title: number; singer: number }
  /** Scoring guests for this song: present, not sitting out, not in its photo, with any answer at the lock. */
  scoring: number
}

export type SoundtrackPublicState = {
  phase: SoundtrackPhase
  /** Songs in the settings. */
  total: number
  playedAt: number[]
  /** Per letter: the photo, and its caption only when hints are on. */
  wall: { path: string; hint: string | null }[]
  points: SoundtrackPoints
  lockAt: number | null
  lockedAt: number | null
  /** Present guests minus sitOut: the "of" while songs play. */
  playing: number
  revealed: number
  /** The latest revealed song, else null. */
  reveal: SoundtrackReveal | null
  /** The photos that fit no song, after the last reveal only. */
  extras: { path: string; caption: string }[] | null
  /**
   * The top 5. Once every song played is revealed, `points` include the own
   * average (`credit`), as the crown will count them; before that `credit` is 0.
   * `gained` is what was earned since the last top 5, without the own average.
   */
  top: { playerId: PlayerId; points: number; credit: number; rank: number; gained: number }[]
  final: { playerId: PlayerId; points: number; place: number; paid: number }[] | null
  intro: string
  storyteller: string
}

// What one guest sees --------------------------------------------------------------------

/** How a typed part of a revealed song went for this guest. */
export type PartResult =
  /** Counted: "You typed “hallelujah”." */
  | 'exact'
  /** Counted: "Spelling forgiven." */
  | 'typo'
  /** Counted: "Close, the host accepted it." */
  | 'accepted'
  /** Not counted: "Close, not counted." The host may still accept it. */
  | 'close'
  /** Not counted. */
  | 'wrong'
  /** Nothing typed: "No answer." */
  | 'none'

/** How the event of a revealed song went for this guest. */
export type EventResult = 'right' | 'wrong' | 'doubled' | 'none'

export type SoundtrackSongView = {
  /** The song's number, from 1. */
  n: number
  /** What this song gave; 0 when in its photo (the own average comes at the crown). */
  points: number
  inPhoto: boolean
  event: EventResult
  title: PartResult
  singer: PartResult
}

export type SoundtrackPlayerView = {
  sittingOut: boolean
  /** From the lock on: this guest's answers that score. Null before it, or with no answer. */
  mine: Picks | null
  /** Revealed songs, in order. */
  songs: SoundtrackSongView[]
  /** Lydspor points so far: what this guest earned, plus the own average once every song played is revealed. */
  points: number
  /** The own average in `points`: 0 until every song played is revealed. */
  credit: number
  /** Place among scoring guests, once this guest has scored. */
  rank: number | null
  final: { points: number; credit: number; place: number; paid: number } | null
}
