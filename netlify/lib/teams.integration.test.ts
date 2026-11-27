// Teams against the local stack (docs/user-flows.md, Teams; the teams file,
// 20261127000000_teams.sql): the host's team functions and who may call them,
// who reads teams, a latecomer going into the smallest team, and one answer
// for the whole team in submit_answer: every member gets it with the same
// time, a final lock locks the team, the latest answer wins otherwise, each
// teammate's phone hears it, a guest can never answer for another team, and
// with team play off nothing changes. Every party here is new, so every other
// suite (parties without teams) proves the path of one is unchanged.
// Run with `npm run test:integration`.
import type { RealtimeChannel } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PromptSpec } from '../../src/games/core/Game'
import { admin, engine, rows, sleep, World, type Guest, type Party, type Person } from './testUsers'

const world = new World()
let host: Person

beforeAll(async () => {
  host = await world.host()
})

afterAll(() => world.cleanup())

type Failure = { code?: string; details?: string; message: string } | null
/** 'ok', or the refusal as "<SQLSTATE> <detail>", which the app reads. */
const outcome = (result: { error: Failure }) => (result.error ? `${result.error.code} ${result.error.details ?? ''}`.trim() : 'ok')

type Team = { id: string; name: string; colour: string; position: number }
type Snap = {
  teams: Team[]
  players: { id: string; name: string; team_id: string | null }[]
  games: { id: string; team_play: boolean }[]
  me: { player_id: string; answers: Record<string, Record<string, unknown>>; answered_by?: Record<string, Record<string, { by: string; at: number }>> } | null
}
async function snapshot(person: Person, party: Party, screen: 'phone' | 'tv' | 'host'): Promise<Snap> {
  const { data, error } = await person.client.rpc('session_snapshot', { p_session_id: party.id, p_screen: screen })
  expect(error).toBeNull()
  return data
}

const makeTeams = (person: Person, party: Party, count: number) => person.client.rpc('host_make_teams', { p_session_id: party.id, p_count: count })
const moveTo = (person: Person, playerId: string, teamId: string | null) =>
  person.client.rpc('host_move_to_team', { p_player_id: playerId, p_team_id: teamId })
const renameTeam = (person: Person, teamId: string, name: string) => person.client.rpc('host_rename_team', { p_team_id: teamId, p_name: name })
const clearTeams = (person: Person, party: Party) => person.client.rpc('host_clear_teams', { p_session_id: party.id })
const setTeamPlay = (person: Person, gameId: string, on: boolean) => person.client.rpc('host_set_team_play', { p_game_id: gameId, p_on: on })

/** The party's teams and who is in each, as postgres sees them (joined guests only, by team position). */
async function teamsOf(party: Party): Promise<{ teams: Team[]; of: Map<string, string | null> }> {
  const teams = (await rows<Team>('teams', 'session_id', party.id)).sort((a, b) => a.position - b.position)
  const players = await rows<{ id: string; team_id: string | null; joined_at: string | null }>('players', 'session_id', party.id)
  return { teams, of: new Map(players.map((p) => [p.id, p.team_id])) }
}

type Submission = { player_id: string; payload: unknown; first_at: string; at: string; changes: number; answered_by: string | null }
async function submissions(gameId: string, key: string): Promise<Map<string, Submission>> {
  const { data, error } = await admin.from('game_submissions').select('*').eq('game_id', gameId).eq('key', key)
  if (error) throw error
  return new Map((data as Submission[]).map((s) => [s.player_id, s]))
}

const answer = (person: Person, gameId: string, key: string, payload: unknown, requestId: string = crypto.randomUUID()) =>
  person.client.rpc('submit_answer', { p_game_id: gameId, p_key: key, p_payload: payload, p_request_id: requestId })

/** A party with these guests joined, and a lab game (testUsers.ts) to open any prompt in. */
async function partyWith(names: string[], title: string): Promise<{ party: Party; guests: Guest[]; byName: Record<string, Guest> }> {
  const party = await world.party(host, title)
  const guests: Guest[] = []
  for (const name of names) guests.push(await world.guest(party, name))
  return { party, guests, byName: Object.fromEntries(guests.map((g) => [g.name, g])) }
}

