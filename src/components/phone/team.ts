// The team line over a game played in teams (docs/user-flows.md, "Teams"), as
// pure functions, so its words are unit-tested in team.test.ts. Core only:
// how an answer counts comes from the open prompts' specs, never a game's name.
import { latestTeamAnswer, playedInTeams, teamOf } from '@/lib/teams'
import type { Player, PromptState, SessionGame, Snapshot, Team } from '@/lib/types'

/**
 * How one answer counts for the team, from the game's prompts open now:
 * 'first' when every open prompt is final (the first answer locks the whole
 * team), 'latest' when none is (the latest answer counts until it closes),
 * and null with no prompt open or a mix of both.
 */
export function answerRule(prompts: readonly Pick<PromptState, 'spec' | 'closed_at'>[]): 'first' | 'latest' | null {
  const open = prompts.filter((p) => p.closed_at === null)
  if (open.length === 0) return null
  const finals = open.filter((p) => p.spec.final === true).length
  if (finals === open.length) return 'first'
  return finals === 0 ? 'latest' : null
}

/** The team line's words: the team's name and how it answers, and who gave the newest answer. */
export type TeamWords = {
  /** "Team Gold answers together." */
  head: string
  /** "Any of you can answer: the first answer counts for all of you." */
  rule: string
  /** "Ana answered for your team." or "You answered for your team."; null when nobody has yet. */
  answered: string | null
}

export function teamWords(
  team: Pick<Team, 'name'>,
  rule: 'first' | 'latest' | null,
  latest: { by: Pick<Player, 'name'> | null; mine: boolean } | null,
): TeamWords {
  return {
    head: `${team.name} answers together.`,
    rule:
      rule === 'first'
        ? 'Any of you can answer: the first answer counts for all of you.'
        : rule === 'latest'
          ? 'Any of you can answer, and the latest answer counts.'
          : 'One answer from any of you counts for all of you.',
    answered: latest === null ? null : `${latest.mine ? 'You' : (latest.by?.name ?? 'A teammate')} answered for your team.`,
  }
}

/**
 * The team line for this phone's player in a game, or null: only while the
 * game is played in teams and the player is in one of the party's teams.
 */
export function teamLine(
  s: Pick<Snapshot, 'teams' | 'players' | 'prompts' | 'me'>,
  game: Pick<SessionGame, 'id' | 'team_play'>,
  playerId: string,
): { team: Team; words: TeamWords } | null {
  if (!playedInTeams(s, game)) return null
  const team = teamOf(s, playerId)
  if (!team) return null
  const prompts = s.prompts.filter((p) => p.game_id === game.id)
  return { team, words: teamWords(team, answerRule(prompts), latestTeamAnswer(s, game.id, prompts)) }
}

/**
 * A team's line on the phone's team picker: how many are in it, said from
 * this guest's side for their own team. "Just you so far", "You and 4 more",
 * "Nobody yet", "1 guest", "5 guests".
 */
export function teamSizeLine(members: number, mine: boolean): string {
  if (mine) return members <= 1 ? 'Just you so far' : `You and ${members - 1} more`
  if (members === 0) return 'Nobody yet'
  return `${members} ${members === 1 ? 'guest' : 'guests'}`
}
