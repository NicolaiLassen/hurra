import { describe, expect, it } from 'vitest'
import { latestTeamAnswer, membersOf, playedInTeams, teamColour, teamless, teamList, teamOf, teamPoints, teamsOf, TEAM_COLOURS, TEAM_FILL } from './teams'
import type { Player, Snapshot, Team } from './types'

const player = (id: string, team_id: string | null = null): Player => ({ id, name: id.toUpperCase(), code: 'ABCDE', profile: {}, created_at: 0, team_id })
const gold: Team = { id: 'tg', name: 'Team Gold', colour: 'gold', position: 0 }
const pink: Team = { id: 'tp', name: 'Team Pink', colour: 'pink', position: 1 }
const teal: Team = { id: 'tt', name: 'Team Teal', colour: 'teal', position: 2 }

const party = (patch: Partial<Snapshot> = {}) =>
  ({
    teams: [gold, pink, teal],
    players: [player('a', 'tg'), player('b', 'tp'), player('c', 'tg'), player('d'), player('e', 'gone')],
    game_points: {},
    me: null,
    ...patch,
  }) as Pick<Snapshot, 'teams' | 'players' | 'game_points' | 'me'>

describe('teams', () => {
  it('reads a party without teams, or from a database before them, as none', () => {
    expect(teamsOf({})).toEqual([])
    expect(teamsOf({ teams: [] })).toEqual([])
    expect(teamOf({ players: [player('a', 'tg')] }, 'a')).toBeNull()
    expect(playedInTeams({}, { team_play: true })).toBe(false)
    expect(playedInTeams({ teams: [gold] }, {})).toBe(false)
    expect(playedInTeams({ teams: [gold] }, { team_play: true })).toBe(true)
  })

  it('finds a guest’s team, a team’s members and who is in none', () => {
    const s = party()
    expect(teamOf(s, 'a')).toBe(gold)
    expect(teamOf(s, 'd')).toBeNull()
    // A team that is gone is no team.
    expect(teamOf(s, 'e')).toBeNull()
    expect(membersOf(s, 'tg').map((p) => p.id)).toEqual(['a', 'c'])
    expect(teamless(s).map((p) => p.id)).toEqual(['d', 'e'])
  })

  it('gives each team the most points any member has in the game, and leaves out empty teams', () => {
    const s = party({ game_points: { g: { a: 3, c: 2, b: 5 } } })
    expect(teamPoints(s, 'g')).toEqual([
      { team: gold, points: 3, members: 2 },
      { team: pink, points: 5, members: 1 },
    ])
    expect(teamPoints(s, 'other').map((r) => r.points)).toEqual([0, 0])
  })

  it('finds the newest answer a teammate gave among the open prompts', () => {
    const open = (key: string) => ({ key, closed_at: null, revealed_at: null })
    const s = party({
      me: {
        player_id: 'a',
        views: {},
        answers: {},
        answered_by: { g: { q1: { by: 'c', at: 10 }, q2: { by: 'a', at: 20 }, q3: { by: 'c', at: 30 } } },
      },
    })
    expect(latestTeamAnswer(s, 'g', [open('q1'), open('q2')])).toMatchObject({ by: { id: 'a' }, mine: true, key: 'q2' })
    expect(latestTeamAnswer(s, 'g', [open('q1'), { key: 'q3', closed_at: 5, revealed_at: null }])).toMatchObject({ by: { id: 'c' }, mine: false, key: 'q1' })
    expect(latestTeamAnswer(s, 'other', [open('q1')])).toBeNull()
    expect(latestTeamAnswer(party(), 'g', [open('q1')])).toBeNull()
  })

  it('has a fill for every colour, and reads a colour it does not know as gold', () => {
    for (const colour of TEAM_COLOURS) expect(TEAM_FILL[colour]).toMatch(/^bg-/)
    expect(teamColour('violet')).toBe('violet')
    expect(teamColour('mauve')).toBe('gold')
  })

  it('lists team names in words', () => {
    expect(teamList([])).toBe('')
    expect(teamList(['Team Gold'])).toBe('Team Gold')
    expect(teamList(['Team Gold', 'Team Pink', 'Team Teal'])).toBe('Team Gold, Team Pink and Team Teal')
  })
})
