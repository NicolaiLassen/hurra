export const formatPoints = (points: number) => (points > 0 ? `+${points}` : String(points))

/** Adds competition ranks (1, 2, 2, 4) to rows already sorted by points, highest first. */
export function withRanks<T extends { points: number }>(rows: T[]): (T & { rank: number })[] {
  return rows.map((row) => ({ ...row, rank: rows.findIndex((r) => r.points === row.points) + 1 }))
}
