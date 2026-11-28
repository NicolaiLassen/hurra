// When the phone saves a typed title or singer (.design/lydspor/spec.md,
// 4.7.1), as pure rules the fields follow, so typing "Coldwave" is one save,
// not eight: on Next, on Done, on leaving the field (another field, a photo,
// a tab, the page going hidden), and once, 3 seconds before the lock, for a
// field still being typed in. Never per keystroke, never empty, never the
// same text twice; one request at a time per prompt, the last text winning.
// Unsaved text waits in sessionStorage, so a reload loses nothing.
// Relative imports only.
import type { SongPart } from './types'

/** What the database keeps of a typed answer: trimmed of spaces, tabs and line breaks at both ends (check_answer's btrim). */
export const dbTrim = (text: string) => text.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')

/** What leaving a field does with its text. */
export type SaveDecision =
  /** Send the field's text as it is (the database trims it). */
  | { kind: 'send'; text: string }
  /** The database has it already: nothing is sent and no change is spent. */
  | { kind: 'same' }
  /** Emptied: the saved answer goes back in the field ("An answer can be changed, not emptied."). */
  | { kind: 'restore'; text: string }
  /** Empty, and nothing saved: nothing to do. */
  | { kind: 'none' }

/** What to do with a field's text, against the answer the database has (`saved`, already trimmed). */
export function decideSave(field: string, saved: string | null): SaveDecision {
  const text = dbTrim(field)
  if (text === '') return saved === null ? { kind: 'none' } : { kind: 'restore', text: saved }
  if (text === saved) return { kind: 'same' }
  return { kind: 'send', text: field }
}

/** The line under a field emptied and left. */
export const NOT_EMPTIED = 'An answer can be changed, not emptied.'

/** The word beside a field's label: never one that flickers per letter while the guest types. */
export type FieldState =
  /** The database has exactly what the field shows. */
  | 'saved'
  /** A save is on its way. */
  | 'saving'
  /** The field holds text the database doesn't have: refused, offline, or typed before a reload. */
  | 'unsent'
  | null

export function fieldState({
  focused,
  field,
  saved,
  saving,
}: {
  focused: boolean
  field: string
  saved: string | null
  saving: boolean
}): FieldState {
  if (saving) return 'saving'
  // Nothing while the guest types.
  if (focused) return null
  const text = dbTrim(field)
  if (text === '') return null
  return text === saved ? 'saved' : 'unsent'
}

const PART_WORD: Record<SongPart, string> = { title: 'title', singer: 'singer', event: 'event', moment: 'moment' }

const withStop = (text: string) => (text === '' || /[.?]$/.test(text) ? text : `${text}.`)

/**
 * A refused save in the guest's words: the lock, the change cap for this
 * song's part, no connection, or the database's own words.
 */
export function refusalWords(error: unknown, n: number, part: SongPart): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const code =
    error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : ''
  if (code === 'too_many_changes' || /enough changes/i.test(message)) return `That's enough changes for song ${n}'s ${PART_WORD[part]}.`
  if (code === 'closed' || /too late|not open/i.test(message)) return 'Too late, answers are closed.'
  if (code === 'unavailable' || /couldn.t reach|failed to fetch|network/i.test(message)) {
    if (part === 'event') return 'Not sent. Tap again.'
    return `Not sent. Tap ${part === 'title' ? 'Next' : 'Done'} to try again.`
  }
  return withStop(message) || 'Not sent. Try again.'
}

/** How long before the lock the phone saves a field that still has the focus and unsaved text. */
export const SAVE_BEFORE_LOCK_MS = 3000

/** Milliseconds until that save, or null with no lock coming (or once it has passed). */
export function preLockDelay(lockAt: number | null, now: number): number | null {
  if (lockAt === null || now >= lockAt) return null
  return Math.max(0, lockAt - SAVE_BEFORE_LOCK_MS - now)
}

/**
 * One save at a time per prompt key. A save asked for while one runs waits
 * for it, and only the last text asked for in the meantime is sent: the last
 * text wins. `run` sends one save and reports its own failure; it decides
 * again when its turn comes, so a text the database now has is skipped.
 * The returned promise settles once the key's queue is empty.
 */
export function serialSaves<T>(run: (key: string, value: T) => Promise<void>): (key: string, value: T) => Promise<void> {
  const lanes = new Map<string, { queued: { value: T } | null; draining: Promise<void> | null }>()

  async function drain(key: string, lane: { queued: { value: T } | null; draining: Promise<void> | null }) {
    while (lane.queued) {
      const { value } = lane.queued
      lane.queued = null
      try {
        await run(key, value)
      } catch {
        // `run` shows its own failure; the next text in line still goes.
      }
    }
    lane.draining = null
  }

  return (key, value) => {
    let lane = lanes.get(key)
    if (!lane) {
      lane = { queued: null, draining: null }
      lanes.set(key, lane)
    }
    lane.queued = { value }
    lane.draining ??= drain(key, lane)
    return lane.draining
  }
}

// Drafts ---------------------------------------------------------------------------

const DRAFT_PREFIX = 'hurra:lydspor:draft:'

/** Where a field's unsaved text waits: per round and prompt key. */
export const draftSlot = (round: string, key: string) => `${DRAFT_PREFIX}${round}:${key}`

/** The unsaved text of a field, from this tab's storage; null when none, or without storage. */
export function readDraft(round: string, key: string): string | null {
  try {
    return sessionStorage.getItem(draftSlot(round, key))
  } catch {
    return null
  }
}

/** Keeps a field's unsaved text, or forgets it (null). Without storage it lives in memory only. */
export function writeDraft(round: string, key: string, text: string | null) {
  try {
    if (text === null) sessionStorage.removeItem(draftSlot(round, key))
    else sessionStorage.setItem(draftSlot(round, key), text)
  } catch {
    // Private mode or full storage: the draft lives in memory only.
  }
}