/** Puts each named guest in the named team (by position), with the host's move. */
async function arrange(party: Party, layout: Record<string, Guest[]>) {
  expect(outcome(await makeTeams(host, party, Object.keys(layout).length))).toBe('ok')
  const { teams } = await teamsOf(party)
  for (const [i, members] of Object.values(layout).entries()) {
    for (const g of members) expect(outcome(await moveTo(host, g.playerId, teams[i].id))).toBe('ok')
  }
  return teams
}

async function startLab(party: Party, teamPlay: boolean): Promise<string> {
  const gameId = await world.game(host, party, 'lab', teamPlay ? 'Lab in teams' : 'Lab alone')
  if (teamPlay) expect(outcome(await setTeamPlay(host, gameId, true))).toBe('ok')
  expect(await engine(host, { type: 'start', gameId, stage: false })).toMatchObject({ status: 200 })
  return gameId
}
const open = async (gameId: string, key: string, spec: PromptSpec) =>
  expect((await engine(host, { type: 'host-action', gameId, action: { type: 'open', key, spec } })).status).toBe(200)

describe('the host makes teams', () => {
  it('splits only the guests who are here into balanced teams, named and coloured in order, and shuffles again', async () => {
    const { party, guests } = await partyWith(['Ana', 'Bo', 'Cy', 'Dag', 'Eli', 'Fay', 'Gry', 'Hal', 'Ivo', 'Jo'], 'Teams made')
    await world.listGuests(host, party, ['Still Coming'])
    const { data, error } = await makeTeams(host, party, 4)
    expect(error).toBeNull()
    expect((data as { teams: Team[] }).teams.map((t) => [t.name, t.colour, t.position])).toEqual([
      ['Team Gold', 'gold', 0],
      ['Team Pink', 'pink', 1],
      ['Team Teal', 'teal', 2],
      ['Team Violet', 'violet', 3],
    ])
    const { teams, of } = await teamsOf(party)
    const sizes = teams.map((t) => guests.filter((g) => of.get(g.playerId) === t.id).length)
    expect(sizes.sort()).toEqual([2, 2, 3, 3])
    // The name still on the list is in no team.
    const expected = (await rows<{ id: string; user_id: string | null; team_id: string | null }>('players', 'session_id', party.id)).filter(
      (p) => p.user_id === null,
    )
    expect(expected.map((p) => p.team_id)).toEqual([null])

    // Renamed, then made again with fewer: the first ones keep their names and colours, the last goes.
    expect(outcome(await renameTeam(host, teams[0].id, '  The   Golden  Ones '))).toBe('ok')
    expect(outcome(await makeTeams(host, party, 3))).toBe('ok')
    const again = await teamsOf(party)
    expect(again.teams.map((t) => [t.id, t.name, t.colour])).toEqual([
      [teams[0].id, 'The Golden Ones', 'gold'],
      [teams[1].id, 'Team Pink', 'pink'],
      [teams[2].id, 'Team Teal', 'teal'],
    ])
    expect(guests.every((g) => again.teams.some((t) => t.id === again.of.get(g.playerId)))).toBe(true)
    // Then more: the next free colour comes back.
    expect(outcome(await makeTeams(host, party, 6))).toBe('ok')
    expect((await teamsOf(party)).teams.map((t) => t.colour)).toEqual(['gold', 'pink', 'teal', 'violet', 'sky', 'lime'])

    expect(outcome(await makeTeams(host, party, 1))).toBe('PT400 bad_count')
    expect(outcome(await makeTeams(host, party, 7))).toBe('PT400 bad_count')
  })

  it('moves a guest who is here, renames a team and clears them all, with clear refusals', async () => {
    const { party, byName } = await partyWith(['Ana', 'Bo', 'Cy', 'Dag'], 'Teams changed')
    const listed = await world.listGuests(host, party, ['Not Here'])
    const teams = await arrange(party, { gold: [byName.Ana, byName.Bo], pink: [byName.Cy, byName.Dag] })

    expect(outcome(await moveTo(host, byName.Ana.playerId, teams[1].id))).toBe('ok')
    expect((await teamsOf(party)).of.get(byName.Ana.playerId)).toBe(teams[1].id)
    expect(outcome(await moveTo(host, byName.Ana.playerId, null))).toBe('ok')
    expect((await teamsOf(party)).of.get(byName.Ana.playerId)).toBeNull()
    expect(outcome(await moveTo(host, listed.added[0].id, teams[0].id))).toBe('PT409 not_joined')

    // A team of another party is no team for this one.
    const other = await partyWith(['Zed', 'Yo'], 'Another party')
    const otherTeams = await arrange(other.party, { a: [other.byName.Zed], b: [other.byName.Yo] })
    expect(outcome(await moveTo(host, byName.Bo.playerId, otherTeams[0].id))).toBe('PT404 team_not_found')

    expect(outcome(await renameTeam(host, teams[1].id, 'team gold'))).toBe('PT409 name_taken')
    expect(outcome(await renameTeam(host, teams[1].id, '   '))).toBe('PT400 bad_name')
    expect(outcome(await renameTeam(host, teams[1].id, 'x'.repeat(41)))).toBe('PT400 bad_name')
    expect(outcome(await renameTeam(host, teams[1].id, 'Pink Panthers'))).toBe('ok')

    const { data } = await clearTeams(host, party)
    expect(data).toEqual({ cleared: 2 })
    const after = await teamsOf(party)
    expect(after.teams).toEqual([])
    expect([...after.of.values()].every((t) => t === null)).toBe(true)

    const kinds = (await rows<{ kind: string }>('event_log', 'session_id', party.id)).map((e) => e.kind)
    expect(kinds).toEqual(expect.arrayContaining(['teams.made', 'team.joined', 'team.renamed', 'teams.cleared']))
  })

  it('switches team play only while the game is not live, and refuses new teams while a team game is', async () => {
    const { party, byName } = await partyWith(['Ana', 'Bo'], 'Team play switch')
    await arrange(party, { gold: [byName.Ana], pink: [byName.Bo] })
    const gameId = await world.game(host, party, 'lab', 'Lab')
    expect((await setTeamPlay(host, gameId, true)).data).toMatchObject({ team_play: true, changed: true })
    expect((await setTeamPlay(host, gameId, true)).data).toMatchObject({ changed: false })
    expect((await snapshot(host, party, 'host')).games.find((g) => g.id === gameId)?.team_play).toBe(true)

    await engine(host, { type: 'start', gameId, stage: false })
    expect(outcome(await setTeamPlay(host, gameId, false))).toBe('PT409 active')
    expect(outcome(await makeTeams(host, party, 2))).toBe('PT409 team_game_live')
    expect(outcome(await clearTeams(host, party))).toBe('PT409 team_game_live')
    // Moving one guest stays allowed: the host fixes a team on the night.
    expect(outcome(await moveTo(host, byName.Ana.playerId, null))).toBe('ok')

    await engine(host, { type: 'end', gameId })
    expect(outcome(await setTeamPlay(host, gameId, false))).toBe('ok')
    expect(outcome(await makeTeams(host, party, 2))).toBe('ok')
  })
})

