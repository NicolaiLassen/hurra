// Who is in a picture, as the host types it (docs/engine-v2.md, 8.4): two
// plain names, not tied to the guest list. The list and the guests who joined
// only suggest the spelling, and say where a typed name stands. Pure, so the
// settings editor and Show who share it, and people.test.ts reads it.
import type { GameGuest } from '@/games/core/Game'
import { nameFromSetting, nameKey, uniqueNames } from '@/games/core/names'
import { sortNames } from '@/lib/guestList'
import type { Player } from '@/lib/types'

/**
 * The names to suggest for a person in a picture, so the spelling matches the
 * way the guest joins: everyone who has joined (as they typed it), then the
 * rest of the guest list, each once, A to Z the Danish way.
 */
export function suggestedNames(guests: readonly Pick<GameGuest, 'name'>[], players: readonly Pick<Player, 'name'>[]): string[] {
  return sortNames(uniqueNames([...players.map((p) => p.name), ...guests.map((g) => g.name)]))
}

/** Where a typed name stands: a guest here, one on the guest list who hasn't joined, nobody on either, or nothing typed. */
export type NameStatus = 'here' | 'expected' | 'unknown' | 'empty'

/** Where a typed name stands, by nameKey (case, accents and spaces never matter). */
export function nameStatus(name: string, guests: readonly Pick<GameGuest, 'name' | 'joined'>[], players: readonly Pick<Player, 'name'>[]): NameStatus {
  const key = nameKey(name)
  if (key === '') return 'empty'
  if (players.some((p) => nameKey(p.name) === key) || guests.some((g) => g.joined && nameKey(g.name) === key)) return 'here'
  if (guests.some((g) => nameKey(g.name) === key)) return 'expected'
  return 'unknown'
}

/**
 * A picture's two people as the editor and Show who show them: typed names,
 * with a guest's id from settings saved before names turned into that guest's
 * name (or "A guest who left" for one on no list any more).
 */
export function peopleNames(
  people: readonly string[] | undefined,
  guests: readonly Pick<GameGuest, 'id' | 'name'>[],
  players: readonly Pick<Player, 'id' | 'name'>[],
): [string, string] {
  const named = (value: string | undefined) => (value === undefined || value === '' ? '' : (nameFromSetting(value, guests, players) ?? 'A guest who left'))
  return [named(people?.[0]), named(people?.[1])]
}
