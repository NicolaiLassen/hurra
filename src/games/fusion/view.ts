// Helpers for Participant fusion's phone and host room: picking two guests,
// finding a guest by name, and naming one. Pure, with no React, so they are
// unit tested on their own (view.test.ts). The screens get everything else
// through their props (docs/engine-v2.md, 6), and read saved JSON through
// shapes.ts.
import type { AnswerPayload, PlayerId } from '@/games/core/Game'
import { foldName } from '@/lib/format'
import type { Player } from '@/lib/types'

/** A vote's two player ids, or null when it isn't a two-person vote. */
export function choiceOf(answer: AnswerPayload | null | undefined): [PlayerId, PlayerId] | null {
  if (!answer || !('choice' in answer) || !Array.isArray(answer.choice) || answer.choice.length !== 2) return null
  return [answer.choice[0], answer.choice[1]]
}

/** Two picks as one comparable string, whatever their order. */
export const pickSignature = (pick: readonly PlayerId[] | null | undefined) => (pick ? [...pick].sort().join('+') : '')

/**
 * Picks at most two people: tapping a picked one drops them, tapping a third
 * replaces the oldest pick, so a guest never has to unpick first.
 */
export function togglePick(pick: readonly PlayerId[], id: PlayerId): PlayerId[] {
  if (pick.includes(id)) return pick.filter((p) => p !== id)
  return [...pick, id].slice(-2)
}

/**
 * The players a guest can vote for: everyone but themselves, filtered by a search like an autocomplete.
 * Names that start with the search come first, then names with a later word that does ("bj" finds
 * Christoffer Bjørnskov), then names that only contain it; each group by name.
 */
export function candidatesFor(players: readonly Player[], meId: PlayerId, query: string): Player[] {
  const needle = foldName(query)
  return players
    .filter((p) => p.id !== meId)
    .map((p) => ({ p, rank: needle === '' ? 0 : matchRank(foldName(p.name), needle) }))
    .filter((c) => c.rank < NO_MATCH)
    .sort((a, b) => a.rank - b.rank || a.p.name.localeCompare(b.p.name))
    .map((c) => c.p)
}

const NO_MATCH = 3

/**
 * What the phone's picker calls each guest: their first name, so a tile and
 * a line stay short ("Mads and Ida"), or their whole name where another guest
 * shares that first name (Anna Holm and Anna Berg).
 */
export function shortNames(players: readonly Pick<Player, 'id' | 'name'>[]): Map<PlayerId, string> {
  const first = (name: string) => name.trim().split(/\s+/)[0] ?? name
  const counts = new Map<string, number>()
  for (const p of players) counts.set(foldName(first(p.name)), (counts.get(foldName(first(p.name))) ?? 0) + 1)
  return new Map(players.map((p) => [p.id, (counts.get(foldName(first(p.name))) ?? 0) > 1 ? p.name.trim() : first(p.name)]))
}

/** 0 when the name starts with the search, 1 when a later word does, 2 when it only contains it. */
function matchRank(name: string, needle: string): number {
  if (name.startsWith(needle)) return 0
  if (name.split(/\s+/).some((word) => word.startsWith(needle))) return 1
  return name.includes(needle) ? 2 : NO_MATCH
}

/** A player's name now, else the one the reveal kept, else a placeholder. */
export function nameOf(players: readonly Player[], id: PlayerId, kept?: string): string {
  return players.find((p) => p.id === id)?.name ?? kept ?? 'A guest'
}