describe('only hosts change teams; members read them', () => {
  it('refuses every team call from a guest, and every direct write', async () => {
    const { party, byName } = await partyWith(['Ana', 'Bo'], 'Guests may not')
    const teams = await arrange(party, { gold: [byName.Ana], pink: [byName.Bo] })
    const gameId = await world.game(host, party, 'lab', 'Lab')
    const ana = byName.Ana

    expect(outcome(await makeTeams(ana, party, 2))).toBe('PT403 not_host')
    expect(outcome(await moveTo(ana, ana.playerId, teams[1].id))).toBe('PT403 not_host')
    expect(outcome(await renameTeam(ana, teams[0].id, 'Mine'))).toBe('PT403 not_host')
    expect(outcome(await clearTeams(ana, party))).toBe('PT403 not_host')
    expect(outcome(await setTeamPlay(ana, gameId, true))).toBe('PT403 not_host')

    // No grant to write the teams, a guest's team or a game's team play directly; not even for the host.
    for (const person of [ana, host]) {
      expect(outcome(await person.client.from('teams').insert({ session_id: party.id, name: 'Sneaky', colour: 'gold' }))).toBe('42501')
      expect(outcome(await person.client.from('teams').update({ name: 'Sneaky' }).eq('id', teams[0].id))).toBe('42501')
      expect(outcome(await person.client.from('players').update({ team_id: teams[1].id }).eq('id', ana.playerId))).toBe('42501')
      expect(outcome(await person.client.from('session_games').update({ team_play: true }).eq('id', gameId))).toBe('42501')
    }
    // A delete has a grant only on tables guests may never delete from: none here.
    expect(outcome(await ana.client.from('teams').delete().eq('id', teams[0].id))).toBe('42501')
    expect((await teamsOf(party)).teams).toHaveLength(2)
    expect((await teamsOf(party)).of.get(ana.playerId)).toBe(teams[0].id)

    // The team path of submit_answer is never a client's to call.
    const { error } = await ana.client.rpc('submit_team_answer', {})
    expect(error).not.toBeNull()
  })

  it('lets members and the TV read their party’s teams, and nobody else', async () => {
    const { party, byName } = await partyWith(['Ana', 'Bo'], 'Who reads teams')
    const teams = await arrange(party, { gold: [byName.Ana], pink: [byName.Bo] })
    const tv = await world.screen(host, party)
    const outsider = await world.user()

    expect((await byName.Ana.client.from('teams').select('id').eq('session_id', party.id)).data).toHaveLength(2)
    expect((await tv.client.from('teams').select('id').eq('session_id', party.id)).data).toHaveLength(2)
    expect((await outsider.client.from('teams').select('id').eq('session_id', party.id)).data).toEqual([])

    for (const [person, screen] of [[byName.Ana, 'phone'], [tv, 'tv'], [host, 'host']] as const) {
      const snap = await snapshot(person, party, screen)
      expect(snap.teams.map((t) => t.id)).toEqual(teams.map((t) => t.id))
      expect(snap.players.find((p) => p.id === byName.Bo.playerId)?.team_id).toBe(teams[1].id)
    }
  })
})

