// How an in-person round reads: who leads it, and the words for names, points
// and time. Shared by the recap (logic.ts, bundled into the engine) and the
// screens, so the TV, the phones, the host page and the recap agree. Pure,
// relative imports only, no React.
import type { PlayerId } from '../core/Game'

export type Named = { readonly id: PlayerId; readonly name: string }

export type Leaders<P extends Named = Named> = {
  /** Everyone tied at the top, in the order of the list they came from. */
  readonly players: readonly P[]
  readonly points: number
}

/**
 * A player's points, or 0 when they have none. Anything but a finite number
 * counts as 0, so an inherited key (`toString`) can never pass for points.
 */
export function pointsOf(points: Readonly<Record<PlayerId, number>>, playerId: PlayerId): number {
  const value: unknown = points[playerId]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * The players in `players` with the most points, all tied ones, or null when
 * nobody has more than 0. The same rule as the default winners
 * (docs/engine-v2.md, 3.3), so a round's top scorer is the one it crowned.
 */
export function topScorers<P extends Named>(
  points: Readonly<Record<PlayerId, number>>,
  players: readonly P[],
): Leaders<P> | null {
  const top = Math.max(0, ...players.map((p) => pointsOf(points, p.id)))
  if (top <= 0) return null
  return { players: players.filter((p) => pointsOf(points, p.id) === top), points: top }
}

/**
 * A finished round's top scorers: the winners it crowned (as the TV showed
 * them) who are still in `players` and still top their points. When none of
 * them is left with points (they left the party, or the host took their points
 * back after the end), the top of the points as they stand now.
 */
export function finishedLeaders<P extends Named>(
  winners: readonly PlayerId[],
  points: Readonly<Record<PlayerId, number>>,
  players: readonly P[],
): Leaders<P> | null {
  const crowned = topScorers(points, players.filter((p) => winners.includes(p.id)))
  return crowned ?? topScorers(points, players)
}

/** The players who scored (anything but 0), most points first, then in list order. */
export function scorers<P extends Named>(
  points: Readonly<Record<PlayerId, number>>,
  players: readonly P[],
): (P & { points: number })[] {
  return players
    .map((p) => ({ ...p, points: pointsOf(points, p.id) }))
    .filter((p) => p.points !== 0)
    .sort((a, b) => b.points - a.points)
}

/** "Ana", "Ana and Bo", "Ana, Bo and Cy", then "Ana, Bo, Cy and 2 more" past `max` names. */
export function nameList(names: readonly string[], max = 3): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length > max) return `${names.slice(0, max).join(', ')} and ${names.length - max} more`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** "1 point", "7 points". */
export function pointsLabel(points: number): string {
  return Math.abs(points) === 1 ? `${points} point` : `${points} points`
}

/** How long a round has run: "Just started", "12 min", "1 h", "1 h 5 min". */
export function runningFor(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return 'Just started'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`
}
