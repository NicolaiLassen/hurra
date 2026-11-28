import { describe, expect, it } from 'vitest'
import {
  clearBlock,
  liveTeamGame,
  makeBlock,
  memberCount,
  moveChoices,
  NO_TEAM,
  remakeNote,
  splitLine,
  TEAM_COUNTS,
  teamIdOf,
  teamPlayLine,
} from '@/components/host/teamWords'
import type { SessionGame, Team } from '@/lib/types'

const game = (patch: Partial<SessionGame>): SessionGame => ({
  id: 'g',
  game_type: 'any',
  title: 'Quiz',
  position: 0,
  status: 'pending',
  public_state: null,
  started_at: null,
  finished_at: null,
  finished_by: null,
  winners: [],
  wake_at: null,
  archived_at: null,
  created_at: 0,
  ...patch,
})
const team = (id: string, name: string, colour: Team['colour'], position: number): Team => ({ id, name, colour, position })
const gold = team('tg', 'Team Gold', 'gold', 0)
const pink = team('tp', 'Team Pink', 'pink', 1)
const teal = team('tt', 'Team Teal', 'teal', 2)
const violet = team('tv', 'Team Violet', 'violet', 3)

describe('the teams’ words in the control room', () => {
  it('offers 2 to 6 teams', () => {
    expect(TEAM_COUNTS).toEqual([2, 3, 4, 5, 6])
  })

  it('says what a count gives for the guests here, as the server deals them', () => {
    expect(splitLine(22, 4)).toBe('22 guests here: 4 teams of 5 or 6')
    expect(splitLine(24, 4)).toBe('24 guests here: 4 teams of 6')
    expect(splitLine(12, 4)).toBe('12 guests here: 4 teams of 3')
    expect(splitLine(13, 6)).toBe('13 guests here: 6 teams of 2 or 3')
    expect(splitLine(2, 2)).toBe('2 guests here: 2 teams of 1')
    // Fewer guests than teams: some start empty, and the next guests fill them.
    expect(splitLine(3, 4)).toBe('3 guests here: 4 teams, 3 of 1 and 1 empty for now')
    expect(splitLine(2, 6)).toBe('2 guests here: 6 teams, 2 of 1 and 4 empty for now')
    expect(splitLine(1, 2)).toBe('1 guest here: 2 teams, 1 of 1 and 1 empty for now')
    expect(splitLine(0, 4)).toBe('Nobody here yet: 4 empty teams for now')
  })

  it('finds the live game played in teams, first by position', () => {
    expect(liveTeamGame([])).toBeNull()
    expect(liveTeamGame([game({ status: 'active' })])).toBeNull()
    expect(liveTeamGame([game({ status: 'pending', team_play: true }), game({ status: 'finished', team_play: true })])).toBeNull()
    // An archived game is never live in the room.
    expect(liveTeamGame([game({ status: 'active', team_play: true, archived_at: 1 })])).toBeNull()
    const later = game({ id: 'b', title: 'Lydspor', status: 'active', team_play: true, position: 2 })
    const first = game({ id: 'a', title: 'Quiz', status: 'active', team_play: true, position: 1 })
    expect(liveTeamGame([later, first])?.id).toBe('a')
  })

  it('says why teams can’t be made or cleared now, in the server’s terms', () => {
    const live = [game({ status: 'active', team_play: true })]
    expect(makeBlock(live, false)).toBe('End Quiz before you make teams.')
    expect(makeBlock(live, true)).toBe('End Quiz to make new teams or clear them.')
    expect(clearBlock(live)).toBe('End Quiz to make new teams or clear them.')
    // Before anyone is here, or with fewer guests than teams, teams can be made: they start empty and guests pick one.
    expect(makeBlock([], false)).toBeNull()
    expect(makeBlock([], true)).toBeNull()
    // A live game played alone doesn't hold teams back.
    expect(makeBlock([game({ status: 'active' })], true)).toBeNull()
    expect(clearBlock([game({ status: 'active' })])).toBeNull()
  })

  it('says what Make teams again does to the teams there are', () => {
    const teams = [gold, pink, teal, violet]
    const shuffled = 'Everyone here is shuffled into new teams, so most guests change team.'
    expect(remakeNote(teams, 4)).toBe(`${shuffled} The teams keep their names and colours.`)
    expect(remakeNote(teams, 3)).toBe(`${shuffled} Team Violet goes. The others keep their names and colours.`)
    expect(remakeNote(teams, 2)).toBe(`${shuffled} Team Teal and Team Violet go. The others keep their names and colours.`)
    expect(remakeNote(teams, 5)).toBe(`${shuffled} The teams keep their names and colours, and a new team joins.`)
    expect(remakeNote(teams, 6)).toBe(`${shuffled} The teams keep their names and colours, and 2 new teams join.`)
  })

  it('counts a team’s members in words', () => {
    expect(memberCount(0)).toBe('Nobody yet')
    expect(memberCount(1)).toBe('1 guest')
    expect(memberCount(6)).toBe('6 guests')
  })

  it('offers each team and No team to move a guest to, marking where they are now', () => {
    const sizes = new Map([
      ['tg', 3],
      ['tp', 1],
    ])
    const choices = moveChoices([gold, pink, teal], sizes, 'tg')
    expect(choices.map((c) => [c.value, c.label, c.detail, c.current])).toEqual([
      ['tg', 'Team Gold', 'In it now. 3 guests.', true],
      ['tp', 'Team Pink', '1 guest.', false],
      ['tt', 'Team Teal', 'Nobody yet.', false],
      [NO_TEAM, 'No team', 'Answers alone.', false],
    ])
    expect(choices[0].team).toBe(gold)
    expect(choices[3].team).toBeNull()
    // In no team, or in a team that is gone: No team is where they are.
    for (const from of [null, 'gone']) {
      const none = moveChoices([gold, pink], sizes, from)
      expect(none.filter((c) => c.current).map((c) => c.value)).toEqual([NO_TEAM])
      expect(none.at(-1)?.detail).toBe('In it now. Answers alone.')
    }
    expect(teamIdOf(NO_TEAM)).toBeNull()
    expect(teamIdOf('tp')).toBe('tp')
  })

  it('says what Play in teams does as it stands, and that it waits while the game is live', () => {
    expect(teamPlayLine({ on: true, live: false, teams: 4 })).toBe('In 4 teams: one answer from any member counts for the whole team.')
    expect(teamPlayLine({ on: false, live: false, teams: 4 })).toBe('Each guest answers for themselves.')
    // No teams yet: the switch may be set, and the line says to make them first.
    expect(teamPlayLine({ on: true, live: false, teams: 0 })).toBe('No teams yet. Make teams in Guests first: until then it is played alone.')
    expect(teamPlayLine({ on: false, live: false, teams: 0 })).toBe(
      'Each guest answers for themselves. To play in teams, make teams in Guests first.',
    )
    expect(teamPlayLine({ on: true, live: true, teams: 4 })).toBe('Played in teams while it is live. You can change it once it ends.')
    expect(teamPlayLine({ on: false, live: true, teams: 4 })).toBe('Played alone while it is live. You can change it once it ends.')
    // Switched on without teams, it is played alone.
    expect(teamPlayLine({ on: true, live: true, teams: 0 })).toBe('Played alone while it is live. You can change it once it ends.')
  })

  it('never uses an en or em dash', () => {
    const words = [
      splitLine(22, 4),
      splitLine(3, 4),
      makeBlock([game({ status: 'active', team_play: true })], false),
      makeBlock([game({ status: 'active', team_play: true })], true),
      remakeNote([gold, pink], 3),
      teamPlayLine({ on: true, live: false, teams: 0 }),
    ]
    for (const line of words) expect(line).not.toMatch(/[\u2013\u2014]/)
  })
})
