// The phone's words, as pure functions (docs/engine-v2.md, 7.1): who won a
// game, where you stand, clock times, and the codes guests type. Unit-tested
// in text.test.ts.
import { listNames } from '@/lib/recap'
import type { Player, ScoreRow, SessionGame } from '@/lib/types'

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

const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

/**
 * "22:41": a time the database holds (a start, a finish, a knockout), on this
 * phone's clock. Phones never say "4 min ago", and never a planned time.
 */
export const clockTime = (ms: number) => clock.format(ms)

/** "Finished at 22:41", or null for a game the database has no finish for. */
export const finishedAt = (game: Pick<SessionGame, 'finished_at'>) =>
  game.finished_at === null ? null : `Finished at ${clockTime(game.finished_at)}`

/** "Since 20:30", or null for a game that hasn't started. */
export const runningSince = (game: Pick<SessionGame, 'started_at'>) =>
  game.started_at === null ? null : `Since ${clockTime(game.started_at)}`

/** "1 point", "3 points", "-2 points". */
export const pointsText = (points: number) => `${points} point${points === 1 || points === -1 ? '' : 's'}`

/** "1st", "2nd", "3rd", "4th", "11th", "22nd". */
export function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

/** Where this phone's guest stands tonight. `rank` is null while nobody has scored. */
export type Place = { rank: number | null; points: number; line: string }

/**
 * Where this phone's guest stands tonight, from the standings: their place,
 * their points and who is next to them, ties said in words. "1 behind Felix
 * and Luna", "Level with Ana, 1 behind Mads", "Level with Bo at the top", "2
 * ahead of Freja". Null when the standings don't hold them.
 */
export function placeOf(rows: readonly Pick<ScoreRow, 'player_id' | 'name' | 'points'>[], meId: string): Place | null {
  const me = rows.find((row) => row.player_id === meId)
  if (!me) return null
  const points = me.points
  const others = rows.filter((row) => row.player_id !== meId)
  if (others.length === 0) return { rank: points > 0 ? 1 : null, points, line: 'Nobody else here yet' }
  if (points <= 0 && others.every((row) => row.points <= 0)) return { rank: null, points, line: 'Nobody has scored yet' }

  const namesAt = (value: number) => listNames(others.filter((row) => row.points === value).map((row) => row.name))
  const above = others.filter((row) => row.points > points)
  const level = others.some((row) => row.points === points) ? `Level with ${namesAt(points)}` : null
  if (above.length > 0) {
    const next = Math.min(...above.map((row) => row.points))
    const behind = `${next - points} behind ${namesAt(next)}`
    return { rank: above.length + 1, points, line: level ? `${level}, ${behind}` : behind }
  }
  if (level) return { rank: 1, points, line: `${level} at the top` }
  const below = Math.max(...others.map((row) => row.points))
  return { rank: 1, points, line: `${points - below} ahead of ${namesAt(below)}` }
}

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
