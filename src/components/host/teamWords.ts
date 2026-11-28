// The host room's words for teams (docs/user-flows.md, "Teams"): what making
// teams gives, why it can't be done right now, the Make teams again note, the
// Move to team choices and the Play in teams line. Pure, so the unit tests pin
// them. The core never names a game: a game is only its title here.
import { liveTeamGame, MAX_TEAMS, MIN_TEAMS, teamList } from '@/lib/teams'
import type { SessionGame, Team } from '@/lib/types'

/** The counts the host picks from: 2 to 6. */
export const TEAM_COUNTS: readonly number[] = Array.from({ length: MAX_TEAMS - MIN_TEAMS + 1 }, (_, i) => MIN_TEAMS + i)

const guestsWord = (n: number) => `${n} ${n === 1 ? 'guest' : 'guests'}`

/**
 * What making `count` teams gives for the guests here now, as the server deals
 * them (sizes differ by one at most): "22 guests here: 4 teams of 5 or 6".
 * With fewer guests than teams, some start empty: "3 guests here: 4 teams, 3
 * of 1 and 1 empty for now".
 */
export function splitLine(guests: number, count: number): string {
  const here = `${guestsWord(guests)} here`
  if (guests <= 0) return `Nobody here yet: ${count} empty teams for now`
  const small = Math.floor(guests / count)
  const big = Math.ceil(guests / count)
  if (small === 0) return `${here}: ${count} teams, ${guests} of 1 and ${count - guests} empty for now`
  if (small === big) return `${here}: ${count} teams of ${small}`
  return `${here}: ${count} teams of ${small} or ${big}`
}

/** The first live game played in teams, or null (src/lib/teams.ts: the phones use it too). */
export { liveTeamGame }

/**
 * Why Make teams (or Make teams again) can't be pressed now, or null when it
 * can: only while a game played in teams is live. Teams may be made before
 * anyone is here, or with fewer guests than teams: they start empty, and
 * guests pick one on their phone or go into the smallest as they join.
 */
export function makeBlock(games: readonly SessionGame[], teamsExist: boolean): string | null {
  const live = liveTeamGame(games)
  if (live) return teamsExist ? `End ${live.title} to make new teams or clear them.` : `End ${live.title} before you make teams.`
  return null
}

/** Why Clear teams can't be pressed now (a game played in teams is live), or null when it can. */
export function clearBlock(games: readonly SessionGame[]): string | null {
  const live = liveTeamGame(games)
  return live ? `End ${live.title} to make new teams or clear them.` : null
}

/**
 * Make teams again's note: everyone is shuffled again; teams past the new
 * count go, the rest keep their names and colours, and missing ones are new.
 */
export function remakeNote(teams: readonly Pick<Team, 'name'>[], count: number): string {
  const shuffled = 'Everyone here is shuffled into new teams, so most guests change team.'
  if (count < teams.length) {
    const gone = teams.slice(count).map((t) => t.name)
    return `${shuffled} ${teamList(gone)} ${gone.length === 1 ? 'goes' : 'go'}. The others keep their names and colours.`
  }
  if (count > teams.length) {
    const added = count - teams.length
    return `${shuffled} The teams keep their names and colours, and ${added === 1 ? 'a new team joins' : `${added} new teams join`}.`
  }
  return `${shuffled} The teams keep their names and colours.`
}

/** A team's size in words: "Nobody yet", "1 guest", "5 guests". */
export function memberCount(n: number): string {
  return n === 0 ? 'Nobody yet' : guestsWord(n)
}

/** Move to team's value for no team (team ids are uuids, so it never meets one). */
export const NO_TEAM = 'none'

export type MoveChoice = {
  /** A team's id, or NO_TEAM. */
  value: string
  team: Team | null
  label: string
  /** The line under it: how many are in it, and whether the guest is in it now. */
  detail: string
  current: boolean
}

/**
 * Move to team's choices: each team in order, with how many are in it, then
 * No team. The guest's own team (or No team) is marked "In it now".
 */
export function moveChoices(teams: readonly Team[], sizes: ReadonlyMap<string, number>, currentTeamId: string | null): MoveChoice[] {
  const now = (current: boolean, rest: string) => (current ? `In it now. ${rest}` : rest)
  const current = currentTeamId !== null && teams.some((t) => t.id === currentTeamId) ? currentTeamId : null
  return [
    ...teams.map((team) => ({
      value: team.id,
      team,
      label: team.name,
      detail: now(team.id === current, `${memberCount(sizes.get(team.id) ?? 0)}.`),
      current: team.id === current,
    })),
    { value: NO_TEAM, team: null, label: 'No team', detail: now(current === null, 'Answers alone.'), current: current === null },
  ]
}

/** The team id a Move to team value stands for: null for No team. */
export const teamIdOf = (value: string): string | null => (value === NO_TEAM ? null : value)

/**
 * The line under Play in teams on a game's settings: what the switch does as
 * it stands. Live, it is read only and says how this round is played. Without
 * teams, a game set to play in teams plays alone until the host makes some.
 */
export function teamPlayLine({ on, live, teams }: { on: boolean; live: boolean; teams: number }): string {
  if (live) return `${on && teams > 0 ? 'Played in teams' : 'Played alone'} while it is live. You can change it once it ends.`
  if (on) {
    return teams > 0
      ? `In ${teams} teams: one answer from any member counts for the whole team.`
      : 'No teams yet. Make teams in Guests first: until then it is played alone.'
  }
  return teams > 0 ? 'Each guest answers for themselves.' : 'Each guest answers for themselves. To play in teams, make teams in Guests first.'
}
