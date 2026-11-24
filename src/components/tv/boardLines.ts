// What the TV board says beside its numbers (docs/identity.md, The standings):
// the leader's facts and the line about the last game, from data the snapshot
// holds. Only times the database holds, as clock times; never "4 min ago".
import { clockTime } from '@/components/tv/clock'
import { listNames } from '@/lib/recap'
import type { SessionGame } from '@/lib/types'

/** A line whose names stand out: plain words, and names to set in bold. */
export type Said = readonly (string | { name: string })[]

type Row = { player_id: string; name: string; points: number }

/**
 * "Won Beer pong at 21:40", or "won Beer pong at 21:40" after the name: the
 * newest game this guest won, at its finish time. Null when they won none.
 */
export function wonLine(playerId: string, games: readonly SessionGame[], afterName = false): string | null {
  const won = games
    .filter((g) => g.status === 'finished' && g.archived_at === null && g.finished_at !== null && g.winners.includes(playerId))
    .sort((a, b) => (b.finished_at ?? 0) - (a.finished_at ?? 0))[0]
  return won?.finished_at ? `${afterName ? 'won' : 'Won'} ${won.title} at ${clockTime(won.finished_at)}` : null
}

/**
 * The leader against the next place: "2 ahead of Ana", or "Level with Luna"
 * when others share first, or "Nobody has scored yet" before anyone has.
 * Null for a party of one.
 */
export function aheadLine(rows: readonly Row[]): string | null {
  const [leader, ...rest] = rows
  if (!leader || rest.length === 0) return null
  if (rows.every((row) => row.points === 0)) return 'Nobody has scored yet'
  const level = rest.filter((row) => row.points === leader.points)
  if (level.length > 0) return `Level with ${listNames(level.map((row) => row.name))}`
  const next = rest.filter((row) => row.points === rest[0].points)
  return `${leader.points - rest[0].points} ahead of ${listNames(next.map((row) => row.name))}`
}

const places = (n: number) => `${n} place${n === 1 ? '' : 's'}`
const points = (n: number) => `${n} point${n === 1 ? '' : 's'}`

/**
 * The line about the last game, from its points: "Beer pong moved Luna up 4
 * places and Clara up 3." for the two who climbed most (ties by place now),
 * or, when nobody changed place, "Beer pong gave Freja 7 points." Null when
 * the game gave nobody points.
 */
export function commentary(
  game: Pick<SessionGame, 'title'>,
  moved: Readonly<Record<string, number>>,
  gamePoints: Readonly<Record<string, number>>,
  rows: readonly Row[],
): Said | null {
  const up = rows
    .map((row, place) => ({ row, place, by: moved[row.player_id] ?? 0 }))
    .filter((m) => m.by > 0)
    .sort((a, b) => b.by - a.by || a.place - b.place)
    .slice(0, 2)
  if (up.length > 0) {
    const [first, second] = up
    return [
      `${game.title} moved `,
      { name: first.row.name },
      ` up ${places(first.by)}`,
      ...(second ? [' and ', { name: second.row.name }, ` up ${second.by}`] : []),
      '.',
    ]
  }
  const best = Math.max(0, ...rows.map((row) => gamePoints[row.player_id] ?? 0))
  if (best <= 0) return null
  const top = rows.filter((row) => (gamePoints[row.player_id] ?? 0) === best)
  const names = top.slice(0, 3).flatMap((row, i, list) => [...(i === 0 ? [] : [i === list.length - 1 ? ' and ' : ', ']), { name: row.name }])
  return [`${game.title} gave `, ...names, ` ${points(best)}${top.length > 1 ? ' each' : ''}.`]
}

/** A Said as plain text, for tests and screen readers. */
export const saidText = (said: Said) => said.map((part) => (typeof part === 'string' ? part : part.name)).join('')
