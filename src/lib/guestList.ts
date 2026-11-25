// The guest list's pure helpers (docs/guest-list.md): a pasted list as names,
// the Danish order the phone and the host room show names in, the search on
// "Who are you?", and the host's counts. No client, so unit tests pin them.
import type { GameGuest } from '@/games/core/Game'
import { foldName } from '@/lib/format'
import type { Snapshot } from '@/lib/types'

/** At most this many names go in one Add guests (host_add_guests refuses more). */
export const MAX_NAMES_PER_ADD = 100

/** A list mark at the start of a pasted line: a dash, a star, a bullet or a middle dot, or "1." or "1)". */
const LIST_MARK = /^(?:[-*\u2022\u00b7]|\d{1,3}[.)])\s+/

export type PastedNames = {
  /** The names to add, in order: trimmed, list marks dropped, blank lines gone, at most 100. */
  names: string[]
  /** How many lines repeat an earlier one (by the folded name); they are still in `names` for the database to skip. */
  repeats: number
  /** How many names are past the first 100, left for another Add. */
  over: number
}

/** One name per line, as Add guests reads a paste. */
export function namesFromText(text: string): PastedNames {
  const all = text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim().replace(LIST_MARK, '').trim())
    .filter((line) => line !== '')
  const names = all.slice(0, MAX_NAMES_PER_ADD)
  const seen = new Set<string>()
  let repeats = 0
  for (const name of names) {
    const key = foldName(name)
    if (seen.has(key)) repeats++
    seen.add(key)
  }
  return { names, repeats, over: all.length - names.length }
}

const collator = new Intl.Collator('da', { sensitivity: 'base' })

/** Names the Danish way: case and accents aside, and Æ, Ø and Å after Z. */
export function sortNames<T extends string | { name: string }>(items: readonly T[]): T[] {
  const nameOf = (item: T) => (typeof item === 'string' ? item : item.name)
  return [...items].sort((a, b) => collator.compare(nameOf(a), nameOf(b)))
}

/** The names a search finds, as the Players search does: "soren" finds Søren. All of them for an empty search. */
export function matchNames<T extends string | { name: string }>(items: readonly T[], query: string): T[] {
  const needle = foldName(query)
  if (needle === '') return [...items]
  return items.filter((item) => foldName(typeof item === 'string' ? item : item.name).includes(needle))
}

/** Everyone on the guest list for a settings editor or a host view, or the players as joined on a database without it. */
export function guestsOf(snapshot: Pick<Snapshot, 'players' | 'guests'>): GameGuest[] {
  if (!snapshot.guests) return snapshot.players.map((p) => ({ id: p.id, name: p.name, joined: true }))
  return snapshot.guests.map((g) => ({ id: g.id, name: g.name, joined: g.joined_at !== null }))
}

/** The host's counts: who is here, who is still expected, and everyone on the list. */
export function listCounts(snapshot: Pick<Snapshot, 'players' | 'guests'>): { here: number; expected: number; total: number } {
  const guests = guestsOf(snapshot)
  const here = guests.filter((g) => g.joined).length
  return { here, expected: guests.length - here, total: guests.length }
}
