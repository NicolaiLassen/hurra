// Names as people type them, for games whose settings name guests by name
// rather than by id (Participant fusion's pictures, Lydspor's "Doesn't play
// this game"): the guest list helps the host spell a name the way the guest
// will join with it, but a setting is plain text, never tied to a guest's row.
// A name matches a guest when the two fold to the same key.
//
// Plain functions with no imports: bundled into the Netlify function with the
// games' logic, so relative imports only.

/**
 * A name folded for matching: capitals, accents, Nordic letters (ø as o, æ as
 * ae, å as a), compatibility forms (a full-width Ｌｕｋａ) and every space never
 * matter, so "Ana Maria", " ana  maria " and "AnaMaría" are one name.
 */
export function nameKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, '')
}

/** Whether two names are the same person's by nameKey; an empty name matches nothing. */
export function sameName(a: string, b: string): boolean {
  const key = nameKey(a)
  return key !== '' && key === nameKey(b)
}

/** A typed name as it is kept: trimmed, every run of spaces one space. */
export function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

/** The longest name a game setting keeps, in code points: the guest list's own limit. */
export const MAX_NAME_LENGTH = 40

/** A guest's id as the database makes them (a UUID), so a setting saved with ids can be told from one with names. */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Whether a saved value looks like a guest's id rather than a typed name. */
export const looksLikeId = (value: string) => ID.test(value)

/** Someone with an id and a name: a guest on the list or a player. */
type Named = { readonly id: string; readonly name: string }

/**
 * A setting's value as a name: a guest's id saved before settings took names
 * becomes that guest's name, from the guest list or the players; a typed name
 * stays as it is (cleaned). Null for an id that is on neither list any more.
 */
export function nameFromSetting(value: string, guests: readonly Named[], players: readonly Named[] = []): string | null {
  const known = guests.find((g) => g.id === value) ?? players.find((p) => p.id === value)
  if (known) return cleanName(known.name)
  if (looksLikeId(value)) return null
  return cleanName(value)
}

/**
 * Each name once, in their order, by nameKey: the first spelling
 * of each wins, so a list built from the players first keeps how each guest
 * typed their own name. Empty names are dropped.
 */
export function uniqueNames(names: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const name of names) {
    const clean = cleanName(name)
    const key = nameKey(clean)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    out.push(clean)
  }
  return out
}
