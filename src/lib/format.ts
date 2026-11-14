export const formatPoints = (points: number) => (points > 0 ? `+${points}` : String(points))

/** Adds competition ranks (1, 2, 2, 4) to rows already sorted by points, highest first. */
export function withRanks<T extends { points: number }>(rows: T[]): (T & { rank: number })[] {
  return rows.map((row) => ({ ...row, rank: rows.findIndex((r) => r.points === row.points) + 1 }))
}

/**
 * Name search text: lower case, accents dropped and Nordic letters folded, so "soren" finds Søren and "ase" finds Åse.
 * Compatibility forms too (NFKD), since names are stored as typed: "luka" finds a full-width or math-letter Luka.
 */
export function foldName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .trim()
}
