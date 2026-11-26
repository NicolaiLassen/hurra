// Who sits Lydspor out ("Doesn't play this game"): typed names, not tied to
// the guest list. The list only helps the host spell a name the way the guest
// joins with it; a guest here sits out when their name folds to one on the
// list (nameKey: case, accents and spaces never matter). Settings and saves
// from before names held guests' ids: each still reads, as its guest's name.
// Shared by the logic, the host room and the editor. Relative imports only:
// the Netlify function bundles it.
import type { PlayerId } from '../core/Game'
import { nameFromSetting, nameKey, uniqueNames } from '../core/names'

/** Someone with an id and a name: a guest on the list, or a player. */
type Named = { readonly id: string; readonly name: string }

/** The most names "Doesn't play this game" holds. */
export const MAX_SIT_OUT = 200

/**
 * A sit out list as names, each once: a saved id becomes its guest's name
 * (from the guest list or the players), and an id on neither list any more
 * is dropped. Typed names stay as typed, cleaned.
 */
export function sitOutNames(values: readonly string[], guests: readonly Named[], players: readonly Named[] = []): string[] {
  return uniqueNames(
    values.flatMap((value) => {
      const name = nameFromSetting(value, guests, players)
      return name === null ? [] : [name]
    }),
  )
}

/**
 * The players who sit out: everyone here whose name is on the list. An id
 * still on the list (a save from before names) counts for the player it is.
 */
export function sittingOut(values: readonly string[], players: readonly Named[]): Set<PlayerId> {
  const keys = new Set(sitOutNames(values, [], players).map(nameKey))
  return new Set(players.filter((p) => keys.has(nameKey(p.name))).map((p) => p.id))
}

/** Two sit out lists name the same people, whatever their order and spelling. */
export function sameNames(a: readonly string[], b: readonly string[]): boolean {
  const keys = (list: readonly string[]) => [...new Set(list.map(nameKey))].sort().join('\n')
  return keys(a) === keys(b)
}
