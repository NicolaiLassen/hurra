// Helpers for Participant fusion's phone and host room: the names a guess
// offers, picking two of them, finding one by a search, and the guest a name
// belongs to. Pure, with no React, so they are unit tested on their own
// (view.test.ts). A guess is two names, never ids (docs/engine-v2.md, 8.4):
// the screens get everything else through their props and read saved JSON
// through shapes.ts.
import type { AnswerPayload, PromptSpec } from '@/games/core/Game'
import { nameKey, sameName, uniqueNames } from '@/games/core/names'
import { foldName } from '@/lib/format'
import { sortNames } from '@/lib/guestList'
import type { Player, SessionGame } from '@/lib/types'

/** A vote's two names, or null when it isn't a two-name vote. */
export function choiceOf(answer: AnswerPayload | null | undefined): [string, string] | null {
  if (!answer || !('choice' in answer) || !Array.isArray(answer.choice) || answer.choice.length !== 2) return null
  return [answer.choice[0], answer.choice[1]]
}

/** Two picks as one comparable string, whatever their order and spelling. */
export const pickSignature = (pick: readonly string[] | null | undefined) => (pick ? pick.map(nameKey).sort().join('+') : '')

/**
 * Picks at most two names: tapping a picked one drops it, tapping a third
 * replaces the oldest pick, so a guest never has to unpick first.
 */
export function togglePick(pick: readonly string[], name: string): string[] {
  if (pick.some((p) => sameName(p, name))) return pick.filter((p) => !sameName(p, name))
  return [...pick, name].slice(-2)
}

/**
 * The name this guest's guesses leave out, and that never counts for them:
 * their own. Null in teams: every member has the team's guess, a teammate may
 * have named them, and it counts for them as for the rest (logic.ts,
 * scoreVotes).
 */
export const ownName = (game: Pick<SessionGame, 'team_play'>, player: Pick<Player, 'name'>): string | null =>
  game.team_play === true ? null : player.name

/**
 * The names this guest can pick for the picture asked: the ones its guess
 * offers (everyone who has joined and every name in the pictures, each once),
 * else, for a prompt from before names, the guests here; never `own`, their
 * own name outside teams (ownName); A to Z, the Danish way.
 */
export function guessOptions(spec: PromptSpec | null | undefined, players: readonly Pick<Player, 'name'>[], own: string | null): string[] {
  const offered = spec && spec.kind === 'choice' && Array.isArray(spec.options) ? spec.options : players.map((p) => p.name)
  return sortNames(uniqueNames(offered).filter((name) => own === null || !sameName(name, own)))
}

/**
 * The names matching a search, like an autocomplete: names that start with
 * it come first, then names with a later word that does ("bj" finds
 * Christoffer Bjørnskov), then names that only contain it; each group in the
 * order given. All of them for an empty search.
 */
export function namesFor(names: readonly string[], query: string): string[] {
  const needle = foldName(query)
  if (needle === '') return [...names]
  return names
    .map((name, order) => ({ name, order, rank: matchRank(foldName(name), needle) }))
    .filter((c) => c.rank < NO_MATCH)
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map((c) => c.name)
}

const NO_MATCH = 3

/** 0 when the name starts with the search, 1 when a later word does, 2 when it only contains it. */
function matchRank(name: string, needle: string): number {
  if (name.startsWith(needle)) return 0
  if (name.split(/\s+/).some((word) => word.startsWith(needle))) return 1
  return name.includes(needle) ? 2 : NO_MATCH
}

/**
 * What the phone calls each name: its first name, so a tile and a line stay
 * short ("Mads and Ida"), or the whole name where another name shares that
 * first name (Anna Holm and Anna Berg). Keyed by nameKey.
 */
export function shortNames(names: readonly string[]): Map<string, string> {
  const first = (name: string) => name.trim().split(/\s+/)[0] ?? name
  const counts = new Map<string, number>()
  for (const name of names) counts.set(foldName(first(name)), (counts.get(foldName(first(name))) ?? 0) + 1)
  return new Map(names.map((name) => [nameKey(name), (counts.get(foldName(first(name))) ?? 0) > 1 ? name.trim() : first(name)]))
}

/** The short name of `name` from shortNames, else its first name. */
export function shortName(short: ReadonlyMap<string, string>, name: string): string {
  return short.get(nameKey(name)) ?? (name.trim().split(/\s+/)[0] || name)
}

/** The guest here whose name a name is (by nameKey), for their profile photo and token; undefined for a name nobody joined with. */
export function playerNamed<T extends Pick<Player, 'id' | 'name'>>(players: readonly T[], name: string): T | undefined {
  return players.find((p) => sameName(p.name, name))
}

/** A player's name now, else a placeholder. */
export function nameOf(players: readonly Pick<Player, 'id' | 'name'>[], id: string): string {
  return players.find((p) => p.id === id)?.name ?? 'A guest'
}
