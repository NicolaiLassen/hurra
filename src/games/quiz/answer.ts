// A tap on the quiz controller (docs/identity.md, The quiz on a phone): the
// picked tile shows at once, before the database has the answer, then the
// locked-in state once it does. If the database refuses (time is up, a lost
// connection), the tile rolls back and a short line says why. Pure, so the
// order of what the phone shows is unit-tested in answer.test.ts.
import type { AnswerPayload, SubmitResult } from '@/lib/types'
import { letterOf } from './look'
import { choiceIndex } from './read'

/** What this phone shows of its own answer to the open question. */
export type PickState =
  /** Nothing tapped yet (or the last tap rolled back with no message). */
  | { kind: 'none' }
  /** Tapped: shown at once while the answer is on its way. */
  | { kind: 'sending'; choice: number }
  /** The database has it. */
  | { kind: 'locked'; choice: number }
  /** The database refused it: the tile rolled back, and why. */
  | { kind: 'refused'; message: string }

export const NO_PICK: PickState = { kind: 'none' }

/** The short line for a refusal: the server's own words ("Too late, answers are closed."), as one sentence. */
export function refusalText(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const text = raw.trim().replace(/[.!]+$/, '')
  return text ? `${text}.` : "That didn't go through. Tap again."
}

/**
 * Sends a pick. `show` gets the sending state synchronously, before
 * `submit` is even called, so the tap shows on the next frame; then the
 * locked state with the answer the database kept, or the refusal.
 */
export async function sendPick(
  key: string,
  choice: number,
  submit: (key: string, answer: AnswerPayload) => Promise<SubmitResult>,
  show: (state: PickState) => void,
): Promise<void> {
  show({ kind: 'sending', choice })
  try {
    const result = await submit(key, { choice: [String(choice)] })
    show({ kind: 'locked', choice: choiceIndex(result.answer) ?? choice })
  } catch (error) {
    show({ kind: 'refused', message: refusalText(error) })
  }
}

/**
 * The option this phone shows as picked: this tap's while it is sending or
 * once the database took it, else the answer the database read back (after a
 * reload). A refusal rolls the tile back to that: none, for a first answer.
 */
export function shownChoice(saved: AnswerPayload | undefined, pick: PickState): number | null {
  if (pick.kind === 'sending' || pick.kind === 'locked') return pick.choice
  return choiceIndex(saved)
}

/**
 * How a question's answer works, in the words the phone says it: the quiz
 * opens its prompts with `final`, so the first tap counts; a prompt without
 * it takes changes until it closes.
 */
export function ruleLine(final: boolean, letters: boolean): string {
  const tap = letters ? 'Tap the letter of your answer.' : 'Tap your answer.'
  return final ? `${tap} Your first tap counts.` : `${tap} You can change it until the time is up.`
}

/** Whether the pick is in: read back from the database, or confirmed by it. */
export function isLocked(saved: AnswerPayload | undefined, pick: PickState): boolean {
  if (pick.kind === 'sending') return false
  return pick.kind === 'locked' || choiceIndex(saved) !== null
}

/** An answer tile's accessible name: its letter, and its answer when the phone shows the answers ("C: Copenhagen"). */
export const tileName = (index: number, option: string | null) => (option ? `${letterOf(index)}: ${option}` : letterOf(index))
