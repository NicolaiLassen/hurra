// Teams (docs/user-flows.md, "Teams"): pure helpers over a snapshot, shared
// by the host page, the phones and the TV so they always agree. A team is the
// party's, follows its guests all night, and plays a game together when the
// game is played in teams (session_games.team_play): then one answer from any
// member counts for the whole team (submit_answer writes it for each of them).
// Games never see teams: each member simply has the answer.
//
// Relative imports only, and no DOM, as stage.ts.
import type { Player, PromptState, SessionGame, Snapshot, Team, TeamColour } from './types'

/** How many teams the host may make, and the default (about 22 guests make 4 teams of 5 or 6). */
export const MIN_TEAMS = 2
export const MAX_TEAMS = 6
export const DEFAULT_TEAMS = 4

/** The palette in the order new teams take it: the confetti's four, then the guest tokens' sky and lime. */
export const TEAM_COLOURS: readonly TeamColour[] = ['gold', 'pink', 'teal', 'violet', 'sky', 'lime']

/** A team colour's fill and its text, as whole class names so Tailwind finds them. Text on a fill is ink (docs/identity.md). */
export const TEAM_FILL: Readonly<Record<TeamColour, string>> = {
  gold: 'bg-gold',
  pink: 'bg-pink',
  teal: 'bg-guest-teal',
  violet: 'bg-guest-violet',
  sky: 'bg-guest-sky',
  lime: 'bg-guest-lime',
}
export const TEAM_TEXT: Readonly<Record<TeamColour, string>> = {
  gold: 'text-gold',
  pink: 'text-pink',
  teal: 'text-guest-teal',
  violet: 'text-guest-violet',
  sky: 'text-guest-sky',
  lime: 'text-guest-lime',
}

/** A colour from the database, or gold for one this app doesn't know (a newer palette). */
export const teamColour = (colour: string): TeamColour => (TEAM_COLOURS.includes(colour as TeamColour) ? (colour as TeamColour) : 'gold')

/** The party's teams, in position order; none for a party without teams or a database from before them. */
export function teamsOf(s: Pick<Snapshot, 'teams'>): Team[] {
  return Array.isArray(s.teams) ? s.teams : []
}

/** A player's team, or null when they are in none (or the team is gone). */
export function teamOf(s: Pick<Snapshot, 'teams' | 'players'>, playerId: string): Team | null {
  const teamId = s.players.find((p) => p.id === playerId)?.team_id
  if (!teamId) return null
  return teamsOf(s).find((t) => t.id === teamId) ?? null
}

/** The guests here in a team, in join order (the snapshot's order). */
export function membersOf(s: Pick<Snapshot, 'players'>, teamId: string): Player[] {
  return s.players.filter((p) => p.team_id === teamId)
}

/** The guests here in no team. */
export function teamless(s: Pick<Snapshot, 'players' | 'teams'>): Player[] {
  const ids = new Set(teamsOf(s).map((t) => t.id))
  return s.players.filter((p) => !p.team_id || !ids.has(p.team_id))
}

/** Whether a game is played in teams (its switch is on). It only changes anything once the party has teams. */
export const teamPlayOn = (game: Pick<SessionGame, 'team_play'>): boolean => game.team_play === true

/** Whether this game is played in teams right now: its switch is on and the party has teams. */
export const playedInTeams = (s: Pick<Snapshot, 'teams'>, game: Pick<SessionGame, 'team_play'>): boolean =>
  teamPlayOn(game) && teamsOf(s).length > 0

/**
 * Each team's points in a game, in team order: the most any member has
 * there. Members answer together, so each has the team's points; one who
 * joined the team late may have fewer. Teams with nobody here are left out.
 */
export function teamPoints(
  s: Pick<Snapshot, 'teams' | 'players' | 'game_points'>,
  gameId: string,
): { team: Team; points: number; members: number }[] {
  const points = s.game_points[gameId] ?? {}
  return teamsOf(s).flatMap((team) => {
    const members = membersOf(s, team.id)
    if (members.length === 0) return []
    return [{ team, points: Math.max(...members.map((m) => points[m.id] ?? 0)), members: members.length }]
  })
}

/**
 * The newest answer a teammate gave for the whole team in a game, among its
 * prompts still open: who gave it (`by` is this player when it was them) and
 * when. Null when there is none, or for a database from before teams.
 */
export function latestTeamAnswer(
  s: Pick<Snapshot, 'me' | 'players'>,
  gameId: string,
  prompts: readonly Pick<PromptState, 'key' | 'closed_at' | 'revealed_at'>[],
): { by: Player | null; mine: boolean; key: string; at: number } | null {
  const answered = s.me?.answered_by?.[gameId]
  if (!answered) return null
  let latest: { by: string; key: string; at: number } | null = null
  for (const prompt of prompts) {
    if (prompt.closed_at !== null || prompt.revealed_at !== null) continue
    const entry = answered[prompt.key]
    if (entry && (latest === null || entry.at > latest.at)) latest = { by: entry.by, key: prompt.key, at: entry.at }
  }
  if (!latest) return null
  return {
    by: s.players.find((p) => p.id === latest.by) ?? null,
    mine: latest.by === s.me?.player_id,
    key: latest.key,
    at: latest.at,
  }
}

/** "Team Gold", "Team Gold and Team Pink", "Team Gold, Team Pink and Team Teal". */
export function teamList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}
