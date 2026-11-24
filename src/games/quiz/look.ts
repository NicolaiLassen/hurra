// The quiz's own look, shared by its screens (docs/identity.md, The quiz on
// the TV). On the TV: the question in the reading face, a 2 by 2 grid of dark
// tiles with a tilted letter chip per option in the quiz key's four colours
// (the chips only), one big countdown figure, and a row of tilted paper pips
// counting answers. Gold stays out of the key and off the countdown until its
// last seconds.

export const LETTERS = ['A', 'B', 'C', 'D'] as const

/** "A" for option 0. */
export const letterOf = (index: number) => LETTERS[index] ?? String(index + 1)

/**
 * The quiz key: A coral, B pink, C teal, D violet, in ink, always with the
 * letter and always in this order. Gold stays out of the key, so it keeps its
 * one meaning on every screen (docs/identity.md).
 */
export const LETTER_TONES = [
  'bg-key-a text-ink',
  'bg-key-b text-ink',
  'bg-key-c text-ink',
  'bg-key-d text-ink',
] as const

/** Each badge sits at its own small tilt, like confetti that just landed. */
export const LETTER_TILTS = ['-rotate-3', 'rotate-2', '-rotate-2', 'rotate-3'] as const

/** The countdown turns gold for its last seconds, while the tick-tock plays. */
export const URGENT_MS = 5000

/** A moment's sound plays only this soon after the moment: a phone opened later stays quiet. */
export const FRESH_MS = 15_000

/** The sessionStorage key that remembers a moment's sound played (docs/engine-v2.md, 3.5). */
export const momentId = (game: { id: string; started_at: number | null }, key: string, moment: string) =>
  `hurra:quiz:${game.id}:${game.started_at ?? 0}:${key}:${moment}`

const length = (text: string) => Array.from(text).length

/**
 * The question's sizes on the TV, largest first: 86 px at 1080p, each with its
 * short: step (1440 by 900) and its low: step (720p). The view starts at
 * questionStep's guess and steps down while the question takes more than two
 * lines, so it never takes three. Each sets only the size: the view sets one
 * line height for all of them.
 */
export const QUESTION_STEPS = [
  'text-tv-question short:text-tv-answer low:text-tv-name',
  'text-tv-answer short:text-tv-score low:text-tv-band',
  'text-tv-score short:text-tv-name low:text-tv-field',
  'text-tv-name short:text-tv-band low:text-tv-body',
  'text-tv-band short:text-tv-field low:text-tv-tab',
  'text-tv-field short:text-tv-body low:text-tv-floor',
  'text-tv-body short:text-tv-tab low:text-tv-floor',
  'text-tv-floor',
] as const

/** The first size to try for a question: about two lines' worth of characters at each size. */
export function questionStep(text: string): number {
  const n = length(text)
  if (n <= 52) return 0
  if (n <= 72) return 1
  if (n <= 84) return 2
  if (n <= 100) return 3
  if (n <= 120) return 4
  return 5
}

/** The question's size class on the TV from its length alone (the view also measures it), a step down with `smaller`. */
export const tvQuestionSize = (text: string, smaller = false) =>
  QUESTION_STEPS[Math.min(QUESTION_STEPS.length - 1, questionStep(text) + (smaller ? 1 : 0))]

/**
 * The answers' sizes in their tiles, largest first: 66 px at 1080p. All four
 * share one size, set by the longest; the view steps down while any answer
 * overflows its tile.
 */
export const OPTION_STEPS = [
  'text-tv-answer short:text-tv-score low:text-tv-band',
  'text-tv-name short:text-tv-band low:text-tv-field',
  'text-tv-band short:text-tv-field low:text-tv-tab',
  'text-tv-body short:text-tv-tab low:text-tv-floor',
  'text-tv-floor',
] as const

/** The first size to try for the options, set by the longest so the tiles match. */
export function optionStep(options: readonly string[]): number {
  const n = Math.max(0, ...options.map(length))
  if (n <= 18) return 0
  if (n <= 28) return 1
  if (n <= 44) return 2
  if (n <= 64) return 3
  return 4
}

/** The options' size class on the TV, from their length alone (the view also measures them). */
export const tvOptionSize = (options: readonly string[]) => OPTION_STEPS[optionStep(options)]

/** The host page's dots counting answers get smaller as the party grows, so 45 still fit on one row. */
export function dotSize(count: number, screen: 'tv' | 'host'): string {
  if (screen === 'host') return count <= 30 ? 'size-3' : 'size-2'
  if (count <= 30) return 'size-5 short:size-4'
  if (count <= 60) return 'size-4 short:size-3'
  return 'size-3 short:size-2.5'
}

/** The TV's answer pips lean like the letter chips, in a fixed pattern so each keeps its tilt. */
export const PIP_TILTS = ['-rotate-3', 'rotate-2', '-rotate-1', 'rotate-3', '-rotate-2', 'rotate-1', 'rotate-3', '-rotate-2'] as const
