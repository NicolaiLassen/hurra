// The quiz's own look, shared by its screens. Hurra's style, not a copy of any
// quiz show: stacked option rows on dark cards, a tilted letter chip per option
// in the quiz key's four colours (the chips only), a gold bar draining along the
// question card, and a row of gold dots counting answers.

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

/** The countdown turns pink for its last seconds. */
export const URGENT_MS = 5000

/** A moment's sound plays only this soon after the moment: a phone opened later stays quiet. */
export const FRESH_MS = 15_000

/** The sessionStorage key that remembers a moment's sound played (docs/engine-v2.md, 3.5). */
export const momentId = (game: { id: string; started_at: number | null }, key: string, moment: string) =>
  `hurra:quiz:${game.id}:${game.started_at ?? 0}:${key}:${moment}`

const length = (text: string) => Array.from(text).length

/** The question's size on the TV: as large as its length allows, a step down while the reveal shares the screen. */
export function tvQuestionSize(text: string, revealing = false): string {
  const n = length(text) + (revealing ? 60 : 0)
  if (n <= 50) return 'text-6xl short:text-5xl'
  if (n <= 100) return 'text-5xl short:text-4xl'
  if (n <= 160) return 'text-4xl short:text-3xl'
  return 'text-3xl short:text-2xl'
}

/** The options' size on the TV, set by the longest so the rows match. */
export function tvOptionSize(options: readonly string[]): string {
  const n = Math.max(0, ...options.map(length))
  if (n <= 24) return 'text-4xl short:text-3xl'
  if (n <= 48) return 'text-3xl short:text-2xl'
  return 'text-2xl short:text-xl'
}

/** The dots counting answers get smaller as the party grows, so 45 still fit on one row. */
export function dotSize(count: number, screen: 'tv' | 'host'): string {
  if (screen === 'host') return count <= 30 ? 'size-3' : 'size-2'
  if (count <= 30) return 'size-5 short:size-4'
  if (count <= 60) return 'size-4 short:size-3'
  return 'size-3 short:size-2.5'
}