describe('a guest who joins goes into the smallest team', () => {
  it('puts a latecomer, and a name taken from the list, into the team with the fewest here, ties to the lowest', async () => {
    const { party, byName } = await partyWith(['Ana', 'Bo', 'Cy'], 'Latecomers')
    await world.listGuests(host, party, ['Listed Late'])
    const teams = await arrange(party, { gold: [byName.Ana, byName.Bo], pink: [byName.Cy], teal: [] })

    // Teal has nobody: the first latecomer goes there.
    const dag = await world.guest(party, 'Dag')
    expect((await teamsOf(party)).of.get(dag.playerId)).toBe(teams[2].id)
    // Pink and teal have one each: a tie goes to the lowest position, pink.
    const listed = await world.claimGuest(party, 'Listed Late')
    expect((await teamsOf(party)).of.get(listed.playerId)).toBe(teams[1].id)
    // Now gold 2, pink 2, teal 1.
    const eli = await world.guest(party, 'Eli')
    expect((await teamsOf(party)).of.get(eli.playerId)).toBe(teams[2].id)

    // A party without teams: a join is in no team, as always.
    const plain = await partyWith(['Solo'], 'No teams')
    expect((await teamsOf(plain.party)).of.get(plain.byName.Solo.playerId)).toBeNull()
  })

  it('gives a freed name back with no team, and its next guest the smallest team', async () => {
    const { party, byName } = await partyWith(['Ana', 'Bo', 'Cy'], 'Freed in a team')
    await world.listGuests(host, party, ['Fay'])
    const fay = await world.claimGuest(party, 'Fay')
    const teams = await arrange(party, { gold: [byName.Ana, fay], pink: [byName.Bo, byName.Cy] })
    expect(outcome(await host.client.rpc('host_free_guest', { p_player_id: fay.playerId }))).toBe('ok')
    expect((await teamsOf(party)).of.get(fay.playerId)).toBeNull()
    // Gold has one now, pink two.
    const again = await world.claimGuest(party, 'Fay')
    expect((await teamsOf(party)).of.get(again.playerId)).toBe(teams[0].id)
  })
})

