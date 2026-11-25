// Locking in a guess on a phone (docs/engine-v2.md, 8.4; spec 6.3): the two
// picks show as sending at once, before the database has them, then locked in
// once it does. If the database refuses (time is up, a lost connection), the
// picker comes back with the picks still made and a short line says why.
// Pure, so the order of what the phone shows is unit-tested in lock.test.ts,
// as the quiz's answer.ts is.
import type { AnswerPayload, PlayerId } from '@/games/core/Game'
import { choiceOf } from '@/games/fusion/view'
import type { SubmitResult } from '@/lib/types'

/** Two guests, as a lock sends them. */
export type Pick2 = [PlayerId, PlayerId]

/** What this phone shows of its own lock on the picture being asked. */
export type LockState =
  /** Not locked in yet (or the last lock rolled back). */
  | { kind: 'none' }
  /** Lock in tapped: shown at once while it is on its way. */
  | { kind: 'sending'; pick: Pick2 }
  /** The database has it. */
  | { kind: 'locked'; pick: Pick2 }
  /**
   * The database refused it: the picker is back, with why, whether another
   * lock can work, and whether the picture has closed (time's up).
   */
  | { kind: 'refused'; message: string; retry: boolean; closed: boolean }

export const NO_LOCK: LockState = { kind: 'none' }

/**
 * The database's refusals that no second tap can change: the prompt has
 * closed, this phone already has a lock, or the round is gone. By the error's
 * code where it has one (the phone's calls carry the database's DETAIL code),
 * else by its words (a fixture's refusal is a plain Error).
 */
const FINAL_CODES = new Set(['closed', 'already_answered', 'restarted', 'not_running'])
const FINAL_WORDS = /too late|not open|already answered|restarted|not running/i
/** The refusals that mean the picture takes no more locks. */
const CLOSED_WORDS = /too late|not open/i

/**
 * A refusal in the server's own words, as one sentence, with "Try again."
 * when another lock can still work: "Too late, answers are closed." or
 * "Couldn't reach the game. Check your connection and try again."
 */
export function refusalOf(error: unknown): { message: string; retry: boolean; closed: boolean } {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code: unknown }).code : null
  const text = raw.trim().replace(/[.!]+$/, '')
  const closed = (code === 'closed' && !/already/i.test(text)) || CLOSED_WORDS.test(text)
  const retry = !(typeof code === 'string' && FINAL_CODES.has(code)) && !FINAL_WORDS.test(text)
  if (!text) return { message: "That didn't go through. Try again.", retry: true, closed: false }
  // The offline message already ends by asking to try again.
  return { message: retry && !/try again/i.test(text) ? `${text}. Try again.` : `${text}.`, retry, closed }
}

/**
 * Sends a lock. `show` gets the sending state synchronously, before `submit`
 * is even called, so the tap shows on the next frame; then the locked state
 * with the two the database kept, or the refusal.
 */
export async function sendLock(
  key: string,
  pick: Pick2,
  submit: (key: string, answer: AnswerPayload) => Promise<SubmitResult>,
  show: (state: LockState) => void,
): Promise<void> {
  show({ kind: 'sending', pick })
  try {
    const result = await submit(key, { choice: [pick[0], pick[1]] })
    show({ kind: 'locked', pick: choiceOf(result.answer) ?? pick })
  } catch (error) {
    show({ kind: 'refused', ...refusalOf(error) })
  }
}

/**
 * The two this phone shows as locked in (or on their way): this tap's while
 * it is sending or once the database took it, else the lock the database read
 * back (after a reload), else null.
 */
export function lockedPick(saved: AnswerPayload | undefined, lock: LockState): Pick2 | null {
  if (lock.kind === 'sending' || lock.kind === 'locked') return lock.pick
  return choiceOf(saved)
}

/** Whether the lock is in: confirmed by the database, or read back from it. */
export function isLockedIn(saved: AnswerPayload | undefined, lock: LockState): boolean {
  if (lock.kind === 'sending') return false
  return lock.kind === 'locked' || choiceOf(saved) !== null
}
