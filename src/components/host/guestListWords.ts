// The host room's words for the guest list (docs/guest-list.md, 7): the card's
// line, what Add guests did, and the Free the name confirm. Pure, so the unit
// tests pin them.
import { foldName } from '@/lib/format'
import type { AddedGuests } from '@/lib/queries'

/** The Guest list card's line under its title, from listCounts. */
export function guestListLine({ here, expected, total }: { here: number; expected: number; total: number }): string {
  if (total === 0) {
    return (
      'Add the guests you invited. When they join, they tap their name instead of typing it, ' +
      "and you can name them in a game's settings before they arrive."
    )
  }
  if (expected === 0) return 'Everyone on the list is here.'
  return `${here} of ${total} here. ${expected} still expected.`
}

/** A few names in a line: "Ana, Bo and Mads", or "Ana, Bo, Mads, Ida, Emil and 7 more". */
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
  /** Names over 40 characters, as given: the dialog stays open with only these in the field. */
  tooLong: string[]
}

/**
 * `listed` is every name on the list before this Add: a name left out reads
 * as the list has it ("Bo" for a pasted "bo"), the same for a name repeated
 * in the paste, which is on the list now too.
 */
export function addSummary({ added, skipped }: AddedGuests, listed: readonly string[] = []): AddSummary {
  const known = [...added.map((g) => g.name), ...listed]
  const asListed = (name: string) => known.find((k) => foldName(k) === foldName(name)) ?? name.trim()
  const already = [...new Set(skipped.filter((s) => s.reason !== 'too_long').map((s) => asListed(s.name)))]
  const tooLong = skipped.filter((s) => s.reason === 'too_long').map((s) => s.name)
  if (added.length > 0) {
    const parts = [
      already.length > 0 ? `Already on the list: ${someNames(already)}.` : null,
      tooLong.length > 0 ? `Over 40 characters: ${count(tooLong.length, 'name', 'names')}.` : null,
    ].filter((part) => part !== null)
    return {
      title: added.length === 1 ? `Added ${added[0].name}` : `Added ${added.length} guests`,
      description: parts.length > 0 ? parts.join(' ') : undefined,
      added: true,
      tooLong,
    }
  }
  if (already.length > 0 && tooLong.length === 0) return { title: 'Everyone you added is already on the list', added: false, tooLong }
  if (already.length > 0) return { title: `Already on the list: ${someNames(already)}`, added: false, tooLong }
  return { title: null, added: false, tooLong }
}

/** The Free the name confirm's words, built from what applies. */
export function freeNameDescription({ name, points, joiningOpen }: { name: string; points: number; joiningOpen: boolean }): string {
  return [
    `${name} goes back on the guest list as still expected, and the phone that has the name asks Who are you? again.`,
    points !== 0 ? `The ${count(points, 'point', 'points')} it earned as ${name} ${Math.abs(points) === 1 ? 'goes' : 'go'} with it.` : null,
    joiningOpen ? null : 'Joining is closed: open it so they can pick their name.',
  ]
    .filter((part) => part !== null)
    .join(' ')
}
