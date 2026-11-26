// The guest list's pure helpers (docs/guest-list.md): a pasted list as names,
// the Danish order the phone and the host room show names in, the search on
// "Who are you?", and the host's counts. No client, so unit tests pin them.
import type { GameGuest } from '@/games/core/Game'
import { foldName } from '@/lib/format'
import type { ListedGuest, ScoreRow, Snapshot } from '@/lib/types'

/** At most this many names go in one Add guests (host_add_guests refuses more). */
export const MAX_NAMES_PER_ADD = 100

/** A list mark at the start of a pasted line: a dash, a star, a bullet or a middle dot, or "1." or "1)". */
const LIST_MARK = /^(?:[-*\u2022\u00b7]|\d{1,3}[.)])\s+/
/** A Markdown table's separator row (|---|:--:|) or a rule (---): only pipes, dashes, colons and spaces. */
const SEPARATOR_ROW = /^[|:\s-]*-[|:\s-]*$/
/** A note in brackets at the end of a name: "Ana Holm (cousin)". */
const NOTE = /\s*\([^()]*\)$/
/** What a list's first line says when it is a header, not a guest (folded, a colon after it aside). */
const HEADER_WORDS = new Set(['name', 'names', 'navn', 'navne', 'guest', 'guests', 'gaest', 'gaester', 'who', 'hvem'])

export type PastedNames = {
  /** The names to add, in order: one per line, cleaned (nameInLine), blank lines gone, at most 100. */
  names: string[]
  /** How many lines repeat an earlier one (by the folded name); they are still in `names` for the database to skip. */
  repeats: number
  /** Each name on more than one line, as first written, with how many lines it is on. */
  repeated: { name: string; lines: number }[]
  /** How many names are past the first 100, left for another Add. */
  over: number
  /** Those names, in order, for the field after the first 100 went in. */
  rest: string[]
}

/**
 * The name in one pasted line: the first cell of a Markdown table row (| Ana |
 * cousin |) or of a row copied from a table (Ana, a tab, cousin), without a
 * list mark, and without a note in brackets at its end.
 */
export function nameInLine(line: string): string {
  let text = line.trim()
  if (text.startsWith('|')) text = text.slice(1).split('|')[0]
  else if (text.includes('\t')) text = text.split('\t')[0]
  text = text.trim().replace(LIST_MARK, '').trim()
  return text.replace(NOTE, '').trim() || text
}

/**
 * One name per line, as Add guests reads a paste: a plain list, a bulleted or
 * numbered one, a Markdown table, or rows copied from a table or a sheet.
 * Headings (# Guests), a table's header row and separator row, and a first
 * line that is only a header word (Name, Navn, Guests) are not names.
 */
export function namesFromText(text: string): PastedNames {
  const lines = text.split(/\r\n|\r|\n/).map((line) => line.trim())
  const all: string[] = []
  lines.forEach((line, i) => {
    if (line === '' || line.startsWith('#') || SEPARATOR_ROW.test(line)) return
    // A table's header row is the row right above its separator row.
    const below = lines[i + 1] ?? ''
    if (line.startsWith('|') && below.includes('|') && SEPARATOR_ROW.test(below)) return
    const name = nameInLine(line)
    if (name === '' || (all.length === 0 && HEADER_WORDS.has(foldName(name).replace(/:$/, '')))) return
    all.push(name)
  })
  const names = all.slice(0, MAX_NAMES_PER_ADD)
  const counts = new Map<string, { name: string; lines: number }>()
  for (const name of names) {
    const key = foldName(name)
    const seen = counts.get(key)
    if (seen) seen.lines++
    else counts.set(key, { name, lines: 1 })
  }
  const repeated = [...counts.values()].filter((entry) => entry.lines > 1)
  const repeats = repeated.reduce((sum, entry) => sum + entry.lines - 1, 0)
  return { names, repeats, repeated, over: all.length - names.length, rest: all.slice(MAX_NAMES_PER_ADD) }
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

/**
 * Whether the host listed this name: still expected, or taken after it was
 * listed (joined later than it was made). A guest who typed their name joined
 * the moment their row was made, and rows from before the guest list did too.
 */
export function wasListed(guest: Pick<ListedGuest, 'joined_at' | 'created_at'>): boolean {
  return guest.joined_at === null || guest.joined_at > guest.created_at
}

/**
 * The host's counts: who is here, who is still expected, everyone on the list,
 * and how many of them the host listed (0 while the host has listed nobody,
 * even when guests joined by typing their names).
 */
export function listCounts(snapshot: Pick<Snapshot, 'players' | 'guests'>): {
  here: number
  expected: number
  total: number
  listed: number
} {
  const guests = guestsOf(snapshot)
  const here = guests.filter((g) => g.joined).length
  const listed = (snapshot.guests ?? []).filter(wasListed).length
  return { here, expected: guests.length - here, total: guests.length, listed }
}

/** A guest in the host's one list (docs/guest-list.md, 7.1): here, with their row on the scoreboard, or not here yet. */
export type PresenceRow =
  | {
      here: true
      id: string
      name: string
      score: ScoreRow
      /** Joined by typing a name that was not on the list (only said once the host listed anyone). */
      typed: boolean
    }
  | { here: false; id: string; name: string; guest: ListedGuest }

/**
 * Everyone the host's list shows, in its two groups, each by name the Danish
 * way: the guests not here yet first, then everyone here. Not yet stays on
 * top all night, so the list never jumps when most have come: during arrival
 * it is who the host is waiting for, and later only the few who never came.
 * Here is every guest who joined, on the list or not; on a database without
 * a guest list, every player.
 */
export function presenceRows(snapshot: Pick<Snapshot, 'standings' | 'guests'>): { notYet: PresenceRow[]; here: PresenceRow[] } {
  const guests = snapshot.guests ?? []
  const anyListed = guests.some(wasListed)
  const listedById = new Map(guests.map((g) => [g.id, g]))
  const here: PresenceRow[] = snapshot.standings.map((score) => {
    const guest = listedById.get(score.player_id)
    return { here: true, id: score.player_id, name: score.name, score, typed: anyListed && guest !== undefined && !wasListed(guest) }
  })
  const notYet: PresenceRow[] = guests.filter((g) => g.joined_at === null).map((guest) => ({ here: false, id: guest.id, name: guest.name, guest }))
  return { notYet: sortNames(notYet), here: sortNames(here) }
}
