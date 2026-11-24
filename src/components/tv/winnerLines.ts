// What the winner's screen says (docs/identity.md, The winner's screen), as
// pure functions of the night's standings and the game's points, so the words
// are tested. The cheer is the product's one exclamation mark.
import type { Said } from '@/components/tv/boardLines'
import { listNames } from '@/lib/recap'

type Row = { player_id: string; name: string; points: number }

/** The line under the night's podium that every game result carries. */
export const THIRD_HURRA = "The third hurra is saved for the night's winner."

/** A guest's first name, as their token's slate shows it: "Marie-Louise" for Marie-Louise Christensen. */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name

/** "Hurra for Bo!", or "Hurra for Ana and Bo!": the screen's one exclamation mark. */
export function cheer(names: readonly string[]): string {
  return `Hurra for ${listNames(names.map(firstName))}!`
}

const points = (n: number) => `${n} point${n === 1 ? '' : 's'}`
const ordinal = (n: number) => {
  const tens = n % 100
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
  return `${n}${suffix}`
}

/** The night's standings, highest first, ties by name, with competition ranks (1, 2, 2, 4). */
export function nightRanks<T extends Row>(scores: readonly T[]): (T & { rank: number })[] {
  const sorted = [...scores].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))
  return sorted.map((row) => ({ ...row, rank: 1 + sorted.filter((other) => other.points > row.points).length }))
}

/**
 * What the game did to the night, for the line beside the podium: "Last one
 * standing gave Bo 10 points and a 4 point lead over Ana.", "...and a share
 * of first with Ana.", or "...Bo is 3rd for the night." For several winners,
 * what each got.
 */
export function nightLine(title: string, winnerIds: readonly string[], scores: readonly Row[], gamePoints: Readonly<Record<string, number>>): Said {
  const ranked = nightRanks(scores)
  const winners = winnerIds.flatMap((id) => ranked.find((row) => row.player_id === id) ?? [])
  if (winners.length === 0) return []
  const gained = (id: string) => gamePoints[id] ?? 0
  const names = (rows: readonly Row[]) =>
    rows.slice(0, 3).flatMap((row, i, list) => [...(i === 0 ? [] : [i === list.length - 1 ? ' and ' : ', ']), { name: row.name }])

  if (winners.length > 1) {
    const each = gained(winners[0].player_id)
    const same = winners.every((row) => gained(row.player_id) === each)
    return same && each > 0 ? [`${title} gave `, ...names(winners), ` ${points(each)} each.`] : [`${title} went to `, ...names(winners), '.']
  }

  const [winner] = winners
  const got = gained(winner.player_id)
  const opening: Said = got > 0 ? [`${title} gave `, { name: winner.name }, ` ${points(got)}`] : [{ name: winner.name }]
  if (winner.rank === 1) {
    const level = ranked.filter((row) => row.player_id !== winner.player_id && row.points === winner.points)
    if (level.length > 0) return [...opening, got > 0 ? ' and a share of first with ' : ' shares first with ', ...names(level), '.']
    const next = ranked.find((row) => row.player_id !== winner.player_id)
    if (!next) return [...opening, got > 0 ? '.' : ' leads the night.']
    const lead = winner.points - next.points
    return [...opening, got > 0 ? ` and a ${lead} point lead over ` : ` leads the night by ${points(lead)} over `, { name: next.name }, '.']
  }
  return got > 0
    ? [...opening, '. ', { name: winner.name }, ` is ${ordinal(winner.rank)} for the night.`]
    : [...opening, ` is ${ordinal(winner.rank)} for the night.`]
}

/** The generic deck: "Won Beer pong with 7 points.", or "Won Beer pong together." for a shared win. */
export function wonDeck(title: string, winnerIds: readonly string[], gamePoints: Readonly<Record<string, number>>): string {
  if (winnerIds.length > 1) return `Won ${title} together.`
  const got = gamePoints[winnerIds[0]] ?? 0
  return got > 0 ? `Won ${title} with ${points(got)}.` : `Won ${title}.`
}

/** Last one standing's deck: "The last one in, with 7 knockouts." */
export function lastOneDeck(knockouts: number): string {
  return knockouts > 0 ? `The last one in, with ${knockouts} knockout${knockouts === 1 ? '' : 's'}.` : 'The last one in.'
}