describe('one answer for the whole team', () => {
  let party: Party
  let g: Record<string, Guest>
  let teams: Team[]
  let gameId: string

  beforeAll(async () => {
    const made = await partyWith(['Ana', 'Bo', 'Cy', 'Dag', 'Eli', 'Fay', 'Solo'], 'One answer')
    party = made.party
    g = made.byName
    teams = await arrange(party, { gold: [g.Ana, g.Bo, g.Cy], pink: [g.Dag, g.Eli, g.Fay] })
    expect(outcome(await moveTo(host, g.Solo.playerId, null))).toBe('ok')
    gameId = await startLab(party, true)
  })

  it('writes a final answer for every member with the same time, and locks the whole team', async () => {
    await open(gameId, 'q1', { kind: 'choice', options: ['a', 'b', 'c'], final: true })
    const { data, error } = await answer(g.Bo, gameId, 'q1', { choice: 'b' })
    expect(error).toBeNull()
    expect(data).toMatchObject({ accepted: true, answer: { choice: ['b'] }, team: { id: teams[0].id, written: 3 } })

    const subs = await submissions(gameId, 'q1')
    for (const member of [g.Ana, g.Bo, g.Cy]) {
      expect(subs.get(member.playerId)).toMatchObject({ payload: { choice: ['b'] }, answered_by: g.Bo.playerId, changes: 0 })
      expect(subs.get(member.playerId)!.first_at).toBe(subs.get(g.Bo.playerId)!.first_at)
    }
    // The other team and the guest in no team have nothing.
    for (const other of [g.Dag, g.Eli, g.Fay, g.Solo]) expect(subs.has(other.playerId)).toBe(false)

    // A teammate's other tap is refused; the same answer counts as success.
    expect(outcome(await answer(g.Ana, gameId, 'q1', { choice: 'c' }))).toBe('PT409 already_answered')
    expect((await answer(g.Cy, gameId, 'q1', { choice: 'b' })).data).toMatchObject({ accepted: true, replayed: true })
    // The other team answers on its own.
    expect(outcome(await answer(g.Eli, gameId, 'q1', { choice: 'a' }))).toBe('ok')
    expect(outcome(await answer(g.Solo, gameId, 'q1', { choice: 'c' }))).toBe('ok')
    const after = await submissions(gameId, 'q1')
    expect(after.size).toBe(7)
    for (const member of [g.Dag, g.Eli, g.Fay]) expect(after.get(member.playerId)).toMatchObject({ payload: { choice: ['a'] }, answered_by: g.Eli.playerId })
    // Alone, as ever: no answered_by.
    expect(after.get(g.Solo.playerId)).toMatchObject({ payload: { choice: ['c'] }, answered_by: null })

    // Each member then scores the team's answer (the lab gives a point per revealed answer).
    expect((await engine(host, { type: 'host-action', gameId, action: { type: 'reveal', key: 'q1' }, close: ['q1'] })).status).toBe(200)
    const scores = new Map((await rows<{ player_id: string; points: number }>('game_scores', 'game_id', gameId)).map((r) => [r.player_id, r.points]))
    for (const member of Object.values(g)) expect(scores.get(member.playerId)).toBe(1)
    const state = (await rows<{ state: { revealed: { key: string; answers: Record<string, unknown> }[] } }>('game_states', 'game_id', gameId))[0].state
    const revealed = state.revealed.find((r) => r.key === 'q1')!.answers
    expect(revealed[g.Ana.playerId]).toEqual({ choice: ['b'] })
    expect(revealed[g.Fay.playerId]).toEqual({ choice: ['a'] })
  })

  it('takes the latest answer for the whole team on a prompt that may change', async () => {
    await open(gameId, 'v1', { kind: 'text', max_length: 40 })
    expect(outcome(await answer(g.Ana, gameId, 'v1', { text: 'Waterloo' }))).toBe('ok')
    expect(outcome(await answer(g.Cy, gameId, 'v1', { text: 'Mamma Mia' }))).toBe('ok')
    expect(outcome(await answer(g.Bo, gameId, 'v1', { text: 'Waterloo' }))).toBe('ok')
    const subs = await submissions(gameId, 'v1')
    for (const member of [g.Ana, g.Bo, g.Cy]) {
      expect(subs.get(member.playerId)).toMatchObject({ payload: { text: 'Waterloo' }, answered_by: g.Bo.playerId, changes: 2 })
      expect(subs.get(member.playerId)!.first_at).toBe(subs.get(g.Ana.playerId)!.first_at)
    }
    expect([g.Dag, g.Eli, g.Fay, g.Solo].some((o) => subs.has(o.playerId))).toBe(false)

    // A phone's snapshot has the team's answer and who gave it.
    const snap = await snapshot(g.Cy, party, 'phone')
    expect(snap.me?.answers[gameId]?.v1).toEqual({ text: 'Waterloo' })
    expect(snap.me?.answered_by?.[gameId]?.v1).toMatchObject({ by: g.Bo.playerId, at: expect.any(Number) })
    // An answer of one's own has no answered_by: the guest in no team.
    expect(outcome(await answer(g.Solo, gameId, 'v1', { text: 'Alone' }))).toBe('ok')
    expect((await snapshot(g.Solo, party, 'phone')).me?.answered_by?.[gameId]?.v1).toBeUndefined()
  })

  it('never writes for a guest who is no longer in the team, and a moved guest answers with their new team', async () => {
    await open(gameId, 'q2', { kind: 'choice', options: ['a', 'b'], final: true })
    // Fay moves from pink to gold.
    expect(outcome(await moveTo(host, g.Fay.playerId, teams[0].id))).toBe('ok')
    expect(outcome(await answer(g.Dag, gameId, 'q2', { choice: 'a' }))).toBe('ok')
    let subs = await submissions(gameId, 'q2')
    expect([...subs.keys()].sort()).toEqual([g.Dag.playerId, g.Eli.playerId].sort())
    expect(outcome(await answer(g.Fay, gameId, 'q2', { choice: 'b' }))).toBe('ok')
    subs = await submissions(gameId, 'q2')
    for (const member of [g.Ana, g.Bo, g.Cy, g.Fay]) expect(subs.get(member.playerId)).toMatchObject({ payload: { choice: ['b'] }, answered_by: g.Fay.playerId })
    expect(subs.get(g.Eli.playerId)).toMatchObject({ payload: { choice: ['a'] } })
    // Back to pink for the next tests.
    expect(outcome(await moveTo(host, g.Fay.playerId, teams[1].id))).toBe('ok')
  })

  it('checks exclude_self for each member: a teammate the answer names is left out', async () => {
    await open(gameId, 'pick', { kind: 'choice', options: 'players', exclude_self: true })
    expect(outcome(await answer(g.Ana, gameId, 'pick', { choice: g.Bo.playerId }))).toBe('ok')
    const subs = await submissions(gameId, 'pick')
    expect(subs.has(g.Ana.playerId)).toBe(true)
    expect(subs.has(g.Cy.playerId)).toBe(true)
    expect(subs.has(g.Bo.playerId)).toBe(false)
    // Bo may still answer for himself, and then for the team: Ana and Cy have another answer already, which a vote may change.
    expect(outcome(await answer(g.Bo, gameId, 'pick', { choice: g.Ana.playerId }))).toBe('ok')
    const after = await submissions(gameId, 'pick')
    expect(after.get(g.Bo.playerId)).toMatchObject({ payload: { choice: [g.Ana.playerId] } })
    expect(after.get(g.Cy.playerId)).toMatchObject({ payload: { choice: [g.Ana.playerId] } })
    // Ana can't name herself: she keeps the team's last answer that holds for her.
    expect(after.get(g.Ana.playerId)).toMatchObject({ payload: { choice: [g.Bo.playerId] } })
  })

  it('lets exactly one of two teammates who tap at the same moment win a final prompt', async () => {
    await open(gameId, 'race', { kind: 'choice', options: ['a', 'b'], final: true })
    const [first, second] = await Promise.all([answer(g.Dag, gameId, 'race', { choice: 'a' }), answer(g.Eli, gameId, 'race', { choice: 'b' })])
    const outcomes = [outcome(first), outcome(second)].sort()
    expect(outcomes).toEqual(['PT409 already_answered', 'ok'])
    const subs = await submissions(gameId, 'race')
    const winner = outcome(first) === 'ok' ? { choice: ['a'] } : { choice: ['b'] }
    for (const member of [g.Dag, g.Eli, g.Fay]) expect(subs.get(member.playerId)?.payload).toEqual(winner)
  })

  it('pings each teammate’s own topic, so every phone in the team shows the answer', async () => {
    await open(gameId, 'heard', { kind: 'choice', options: ['a', 'b'] })
    const channels: RealtimeChannel[] = []
    const heard: Record<string, string[]> = {}
    for (const member of [g.Ana, g.Cy, g.Dag]) {
      await member.client.realtime.setAuth(member.token)
      heard[member.name] = []
      const channel = member.client.channel(`player:${member.playerId}`, { config: { private: true } })
      channel.on('broadcast', { event: '*' }, (message) => heard[member.name].push(message.event))
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('join timed out')), 8000)
        channel.subscribe((state) => {
          if (state === 'SUBSCRIBED') {
            clearTimeout(timer)
            resolve()
          }
        })
      })
      channels.push(channel)
    }
    try {
      expect(outcome(await answer(g.Bo, gameId, 'heard', { choice: 'a' }))).toBe('ok')
      for (let i = 0; i < 100 && (heard.Ana.length === 0 || heard.Cy.length === 0); i++) await sleep(50)
      expect(heard.Ana).toContain('changed')
      expect(heard.Cy).toContain('changed')
      await sleep(500)
      // Another team's phone hears nothing of it.
      expect(heard.Dag).toEqual([])
    } finally {
      for (const [i, channel] of channels.entries()) await [g.Ana, g.Cy, g.Dag][i].client.removeChannel(channel)
    }
  })
})

