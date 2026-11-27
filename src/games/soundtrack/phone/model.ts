// Lydspor's phone rules beyond typing (.design/lydspor/spec.md, section 4),
// pure so model.test.ts pins them: one photo per song with swaps, takes and
// their Undo, what each tile of the wall says before the tap, the parts
// answered and missing, when a new song takes the phone, and how far the
// page scrolls with the keyboard up. Relative imports only.
import type { AnswerPayload } from '../../core/Game'
import { NO_PHOTO, type SongPart, type TypedPart } from '../types'

/** The data attributes a typed field carries, so the page can save the focused one when it goes hidden. */
export const FIELD_SONG = 'data-lydspor-song'
export const FIELD_PART = 'data-lydspor-part'

/** A typed field's id on the page: `${prefix}-s5-title`. */
export const fieldId = (prefix: string, n: number, part: TypedPart) => `${prefix}-s${n}-${part}`

// The ledger ------------------------------------------------------------------------

/**
 * An answer this phone saved, kept until the snapshot catches up (a phone
 * hears no ping for its own save). `stale` lists what the snapshot may still
 * say meanwhile: what it said before, and this phone's own earlier saves.
 */
export type Confirmed = { answer: AnswerPayload; stale: string[] }

/** An answer as one comparable string; '' for none. */
export const signature = (answer: AnswerPayload | null | undefined) => (answer ? JSON.stringify(answer) : '')

/** The answer the database has, as this phone knows it: its own save while the snapshot is behind, else the snapshot's. */
export function shownAnswer(snapshot: AnswerPayload | undefined, confirmed: Confirmed | undefined): AnswerPayload | undefined {
  if (!confirmed) return snapshot
  return confirmed.stale.includes(signature(snapshot)) ? confirmed.answer : snapshot
}

/** Notes a save the database confirmed, over what the snapshot said when it went. */
export function confirmAnswer(previous: Confirmed | undefined, snapshot: AnswerPayload | undefined, answer: AnswerPayload): Confirmed {
  const stale = new Set(previous ? [...previous.stale, signature(previous.answer)] : [])
  stale.add(signature(snapshot))
  stale.delete(signature(answer))
  return { answer, stale: [...stale] }
}

/**
 * The ledger without the saves the snapshot has caught up with: once a read
 * holds the very answer this phone saved, the snapshot is the truth again.
 * Reads land in order, so nothing older can follow it. Without this, in a
 * game played in teams, a teammate who changes the answer back to one this
 * phone had before would stay hidden behind this phone's own save. The same
 * object when nothing changes, so it can run on every snapshot.
 */
export function settleLedger(
  ledger: Readonly<Record<string, Confirmed>>,
  snapshot: Readonly<Record<string, AnswerPayload>>,
): Record<string, Confirmed> {
  const caughtUp = Object.keys(ledger).filter((key) => signature(snapshot[key]) === signature(ledger[key].answer))
  if (caughtUp.length === 0) return ledger as Record<string, Confirmed>
  const next = { ...ledger }
  for (const key of caughtUp) delete next[key]
  return next
}

// Photos -----------------------------------------------------------------------------

/** Each played song's photo as this phone shows it: index i is song i + 1, a wall index or null. */
export type Events = readonly (number | null)[]

/** One photo write: song n gets `photo`, or no photo (null). */
export type PhotoWrite = { n: number; photo: number | null }

/** What a tap on a photo for song n does. */
export type PhotoMove =
  /** It is song n's photo already: nothing. */
  | { kind: 'same' }
  /** No other song has it: one write. */
  | { kind: 'place'; writes: PhotoWrite[] }
  /** Another song has it and song n had a photo: the two trade. */
  | { kind: 'swap'; other: number; writes: PhotoWrite[]; undo: PhotoWrite[] }
  /** Another song has it and song n had none: n takes it, and the other is left without one. */
  | { kind: 'take'; other: number; writes: PhotoWrite[]; undo: PhotoWrite[] }

/** The song (from 1) other than `except` that has the photo, or null. */
export function holderOf(events: Events, photo: number, except: number): number | null {
  const i = events.findIndex((e, k) => e === photo && k + 1 !== except)
  return i === -1 ? null : i + 1
}

/**
 * A tap on `photo` for song n. A swap or take is two writes, the other song
 * first, then this one (spec 4.7); Undo writes both back, freeing first the
 * photo the first write gave away, so a take never puts one photo on two songs.
 */
