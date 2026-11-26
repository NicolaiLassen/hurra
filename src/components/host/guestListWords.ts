// The host room's words for the guest list (docs/guest-list.md, 7): the card's
// line, what Add guests did, and the Free the name and Remove confirms. Pure,
// so the unit tests pin them.
import { foldName } from '@/lib/format'
import { MAX_NAMES_PER_ADD } from '@/lib/guestList'
import type { AddedGuests } from '@/lib/queries'

/**
 * The count at the top of the host's guest list: "14 of 22 here", everyone on
 * the list and anyone who joined without being on it. "All 22 here" once
 * nobody is expected, "12 here" while the host has listed nobody (or on a
 * database without a guest list), "Nobody here yet" for an empty party.
 */
export function presenceLine({ here, expected, total, listed }: { here: number; expected: number; total: number; listed: number }): string {
  if (total === 0) return 'Nobody here yet'
  if (expected === 0) return listed > 0 ? `All ${total} here` : `${here} here`
  return `${here} of ${total} here`
}

/**
 * The line under the count while the host has listed nobody (an empty list,
 * or only guests who typed their names): the invitation to add them. Null
 * once anyone is listed: the list says the rest. The list helps guests join
 * and shows who is here; games that name people take typed names, with the
 * list only as suggestions (docs/guest-list.md).
 */
export function guestListLine({ listed }: { listed: number }): string | null {
  if (listed > 0) return null
  return (
    'Add the guests you invited. When they join, they tap their name instead of typing it, and this list shows who ' +
    'is here. Games that name people take typed names, with these names as suggestions.'
  )
}

/** A few names in a line: "Ana, Bo and Mads", or "Ana, Bo, Mads, Sofie, Freja and 7 more". */
export function someNames(names: readonly string[], shown = 5): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length <= shown) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `${names.slice(0, shown).join(', ')} and ${names.length - shown} more`
}

const count = (n: number, one: string, many: string) => `${n} ${Math.abs(n) === 1 ? one : many}`

/** What Add guests says once the database answered, and which lines it keeps in the field. */
export type AddSummary = {
  /** The toast's title, or null for no toast (nothing was added, and only names too long were left out). */
  title: string | null
  /** The toast's second line: what was left out. */
  description?: string
  /** Something was added (a success toast), or nothing was (a plain note). */
  added: boolean
  /** Names over 40 characters, as given: the dialog stays open with these in the field. */
  tooLong: string[]
  /**
   * Each name this Add put on the list that was on more than one line of the
   * paste, once, as the list has it: the dialog stays open with these in the
   * field, in case they are two people.
   */
  repeated: string[]
}

/**
 * `listed` is every name on the list before this Add: a name left out reads
 * as the list has it ("Bo" for a pasted "bo"), the same for a name repeated
 * in the paste, which is on the list now too.
 */
export function addSummary({ added, skipped }: AddedGuests, listed: readonly string[] = []): AddSummary {
  const known = [...added.map((g) => g.name), ...listed]
  const asListed = (name: string) => known.find((k) => foldName(k) === foldName(name)) ?? name.trim()
  const already = [...new Set(skipped.filter((s) => s.reason === 'taken').map((s) => asListed(s.name)))]
  const tooLong = skipped.filter((s) => s.reason === 'too_long').map((s) => s.name)
  // A repeat of a name this Add put on the list (a repeat of one already there is just "already on the list").
  const addedKeys = new Set(added.map((g) => foldName(g.name)))
  const repeatedByKey = new Map<string, string>()
  for (const s of skipped) {
    const key = foldName(s.name)
    if (s.reason === 'repeat' && addedKeys.has(key) && !repeatedByKey.has(key)) repeatedByKey.set(key, asListed(s.name))
  }
  const repeated = [...repeatedByKey.values()]
  const parts = [
    already.length > 0 ? `Already on the list: ${someNames(already)}.` : null,
    repeated.length > 0 ? `${someNames(repeated)} ${repeated.length === 1 ? 'was' : 'were'} on more than one line: added once.` : null,
    tooLong.length > 0 ? `Over 40 characters: ${count(tooLong.length, 'name', 'names')}.` : null,
  ].filter((part) => part !== null)
  if (added.length > 0) {
    return {
      title: added.length === 1 ? `Added ${added[0].name}` : `Added ${added.length} guests`,
      description: parts.length > 0 ? parts.join(' ') : undefined,
      added: true,
      tooLong,
      repeated,
    }
  }
  if (already.length > 0 && tooLong.length === 0 && repeated.length === 0) {
    return { title: 'Everyone you added is already on the list', added: false, tooLong, repeated }
  }
  if (already.length > 0) return { title: `Already on the list: ${someNames(already)}`, added: false, tooLong, repeated }
  return { title: null, added: false, tooLong, repeated }
}

/** What the Add guests dialog says above the names it kept in the field: why each kind is still there. */
export function keptNote({ tooLong, repeated, over }: { tooLong: number; repeated: string[]; over: number }): string[] {
  return [
    repeated.length === 1
      ? `${repeated[0]} was on more than one line, so the list has one ${repeated[0]}. If they are two people, add a last ` +
        "name or an initial to the one here and add it again. If not, you're done."
      : null,
    repeated.length > 1
      ? `${someNames(repeated)} were each on more than one line, so the list has each of them once. If any are two ` +
        "people, add a last name or an initial to the one here and add it again. If not, you're done."
      : null,
    tooLong === 1 ? 'This name is over 40 characters. Shorten it and add it again.' : null,
    tooLong > 1 ? 'These are over 40 characters. Shorten them and add them again.' : null,
    over > 0 ? `These are the names after the first ${MAX_NAMES_PER_ADD}. Add them now.` : null,
  ].filter((part) => part !== null)
}

/**
 * The Free the name confirm's words, built from what applies. `typed`: the
 * guest typed this name (it was never on the list), so it goes on the list
 * for the first time, and the confirm also offers to take it off (a spelling
 * of a listed name, Mads H for Mads Holm).
 */
export function freeNameDescription({
  name,
  points,
  joiningOpen,
  typed = false,
}: {
  name: string
  points: number
  joiningOpen: boolean
  typed?: boolean
}): string {
  return [
    typed
      ? `${name} goes on the guest list as not here yet, and the phone that has the name asks Who are you? again.`
      : `${name} goes back on the guest list as not here yet, and the phone that has the name asks Who are you? again.`,
    points !== 0 ? `The ${count(points, 'point', 'points')} it earned as ${name} ${Math.abs(points) === 1 ? 'goes' : 'go'} with it.` : null,
    typed ? `Another spelling of a name on the list? Free it and take ${name} off the list.` : null,
    joiningOpen ? null : 'Joining is closed: open it so they can pick their name.',
  ]
    .filter((part) => part !== null)
    .join(' ')
}

/**
 * The guest list's Remove, for a guest who is here. Every joined guest is also their place on the
 * guest list, so Remove takes them off it. Game settings that name people keep
 * the names typed there. `listed`: the name was on the list before this guest
 * took it, so a wrong name is fixed with Free the name, which keeps it on the
 * list.
 */
export function removePlayerDescription({ name, listed, canFree }: { name: string; listed: boolean; canFree: boolean }): string {
  return [
    'Their points go with them, and the games running now carry on without them.',
    canFree ? `${name} also leaves the guest list.` : null,
    canFree && listed ? 'Took the wrong name? Free the name instead: it stays on the list.' : null,
    'On a new phone? Move them instead: their points stay.',
  ]
    .filter((part) => part !== null)
    .join(' ')
}
