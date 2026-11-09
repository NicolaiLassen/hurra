// The phone's words, as pure functions (docs/engine-v2.md, 7.1): who won a
// game, how long ago, and the codes guests type. Unit-tested in text.test.ts.
import { listNames } from '@/lib/recap'
import type { Player, SessionGame } from '@/lib/types'

type Named = Pick<Player, 'id' | 'name'>

/** A player's name by id; "A guest" for someone who has left the party. */
export function nameIn(players: readonly Named[], id: string): string {
  return players.find((p) => p.id === id)?.name ?? 'A guest'
}

/**
 * Who won, as the start of a sentence: "Mads", "Ana and Bo", or "You" and
 * "You and Ana" when this phone's player is one of them. Null without winners.
 */
export function winnersText(winners: readonly string[], players: readonly Named[], meId: string): string | null {
  if (winners.length === 0) return null
  const others = winners.filter((id) => id !== meId).map((id) => nameIn(players, id))
  return listNames(winners.includes(meId) ? ['You', ...others] : others)
}

/** A finished game in one line: "Mads won Quiz", "You won Quiz", or "Quiz is over" when nobody won. */
export function finishedLine(game: Pick<SessionGame, 'title' | 'winners'>, players: readonly Named[], meId: string): string {
  const who = winnersText(game.winners, players, meId)
  return who ? `${who} won ${game.title}` : `${game.title} is over`
}

/** "just now", "1 min ago", "12 min ago", "2 h ago". */
export function timeAgo(ms: number): string {
  if (ms < 60_000) return 'just now'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes} min ago`
  return `${Math.floor(minutes / 60)} h ago`
}

/** "1 point", "3 points", "-2 points". */
export const pointsText = (points: number) => `${points} point${points === 1 || points === -1 ? '' : 's'}`

/** How long the host's codes for moving a player are: 6 characters. */
export const CLAIM_CODE_LENGTH = 6

/** What a guest types for a host's code, cleaned: capitals and digits only, at most 6. */
export function cleanClaimCode(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CLAIM_CODE_LENGTH)
}

/**
 * Whether a party code that found no party could be a host's code instead:
 * 6 characters from the codes' alphabet (no I, O, 0 or 1). Guests told to
 * "type this code" sometimes type it where the party code goes.
 */
export const couldBeClaimCode = (code: string) => /^[A-HJ-NP-Z2-9]{6}$/.test(code)