export function planPhoto(events: Events, n: number, photo: number): PhotoMove {
  const mine = events[n - 1] ?? null
  if (mine === photo) return { kind: 'same' }
  const other = holderOf(events, photo, n)
  if (other === null) return { kind: 'place', writes: [{ n, photo }] }
  const writes = [
    { n: other, photo: mine },
    { n, photo },
  ]
  const undo = [
    { n, photo: mine },
    { n: other, photo },
  ]
  return mine === null ? { kind: 'take', other, writes, undo } : { kind: 'swap', other, writes, undo }
}

/** The event answer a write sends. */
export const photoChoice = (photo: number | null) => ({ choice: [photo === null ? NO_PHOTO : String(photo)] })

/** The band across the bottom of a tile, before the tap: "Here now", "Swap with 4", or none. */
export type Band = { kind: 'here' } | { kind: 'swap'; with: number } | null

export function bandOf(events: Events, n: number, photo: number): Band {
  if ((events[n - 1] ?? null) === photo) return { kind: 'here' }
  const other = holderOf(events, photo, n)
  return other === null ? null : { kind: 'swap', with: other }
}

/** Photos on two songs or more, with those songs: a roll back that failed (spec 4.7). They score on neither. */
export function doubledPhotos(events: Events): Map<number, number[]> {
  const songs = new Map<number, number[]>()
  events.forEach((photo, i) => {
    if (photo === null) return
    songs.set(photo, [...(songs.get(photo) ?? []), i + 1])
  })
  for (const [photo, list] of songs) if (list.length < 2) songs.delete(photo)
  return songs
}

/** The parts of a song in the order the phone asks them. */
export const PARTS: readonly SongPart[] = ['title', 'singer', 'event']

/** Parts answered of parts played: "13 of 15" on the board's tab. */
export function answeredParts(played: number, has: (n: number, part: SongPart) => boolean): { answered: number; total: number } {
  let answered = 0
  for (let n = 1; n <= played; n++) for (const part of PARTS) if (has(n, part)) answered++
  return { answered, total: played * PARTS.length }
}

/** Every part of the songs played that has no answer yet, song by song: the last call's one-tap rows. */
export function missingParts(played: number, has: (n: number, part: SongPart) => boolean): { n: number; part: SongPart }[] {
  const missing: { n: number; part: SongPart }[] = []
  for (let n = 1; n <= played; n++) for (const part of PARTS) if (!has(n, part)) missing.push({ n, part })
  return missing
}

/** How long untouched before a new song takes the phone from wherever it is. */
export const IDLE_MS = 8000
/** A tap this recent may be the first of two: a new song waits rather than move the photos under it. */
export const TOUCH_GUARD_MS = 2000

/**
 * Whether a new song takes the phone to Now playing (spec 4.2): from Now
 * playing as the song starts (`fresh`), unless the guest touched the screen
 * in the last 2 seconds, and from anywhere after 8 seconds untouched; never
 * while a field has the focus or a sheet or an opened row covers the page.
 * Otherwise the banner says it is playing.
 */
export function followsNewSong({
  tab,
  typing,
  covered,
  idleMs,
  fresh,
}: {
  tab: 'now' | 'board'
  typing: boolean
  covered: boolean
  idleMs: number
  /** The song has just started: the first look at it. */
  fresh: boolean
}): boolean {
  if (typing || covered) return false
  if (idleMs >= IDLE_MS) return true
  return fresh && tab === 'now' && idleMs >= TOUCH_GUARD_MS
}

/** The gap kept above the keyboard and below the top of the screen. */
export const KEYBOARD_MARGIN = 12

/**
 * How far to scroll (down when positive) with the keyboard up, so a block,
 * the heading and both fields, shows whole above it (spec 4.3 and 4.6.1):
 * the least that puts its bottom 12 px above the keyboard, but never so far
 * that its top goes higher than 12 px from the top. When both can't hold,
 * the focused field wins. Every position is in the page's viewport; the
 * visible part is `viewTop` down to `viewTop + viewHeight`.
 */
export function keyboardScroll(
  m: { top: number; bottom: number; focusTop: number; focusBottom: number; viewTop: number; viewHeight: number },
  margin = KEYBOARD_MARGIN,
): number {
  const low = m.viewTop + margin
  const high = m.viewTop + m.viewHeight - margin
  const needDown = m.bottom - high
  const roomDown = m.top - low
  let down = 0
  if (needDown > 0) down = Math.min(needDown, Math.max(roomDown, 0))
  else if (roomDown < 0) down = Math.max(roomDown, needDown)
  // The focused field wins.
  if (m.focusBottom - down > high) down = m.focusBottom - high
  if (m.focusTop - down < low) down = m.focusTop - low
  return Math.round(down)
}
