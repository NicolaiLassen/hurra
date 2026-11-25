// Helpers for Participant fusion's screens: no React, so they are unit tested
// on their own (view.test.ts). All are pure except firstTime, which remembers
// keys in sessionStorage. The screens get everything else through their props
// (docs/engine-v2.md, 6).
import type { AnswerPayload, PlayerId } from '@/games/core/Game'
import { pointsFor, type FusionPhase, type FusionPublicPicture, type FusionPublicState } from '@/games/fusion/logic'
import { foldName } from '@/lib/format'
import type { Player, PromptState } from '@/lib/types'

type Scoring = FusionPublicState['scoring']

/** The points a revealed picture gave a voter who got `hits` right (0 without a counted vote). */
export function revealPoints(hits: number | undefined, scoring: Scoring): number {
  if (hits === undefined) return 0
  return scoring ? pointsFor(hits, scoring) : hits
}

/** What a revealed picture meant for this player, in one line. */
export function outcomeOf(
  picture: FusionPublicPicture,
  meId: PlayerId,
  hits: number | undefined,
  scoring: Scoring,
): string {
  if (picture.revealed?.people.includes(meId)) return "That's you! No points on your own picture."
  if (hits === undefined) return "You didn't vote on this one"
  const points = revealPoints(hits, scoring)
  const gain = points > 0 ? ` (+${points})` : ''
  return hits >= 2 ? `You got both${gain}` : `You got ${hits} of 2${gain}`
}

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

/** Whether a picture still takes votes: voting is on, its prompt is open, and it isn't revealed. */
export function takesVotes(phase: FusionPhase, picture: FusionPublicPicture, prompts: readonly PromptState[]): boolean {
  if (phase !== 'voting' || picture.revealed) return false
  const prompt = prompts.find((p) => p.key === picture.key)
  return !prompt || (prompt.closed_at === null && prompt.revealed_at === null)
}

/** A player's name now, else the one the reveal kept, else a placeholder. */
export function nameOf(players: readonly Player[], id: PlayerId, kept?: string): string {
  return players.find((p) => p.id === id)?.name ?? kept ?? 'A guest'
}

type Revealed = NonNullable<FusionPublicPicture['revealed']>

/** "14 of 38 got both, 9 got one" (short: without the second part), or "Nobody voted on it". */
export function countsLine(revealed: Revealed, short = false): string {
  if (revealed.voters === 0) return 'Nobody voted on it'
  const both = `${revealed.both} of ${revealed.voters} got both`
  return short || revealed.one === 0 ? both : `${both}, ${revealed.one} got one`
}

/** The revealed picture the fewest voters saw through, when under half of them got both (the recap's rule). */
export function bestDisguise(pictures: readonly FusionPublicPicture[]): (FusionPublicPicture & { revealed: Revealed }) | null {
  let best: (FusionPublicPicture & { revealed: Revealed }) | null = null
  for (const picture of pictures) {
    const r = picture.revealed
    if (!r || r.voters === 0) continue
    if (!best || r.both / r.voters < best.revealed.both / best.revealed.voters) best = { ...picture, revealed: r }
  }
  return best && best.revealed.both / best.revealed.voters < 0.5 ? best : null
}

/** The sum of this game's answer counts: every vote cast so far on pictures not yet revealed. */
export const totalVotes = (tallies: Readonly<Record<string, number>>) =>
  Object.values(tallies).reduce((sum, count) => sum + (Number.isFinite(count) ? count : 0), 0)

/**
 * The public state as screens should treat it: null until the game has one
 * (a pending game), and sample data with parts left out (fixtures) filled in.
 */
export function publicOf(value: unknown): FusionPublicState | null {
  const state = value as Partial<FusionPublicState> | null | undefined
  if (!state || typeof state !== 'object' || !Array.isArray(state.pictures)) return null
  return {
    ...state,
    phase: state.phase ?? 'voting',
    pictures: state.pictures,
    top: Array.isArray(state.top) ? state.top : [],
    lastReveal: state.lastReveal ?? null,
  }
}

/**
 * Lays out `count` tiles of the given aspect ratio (width / height) in an
 * area: the column count that gives the biggest tiles. Every tile fits.
 */
export function fitTiles(
  count: number,
  width: number,
  height: number,
  { aspect = 0.8, gap = 16 }: { aspect?: number; gap?: number } = {},
): { columns: number; rows: number; tileWidth: number; tileHeight: number } {
  let best = { columns: 1, rows: Math.max(1, count), tileWidth: 0, tileHeight: 0 }
  if (count <= 0 || width <= 0 || height <= 0) return best
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns)
    const cellWidth = (width - (columns - 1) * gap) / columns
    const cellHeight = (height - (rows - 1) * gap) / rows
    if (cellWidth <= 0 || cellHeight <= 0) continue
    // The tile keeps its aspect ratio inside its cell.
    const tileWidth = Math.min(cellWidth, cellHeight * aspect)
    if (tileWidth > best.tileWidth) best = { columns, rows, tileWidth, tileHeight: tileWidth / aspect }
  }
  return best
}

/**
 * True the first time this tab sees `key`, so a moment's sound plays once even
 * when the sheet reopens or the page reloads (docs/engine-v2.md, 3.5). When
 * storage is unavailable it says true: a repeated sound beats a missing one.
 */
export function firstTime(key: string): boolean {
  try {
    const stored = `hurra:once:${key}`
    if (sessionStorage.getItem(stored)) return false
    sessionStorage.setItem(stored, '1')
    return true
  } catch {
    return true
  }
}
