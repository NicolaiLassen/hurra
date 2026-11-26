// Participant fusion's look on the TV (docs/identity.md, Participant fusion on
// the TV): the house easing, the countdown's gold seconds, the sounds' moments
// and the names. Plain values, shared by the TV's views and parts.

/** The house easing (docs/identity.md, Motion). */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const

/** The countdown turns gold for its last seconds, while the tick-tock plays. */
export const URGENT_MS = 5000
/** A moment's sound plays only this soon after the moment: a TV that opens later stays quiet. */
export const FRESH_MS = 15_000

/** The sessionStorage key that remembers a moment's sound played (docs/engine-v2.md, 3.5). */
export const momentId = (game: { id: string; started_at: number | null }, key: string, moment: string) =>
  `hurra:fusion:${game.id}:${game.started_at ?? 0}:${key}:${moment}`

/** A guest's name, else a placeholder. */
export const nameOf = (players: readonly { id: string; name: string }[], id: string) => players.find((p) => p.id === id)?.name ?? 'A guest'

/** "Marie-Louise" for Marie-Louise Christensen. */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name
