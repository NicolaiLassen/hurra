import type { EliminationPublicState, PublicKnockout } from '@/games/elimination/logic'
import type { Player } from '@/lib/types'

/**
 * This round's players who are still in the party: those still standing (in
 * deal order), then those who are out. Every screen counts "17 of 45 still
 * standing" from it, so the phone, the TV and its status card always agree,
 * even in the moment between a removal and the game's next save.
 */
export function roundRoster(players: readonly Player[], publicState: EliminationPublicState) {
  const byId = new Map(players.map((p) => [p.id, p]))
  const pick = (ids: readonly string[]) => ids.flatMap((id) => byId.get(id) ?? [])
  const standing = pick(publicState.alive)
  const out = pick(publicState.out)
  return { standing, out, total: standing.length + out.length }
}

/** A player's name, or "Someone" for a player who has left the party. */
export function nameFrom(players: readonly Player[]) {
  return (id: string) => players.find((p) => p.id === id)?.name ?? 'Someone'
}

/** A knockout in words, for the TV board and its rail card: "Bo got Ana" or "Bo caught Ana". */
export function knockoutLine(k: PublicKnockout, nameOf: (id: string) => string): string {
  return k.method === 'catch' ? `${nameOf(k.by)} caught ${nameOf(k.target)}` : `${nameOf(k.by)} got ${nameOf(k.target)}`
}

/**
 * The top hunters still in the party: most knockouts first (ties in the stored
 * order, the same on every screen).
 */
export function topHunters(
  publicState: EliminationPublicState,
  players: readonly Player[],
  limit = 5,
): [string, number][] {
  const present = new Set(players.map((p) => p.id))
  return Object.entries(publicState.knockoutCounts)
    .filter(([id]) => present.has(id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
}

/** "just now", "1 min ago", "12 min ago", "2 h ago". */
export function timeAgo(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  return `${Math.floor(minutes / 60)} h ago`
}