describe('team play off', () => {
  it('answers each guest alone, exactly as before, even in a party with teams', async () => {
    const { party, byName } = await partyWith(['Ana', 'Bo', 'Cy'], 'Team play off')
    await arrange(party, { gold: [byName.Ana, byName.Bo], pink: [byName.Cy] })
    const gameId = await startLab(party, false)
    await open(gameId, 'q', { kind: 'choice', options: ['a', 'b'], final: true })
    const { data } = await answer(byName.Ana, gameId, 'q', { choice: 'a' })
    expect(data).toEqual({ accepted: true, answer: { choice: ['a'] }, at: expect.any(Number), ms: expect.any(Number) })
    let subs = await submissions(gameId, 'q')
    expect([...subs.keys()]).toEqual([byName.Ana.playerId])
    expect(subs.get(byName.Ana.playerId)).toMatchObject({ answered_by: null })
    expect(outcome(await answer(byName.Bo, gameId, 'q', { choice: 'b' }))).toBe('ok')
    expect(outcome(await answer(byName.Ana, gameId, 'q', { choice: 'b' }))).toBe('PT409 already_answered')
    subs = await submissions(gameId, 'q')
    expect(subs.get(byName.Ana.playerId)?.payload).toEqual({ choice: ['a'] })
    expect(subs.get(byName.Bo.playerId)?.payload).toEqual({ choice: ['b'] })

    // The refusal of one keeps its old words.
    const { error } = await answer(byName.Ana, gameId, 'q', { choice: 'b' })
    expect(error?.message).toBe('You already answered')
    const log = (await rows<{ kind: string; data: Record<string, unknown> }>('event_log', 'session_id', party.id)).filter((e) => e.kind === 'prompt.answered')
    expect(log.every((e) => !('team' in e.data))).toBe(true)
  })
})

describe('fusion in teams', () => {
  // Fusion scores a team as one: game_load hands it team_play, and in teams a
  // guest's own name counts for them, so when a team names one of its own,
  // that member scores as much as the rest.
  it('counts a member’s own name when their team names them, so every member scores the same', async () => {
    const { party, byName } = await partyWith(['Ana', 'Bo', 'Cy', 'Dee'], 'Fusion in teams')
    const { Ana, Bo, Cy, Dee } = byName
    await arrange(party, { gold: [Ana, Bo], pink: [Cy, Dee] })
    const gameId = await world.game(host, party, 'fusion', 'Who is fused?', {
      pictures: [{ label: '#1', people: ['Ana', 'Cy'] }],
      pointsPerPerson: 1,
      bonusForBoth: 1,
      seconds: 30,
    })
    expect(outcome(await setTeamPlay(host, gameId, true))).toBe('ok')
    const act = (action: Record<string, unknown>, close?: string[]) => engine(host, { type: 'host-action', gameId, action, ...(close ? { close } : {}) })

    expect(await engine(host, { type: 'start', gameId })).toMatchObject({ status: 200 })
    const [state] = await rows<{ state: { teamPlay?: boolean } }>('game_states', 'game_id', gameId)
    expect(state.state.teamPlay).toBe(true)
    expect(await act({ type: 'ask', n: 1 })).toMatchObject({ status: 200 })
    // Bo names his teammate Ana, and Cy names herself: each lock is the whole team's.
    expect((await answer(Bo, gameId, 'p1', { choice: ['Ana', 'Cy'] })).error).toBeNull()
    expect((await answer(Cy, gameId, 'p1', { choice: ['Cy', 'Ana'] })).error).toBeNull()
    expect(await act({ type: 'reveal', n: 1 }, ['p1'])).toMatchObject({ status: 200 })

    const scores = await rows<{ player_id: string; points: number }>('game_scores', 'game_id', gameId)
    // Both right for all four, Ana and Cy too: 2 + the bonus each.
    expect(Object.fromEntries(scores.map((s) => [s.player_id, s.points]))).toEqual({
      [Ana.playerId]: 3,
      [Bo.playerId]: 3,
      [Cy.playerId]: 3,
      [Dee.playerId]: 3,
    })
  }, 30_000)

  it('still never counts a guest’s own name with team play off', async () => {
    const { party, byName } = await partyWith(['Ana', 'Bo', 'Cy'], 'Fusion alone')
    const { Ana, Bo, Cy } = byName
    await arrange(party, { gold: [Ana, Bo], pink: [Cy] })
    const gameId = await world.game(host, party, 'fusion', 'Who is fused?', {
      pictures: [{ label: '#1', people: ['Ana', 'Bo'] }],
      pointsPerPerson: 1,
      bonusForBoth: 0,
      seconds: 30,
    })
    expect(await engine(host, { type: 'start', gameId })).toMatchObject({ status: 200 })
    expect(await engine(host, { type: 'host-action', gameId, action: { type: 'ask', n: 1 } })).toMatchObject({ status: 200 })
    expect((await answer(Ana, gameId, 'p1', { choice: ['Ana', 'Bo'] })).error).toBeNull()
    expect((await answer(Bo, gameId, 'p1', { choice: ['Ana', 'Bo'] })).error).toBeNull()
    expect(await engine(host, { type: 'host-action', gameId, action: { type: 'reveal', n: 1 }, close: ['p1'] })).toMatchObject({ status: 200 })
    const scores = await rows<{ player_id: string; points: number }>('game_scores', 'game_id', gameId)
    expect(Object.fromEntries(scores.map((s) => [s.player_id, s.points]))).toEqual({ [Ana.playerId]: 1, [Bo.playerId]: 1 })
  }, 30_000)
})
