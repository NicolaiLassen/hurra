// The guest list against the local stack (docs/guest-list.md): host_add_guests,
// guest_list, claim_guest and host_free_guest; join_session's on_list offer;
// that guests still expected never reach a screen's players, standings or
// counts, nor a game's players, views, scores or answers; the commit that
// races a free; and the log rows. Every party here is new, so a party without
// a list (every other suite) proves a normal join is unchanged.
// Run with `npm run test:integration`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { admin, anonClient, engine, rows, World, type Guest, type Party, type Person } from './testUsers'

const world = new World()
let host: Person

beforeAll(async () => {
  host = await world.host()
})

afterAll(() => world.cleanup())

type Failure = { code?: string; details?: string; hint?: string; message: string } | null
/** 'ok', or the refusal as "<SQLSTATE> <detail>", which the app reads. */
const outcome = (result: { error: Failure }) => (result.error ? `${result.error.code} ${result.error.details ?? ''}`.trim() : 'ok')

const freeNames = (person: Person, party: Party) => person.client.rpc('guest_list', { p_join_code: party.join_code })
const claim = (person: Person, party: Party, name: string) =>
  person.client.rpc('claim_guest', { p_join_code: party.join_code, p_name: name })
const join = (person: Person, party: Party, name: string) =>
  person.client.rpc('join_session', { p_join_code: party.join_code, p_name: name })
const addGuests = (person: Person, party: Party, names: unknown) =>
  person.client.rpc('host_add_guests', { p_session_id: party.id, p_names: names })
const free = (person: Person, playerId: string) => person.client.rpc('host_free_guest', { p_player_id: playerId })

type Snapshot = {
  member: boolean
  moved: boolean
  freed: boolean
  players: { id: string; name: string; joined_at: number; created_at: number }[]
  standings: { player_id: string; name: string; points: number }[]
  guests: { id: string; name: string; joined_at: number | null; created_at: number }[] | null
}
async function snapshot(person: Person, party: Party, screen: 'phone' | 'tv' | 'host'): Promise<Snapshot> {
  const { data, error } = await person.client.rpc('session_snapshot', { p_session_id: party.id, p_screen: screen })
  expect(error).toBeNull()
  return data
}

type PlayerRow = {
  id: string
  name: string
  code: string
  user_id: string | null
  joined_at: string | null
  created_at: string
  profile: Record<string, unknown>
  photo: string | null
}
const playerRow = async (id: string) => (await rows<PlayerRow>('players', 'id', id))[0]

type LogRow = { id: number; kind: string; actor: string; player_id: string | null; data: Record<string, unknown> }
/** The party's log rows of these kinds after row `since`, oldest first. */
async function logOf(party: Party, kinds: string[], since = 0): Promise<LogRow[]> {
  const { data, error } = await admin
    .from('event_log')
    .select('id, kind, actor, player_id, data')
    .eq('session_id', party.id)
    .in('kind', kinds)
    .gt('id', since)
    .order('id')
  if (error) throw error
  return data
}
const lastLogId = async (party: Party): Promise<number> =>
  (await admin.from('event_log').select('id').eq('session_id', party.id).order('id', { ascending: false }).limit(1)).data?.[0]
    ?.id ?? 0

const setStatus = (party: Party, status: 'open' | 'closed') =>
  host.client.from('sessions').update({ status }).eq('id', party.id)
const archive = (party: Party) => host.client.from('sessions').update({ archived_at: new Date().toISOString() }).eq('id', party.id)

/** A party with these names on its guest list; returns their ids by name. */
async function listedParty(title: string, names: string[]): Promise<{ party: Party; ids: Record<string, string> }> {
  const party = await world.party(host, title)
  const { added } = await world.listGuests(host, party, names)
  return { party, ids: Object.fromEntries(added.map((g) => [g.name, g.id])) }
}

// Adding names ----------------------------------------------------------------------------

describe('host_add_guests', () => {
  it('adds names in order, stored clean, skips blank lines silently and says why it skipped the rest', async () => {
    const party = await world.party(host, 'Add test')
    await world.guest(party, 'Ana')
    const long = 'X'.repeat(41)
    const result = await world.listGuests(host, party, [
      '  Zelda  ',
      '',
      '   ',
      'Quentin',
      'zelda',
      'ANA',
      long,
      'Ximena\u00a0Holm',
    ])
    expect(result.added.map((g) => g.name)).toEqual(['Zelda', 'Quentin', 'Ximena Holm'])
    expect(result.skipped).toEqual([
      { name: 'zelda', reason: 'repeat' },
      { name: 'ANA', reason: 'taken' },
      { name: long, reason: 'too_long' },
    ])
    // A look-alike of a name in the party is that name: Ana with a Cyrillic A.
    expect(await world.listGuests(host, party, ['\u0410na', 'quentin'])).toEqual({
      added: [],
      skipped: [
        { name: '\u0410na', reason: 'taken' },
        { name: 'quentin', reason: 'taken' },
      ],
    })

    for (const guest of result.added) {
      expect(await playerRow(guest.id)).toMatchObject({ name: guest.name, user_id: null, joined_at: null })
    }
    const log = await logOf(party, ['guest.added'])
    expect(log.map((row) => [row.actor, row.data.name, row.player_id])).toEqual(
      result.added.map((g) => ['host', g.name, g.id]),
    )
  })

  it('refuses guests, TVs, unknown and archived parties, and more than 100 names at a time', async () => {
    const party = await world.party(host, 'Add refusals')
    const bo = await world.guest(party, 'Bo')
    const tv = await world.screen(host, party)
    expect(outcome(await addGuests(bo, party, ['Zelda']))).toBe('PT403 not_host')
    expect(outcome(await addGuests(tv, party, ['Zelda']))).toBe('PT403 not_host')
    expect(outcome(await anonClient().rpc('host_add_guests', { p_session_id: party.id, p_names: ['Zelda'] }))).toBe('42501')
    expect(outcome(await addGuests(host, { ...party, id: crypto.randomUUID() }, ['Zelda']))).toBe('PT404 not_found')
    const many = Array.from({ length: 101 }, (_, i) => `Guest ${i + 1}`)
    expect(outcome(await addGuests(host, party, many))).toBe('PT400 too_many')
    expect(outcome(await addGuests(host, party, null))).toBe('PT400 too_many')
    expect(outcome(await addGuests(host, party, many.slice(0, 100)))).toBe('ok')
    expect(outcome(await archive(party))).toBe('ok')
    expect(outcome(await addGuests(host, party, ['Zelda']))).toBe('PT409 archived')
    expect(await logOf(party, ['guest.added'])).toHaveLength(100)
  })

  it('holds at most 200 names that have not joined, and adds nothing from a paste that passes it', async () => {
    const party = await world.party(host, 'Add cap')
    await world.listGuests(host, party, Array.from({ length: 100 }, (_, i) => `A ${i + 1}`))
    await world.listGuests(host, party, Array.from({ length: 99 }, (_, i) => `B ${i + 1}`))
    const full = await addGuests(host, party, ['Late 1', 'Late 2'])
    expect(outcome(full)).toBe('PT409 list_full')
    expect(full.error?.message).toContain('1 more fit')
    const expected = async () =>
      (await admin.from('players').select('id', { count: 'exact', head: true }).eq('session_id', party.id).is('user_id', null))
        .count
    expect(await expected()).toBe(199)
    // A guest who joined frees a place: only names still expected count.
    await world.claimGuest(party, 'A 1')
    expect((await world.listGuests(host, party, ['Late 1', 'Late 2'])).added).toHaveLength(2)
    expect(await expected()).toBe(200)
  })
})

// The free names ---------------------------------------------------------------------------

describe('guest_list', () => {
  it('gives anyone signed in with the code the free names and nothing else, in name order', async () => {
    const { party } = await listedParty('Free names', ['Zelda', 'Bo', 'ana'])
    const stranger = await world.user()
    const { data, error } = await freeNames(stranger, party)
    expect(error).toBeNull()
    expect(data).toEqual(['ana', 'Bo', 'Zelda'])
    expect((data as unknown[]).every((name) => typeof name === 'string')).toBe(true)
    // Case and spaces of the code don't matter, as for session_by_code.
    expect((await stranger.client.rpc('guest_list', { p_join_code: ` ${party.join_code.toLowerCase()} ` })).data).toEqual([
      'ana',
      'Bo',
      'Zelda',
    ])

    await world.claimGuest(party, 'Bo')
    expect((await freeNames(stranger, party)).data).toEqual(['ana', 'Zelda'])
    await world.guest(party, 'Cy')
    expect((await freeNames(stranger, party)).data).toEqual(['ana', 'Zelda'])
  })

  it('is empty while joining is closed or the party is over, null for an unknown code, and refused without a user', async () => {
    const { party } = await listedParty('Free names, closed', ['Zelda'])
    const stranger = await world.user()
    await setStatus(party, 'closed')
    expect((await freeNames(stranger, party)).data).toEqual([])
    await setStatus(party, 'open')
    expect((await freeNames(stranger, party)).data).toEqual(['Zelda'])
    await archive(party)
    expect((await freeNames(stranger, party)).data).toEqual([])
    expect((await stranger.client.rpc('guest_list', { p_join_code: 'NOPE42' })).data).toBeNull()
    expect(outcome(await anonClient().rpc('guest_list', { p_join_code: party.join_code }))).toBe('42501')
  })
})

// Taking a name ----------------------------------------------------------------------------

describe('claim_guest', () => {
  let party: Party
  let ids: Record<string, string>
  let ana: Guest

  beforeAll(async () => {
    ;({ party, ids } = await listedParty('Claims', ['Ana', 'Bo', 'Cy', 'Dee']))
  })

  it('takes a name: the same id, now the caller, joined now, logged as a listed join by the player', async () => {
    const before = await playerRow(ids.Ana)
    ana = await world.claimGuest(party, 'Ana')
    expect(ana.playerId).toBe(ids.Ana)
    const after = await playerRow(ids.Ana)
    expect(after).toMatchObject({ user_id: ana.userId, name: 'Ana', code: before.code, created_at: before.created_at })
    expect(after.joined_at).not.toBeNull()
    expect(new Date(after.joined_at!).getTime()).toBeGreaterThan(new Date(before.created_at).getTime())
    const [joined] = await logOf(party, ['player.joined'])
    expect(joined).toMatchObject({ actor: 'player', player_id: ids.Ana, data: { name: 'Ana', player_id: ids.Ana, listed: true } })
    expect(await snapshot(ana, party, 'phone')).toMatchObject({ member: true, freed: false })
  })

  it('refuses a name someone took, a second name, and any name after joining by typing', async () => {
    const other = await world.user()
    const taken = await claim(other, party, 'Ana')
    expect(outcome(taken)).toBe('PT409 guest_taken')
    expect(taken.error?.message).toBe("Someone just took Ana. If that's you, ask the host to free your name.")
    // The same phone again (a retry) gets its player back; another name is a second one.
    expect((await claim(ana, party, 'ana')).data).toMatchObject({ id: ids.Ana, user_id: ana.userId })
    expect(outcome(await claim(ana, party, 'Bo'))).toBe('PT409 already_player')
    const typed = await world.guest(party, 'Eve')
    expect(outcome(await claim(typed, party, 'Bo'))).toBe('PT409 already_player')
    expect((await playerRow(ids.Bo)).user_id).toBeNull()
  })

  it('lets exactly one of five phones take a name they all tap at once', async () => {
    const phones = await Promise.all(Array.from({ length: 5 }, () => world.user()))
    const results = await Promise.all(phones.map((phone) => claim(phone, party, 'Cy')))
    const outcomes = results.map(outcome)
    expect(outcomes.filter((o) => o === 'ok')).toHaveLength(1)
    expect(outcomes.filter((o) => o === 'PT409 guest_taken')).toHaveLength(4)
    const winner = phones[outcomes.indexOf('ok')]
    expect((await playerRow(ids.Cy)).user_id).toBe(winner.userId)
    expect((await logOf(party, ['player.joined'])).filter((row) => row.player_id === ids.Cy)).toHaveLength(1)
  })

  it('lets one phone take only one of two names it taps at once (two tabs)', async () => {
    const { party: twoTabs } = await listedParty('Claims, two tabs', ['Fay', 'Gus'])
    const phone = await world.user()
    const results = (await Promise.all([claim(phone, twoTabs, 'Fay'), claim(phone, twoTabs, 'Gus')])).map(outcome)
    expect(results.sort()).toEqual(['PT409 already_player', 'ok'])
    const { count } = await admin
      .from('players')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', twoTabs.id)
      .eq('user_id', phone.userId)
    expect(count).toBe(1)
  })

  it('refuses while joining is closed or the party is over, an unknown or blank name, and without a user', async () => {
    const phone = await world.user()
    await setStatus(party, 'closed')
    expect(outcome(await claim(phone, party, 'Dee'))).toBe('PT409 closed')
    await setStatus(party, 'open')
    const unknown = await claim(phone, party, 'Nobody')
    expect(outcome(unknown)).toBe('PT404 not_on_list')
    expect(unknown.error?.message).toBe("Nobody isn't on the guest list any more. Pick your name again.")
    expect(outcome(await claim(phone, party, ' \u200b '))).toBe('PT400 bad_name')
    expect(outcome(await phone.client.rpc('claim_guest', { p_join_code: 'NOPE42', p_name: 'Dee' }))).toBe('PT404 not_found')
    expect(outcome(await anonClient().rpc('claim_guest', { p_join_code: party.join_code, p_name: 'Dee' }))).toBe('42501')
    // The secret key has no user: refused as signed out.
    expect(outcome(await admin.rpc('claim_guest', { p_join_code: party.join_code, p_name: 'Dee' }))).toBe('PT401 not_signed_in')
    await archive(party)
    expect(outcome(await claim(phone, party, 'Dee'))).toBe('PT409 archived')
    expect((await playerRow(ids.Dee)).user_id).toBeNull()
  })
})

// Typing a listed name ------------------------------------------------------------------------

describe('join_session with a guest list', () => {
  it('offers a free listed name for a typed one that matches it, look-alikes included', async () => {
    const { party } = await listedParty('Typed names', ['Ana', 'Bo'])
    const phone = await world.user()
    for (const typed of ['ANA', ' ana ', '\u0410na']) {
      const result = await join(phone, party, typed)
      expect(outcome(result)).toBe('PT409 on_list')
      expect(result.error?.hint).toBe('Ana')
      expect(result.error?.message).toBe('"Ana" is on the guest list. If that\'s you, pick it from the list.')
    }
    // Any other name joins exactly as before.
    expect((await join(phone, party, 'Cy')).data).toMatchObject({ name: 'Cy', user_id: phone.userId })
    // A listed name someone took is taken, as any joined name is.
    await world.claimGuest(party, 'Bo')
    expect(outcome(await join(await world.user(), party, 'bo'))).toBe('PT409 name_taken')
  })
})

// What each screen sees ------------------------------------------------------------------------

describe('what each screen sees', () => {
  let party: Party
  let ana: Guest
  let bo: Guest
  let quentin: Guest
  let tv: Person

  beforeAll(async () => {
    party = await world.party(host, 'Screens')
    ana = await world.guest(party, 'Ana')
    await world.listGuests(host, party, ['Quentin', 'Zelda', 'Ulrik'])
    bo = await world.guest(party, 'Bo')
    // Listed before Bo joined, joins after him.
    quentin = await world.claimGuest(party, 'Quentin')
    tv = await world.screen(host, party)
    await host.client.from('score_events').insert({ session_id: party.id, player_id: bo.playerId, points: 3 })
  })

  it('phones and TVs see only the guests who joined, in join order, and no guest list', async () => {
    for (const [person, screen] of [
      [ana, 'phone'],
      [tv, 'tv'],
    ] as const) {
      const snap = await snapshot(person, party, screen)
      expect(snap.players.map((p) => p.name)).toEqual(['Ana', 'Bo', 'Quentin'])
      expect(snap.players.every((p) => typeof p.joined_at === 'number')).toBe(true)
      expect(snap.standings.map((s) => s.name).sort()).toEqual(['Ana', 'Bo', 'Quentin'])
      expect(snap.guests).toBeNull()
      expect(snap.freed).toBe(false)
    }
  })

  it('the host sees the same players, and the whole list only under guests', async () => {
    const snap = await snapshot(host, party, 'host')
    expect(snap.players.map((p) => p.name)).toEqual(['Ana', 'Bo', 'Quentin'])
    expect(snap.standings.map((s) => s.name).sort()).toEqual(['Ana', 'Bo', 'Quentin'])
    expect(snap.guests!.map((g) => [g.name, g.joined_at === null])).toEqual([
      ['Ana', false],
      ['Bo', false],
      ['Quentin', false],
      ['Ulrik', true],
      ['Zelda', true],
    ])
    expect(snap.guests!.find((g) => g.name === 'Quentin')!.joined_at).toBe(snap.players[2].joined_at)
    // The host page's TV tab is a TV: no list there either.
    expect((await snapshot(host, party, 'tv')).guests).toBeNull()
  })

  it('guests and TVs read only joined rows; the host reads every row, and the scoreboard keeps to joined guests', async () => {
    const names = async (person: Person, table: 'players' | 'scoreboard') =>
      ((await person.client.from(table).select('name').eq('session_id', party.id)).data ?? []).map((r) => r.name).sort()
    expect(await names(ana, 'players')).toEqual(['Ana', 'Bo', 'Quentin'])
    expect(await names(quentin, 'players')).toEqual(['Ana', 'Bo', 'Quentin'])
    expect(await names(tv, 'players')).toEqual(['Ana', 'Bo', 'Quentin'])
    expect(await names(host, 'players')).toEqual(['Ana', 'Bo', 'Quentin', 'Ulrik', 'Zelda'])
    expect(await names(host, 'scoreboard')).toEqual(['Ana', 'Bo', 'Quentin'])
    expect(await names(ana, 'scoreboard')).toEqual(['Ana', 'Bo', 'Quentin'])
  })

  it('the recap counts the guests who came', async () => {
    const { data, error } = await host.client.rpc('session_recap', { p_session_id: party.id })
    expect(error).toBeNull()
    expect(data.players.map((p: { name: string }) => p.name)).toEqual(['Ana', 'Bo', 'Quentin'])
    expect(data.standings.map((s: { name: string }) => s.name).sort()).toEqual(['Ana', 'Bo', 'Quentin'])
    const quentinRow = data.players.find((p: { name: string }) => p.name === 'Quentin')
    expect(quentinRow.joined_at).toBe((await snapshot(host, party, 'host')).players[2].joined_at)
  })
})

// Games -------------------------------------------------------------------------------------------

describe('games and guests still expected', () => {
  let party: Party
  let ana: Guest
  let bo: Guest
  let ids: Record<string, string>

  beforeAll(async () => {
    party = await world.party(host, 'Games')
    ana = await world.guest(party, 'Ana')
    bo = await world.guest(party, 'Bo')
    ids = Object.fromEntries((await world.listGuests(host, party, ['Zelda', 'Ulrik'])).added.map((g) => [g.name, g.id]))
  })

  it('game_load lists them under guests only; a game deals, views and scores only the guests who joined', async () => {
    const gameId = await world.game(host, party, 'probe', 'Probe', { movesToWin: 3, seconds: 10 })
    expect((await engine(host, { type: 'start', gameId, stage: false })).status).toBe(200)
    expect((await engine(ana, { type: 'action', gameId, action: { type: 'move' } })).status).toBe(200)

    const { data: loaded, error } = await admin.rpc('game_load', { p_game_id: gameId, p_user_id: host.userId })
    expect(error).toBeNull()
    expect(loaded.players.map((p: { id: string }) => p.id)).toEqual([ana.playerId, bo.playerId])
    expect(loaded.players.every((p: { joined_at: unknown }) => typeof p.joined_at === 'number')).toBe(true)
    expect(loaded.guests).toEqual([
      { id: ana.playerId, name: 'Ana', joined: true },
      { id: bo.playerId, name: 'Bo', joined: true },
      { id: ids.Zelda, name: 'Zelda', joined: false },
      { id: ids.Ulrik, name: 'Ulrik', joined: false },
    ])
    expect(typeof loaded.current.saved_at).toBe('number')
    expect(Object.keys(loaded.scoreboard).sort()).toEqual([ana.playerId, bo.playerId].sort())

    const [state] = await rows<{ members: string[] }>('game_states', 'game_id', gameId)
    expect(state.members.sort()).toEqual([ana.playerId, bo.playerId].sort())
    const views = await rows<{ player_id: string }>('game_player_views', 'game_id', gameId)
    expect(views.map((v) => v.player_id).sort()).toEqual([ana.playerId, bo.playerId].sort())
    const scores = await rows<{ player_id: string }>('game_scores', 'game_id', gameId)
    expect(scores.map((s) => s.player_id)).toEqual([ana.playerId])
  })

  it("a 'players' answer can't name a guest still expected; a 'guests' answer can", async () => {
    const gameId = await world.game(host, party, 'lab', 'Lab')
    await engine(host, { type: 'start', gameId, stage: false })
    const open = (key: string, options: string) =>
      engine(host, {
        type: 'host-action',
        gameId,
        action: { type: 'open', key, spec: { kind: 'choice', options, exclude_self: true } },
      })
    expect((await open('who', 'players')).status).toBe(200)
    expect((await open('anyone', 'guests')).status).toBe(200)
    const answer = (guest: Guest, key: string, choice: string) =>
      guest.client.rpc('submit_answer', { p_game_id: gameId, p_key: key, p_payload: { choice }, p_request_id: crypto.randomUUID() })

    expect(outcome(await answer(ana, 'who', ids.Zelda))).toBe('PT400 answer_invalid')
    expect(outcome(await answer(ana, 'who', bo.playerId))).toBe('ok')
    expect(outcome(await answer(ana, 'anyone', ids.Zelda))).toBe('ok')
    expect(outcome(await answer(bo, 'anyone', ana.playerId))).toBe('ok')
    expect(outcome(await answer(bo, 'anyone', bo.playerId))).toBe('PT400 answer_invalid')
    expect(outcome(await answer(bo, 'anyone', crypto.randomUUID()))).toBe('PT400 answer_invalid')
  })
})

describe('a name freed and taken again while a game runs', () => {
  it('leaves as the old person and joins as the new one at the next save', async () => {
    const { party } = await listedParty('Re-join', ['Ana'])
    const ana = await world.claimGuest(party, 'Ana')
    const bo = await world.guest(party, 'Bo')
    const gameId = await world.game(host, party, 'probe', 'Probe', { movesToWin: 9, seconds: 10 })
    await engine(host, { type: 'start', gameId, stage: false })
    expect((await engine(ana, { type: 'action', gameId, action: { type: 'move' } })).status).toBe(200)

    // No save in between (the host page's sync didn't run): the id is back in the party under a new person.
    expect(outcome(await free(host, ana.playerId))).toBe('ok')
    expect(await rows('game_scores', 'player_id', ana.playerId)).toEqual([])
    expect(await rows('game_player_views', 'player_id', ana.playerId)).toEqual([])
    const next = await world.claimGuest(party, 'Ana')
    expect(next.playerId).toBe(ana.playerId)
    expect((await engine(bo, { type: 'action', gameId, action: { type: 'move' } })).status).toBe(200)

    const [state] = await rows<{ state: { joined: string[]; left: string[] }; members: string[] }>('game_states', 'game_id', gameId)
    expect(state.state.left).toEqual([ana.playerId])
    expect(state.state.joined).toEqual([ana.playerId])
    expect(state.members.sort()).toEqual([ana.playerId, bo.playerId].sort())
    const { data: effects } = await admin
      .from('event_log')
      .select('data')
      .eq('game_id', gameId)
      .eq('kind', 'game.effects')
      .not('data->members', 'is', null)
    expect(effects?.map((row) => row.data.members)).toEqual([{ joined: [ana.playerId], left: [ana.playerId] }])
    // The new person has a view again. What the game kept for the id is the
    // game's to drop on leave (the probe keeps its moves, so it scores them).
    expect((await rows('game_player_views', 'player_id', ana.playerId)).length).toBe(1)

    // The next save is an ordinary one.
    expect((await engine(next, { type: 'action', gameId, action: { type: 'move' } })).status).toBe(200)
    const [after] = await rows<{ state: { joined: string[]; left: string[] } }>('game_states', 'game_id', gameId)
    expect(after.state).toMatchObject({ joined: [ana.playerId], left: [ana.playerId] })
  })
})

// The commit race ------------------------------------------------------------------------------------

describe('a save that races a free', () => {
  it('writes nothing for a guest freed between its load and its commit, and the rest as usual', async () => {
    const { party } = await listedParty('Commit race', ['Ana'])
    const ana = await world.claimGuest(party, 'Ana')
    const cy = await world.guest(party, 'Cy')
    const gameId = await world.game(host, party, 'lab', 'Lab')
    await engine(host, { type: 'start', gameId, stage: false })

    const { data: loaded } = await admin.rpc('game_load', { p_game_id: gameId, p_user_id: host.userId })
    expect(outcome(await free(host, ana.playerId))).toBe('ok')
    const { error } = await admin.rpc('game_commit', {
      p: {
        game_id: gameId,
        request: { id: crypto.randomUUID(), user_id: host.userId, type: 'host-action', actor: 'host', player_id: null, action: { type: 'noop' }, close: [] },
        expected_version: loaded.current.version,
        expected_round: loaded.current.round,
        status: null,
        finished_by: null,
        stage: null,
        state: loaded.current.state,
        members: [ana.playerId, cy.playerId],
        public_state: { raced: true },
        player_views: { [ana.playerId]: { mine: 'ana' }, [cy.playerId]: { mine: 'cy' } },
        scores: { [ana.playerId]: 5, [cy.playerId]: 3 },
        wake_at: null,
        effects: {
          points: [
            { player_id: ana.playerId, points: 2, reason: 'Raced' },
            { player_id: cy.playerId, points: 1, reason: 'Raced' },
          ],
          profiles: { [ana.playerId]: { badge: 'ana' }, [cy.playerId]: { badge: 'cy' } },
          announcements: [
            { message: 'Only for Ana', to: [ana.playerId] },
            { message: 'For both', to: [ana.playerId, cy.playerId] },
          ],
          records: [],
          prompts: { open: [], close: [], reveal: [] },
        },
        log: { joined: [], left: [], woke: 0 },
      },
    })
    expect(error).toBeNull()

    expect((await rows<{ player_id: string }>('game_player_views', 'game_id', gameId)).map((v) => v.player_id)).toEqual([
      cy.playerId,
    ])
    expect((await rows<{ player_id: string; points: number }>('game_scores', 'game_id', gameId)).map((s) => [s.player_id, s.points])).toEqual([
      [cy.playerId, 3],
    ])
    expect((await rows<{ player_id: string }>('score_events', 'session_id', party.id)).map((e) => e.player_id)).toEqual([cy.playerId])
    expect((await playerRow(ana.playerId)).profile).toEqual({})
    expect((await playerRow(cy.playerId)).profile).toEqual({ lab: { badge: 'cy' } })
    const feed = await rows<{ message: string; audience: string[] | null }>('session_feed', 'session_id', party.id)
    expect(feed.map((f) => [f.message, f.audience])).toEqual([['For both', [cy.playerId]]])
    expect((await rows<{ public_state: unknown }>('session_games', 'id', gameId))[0].public_state).toEqual({ raced: true })
  })
})

// Freeing a name ---------------------------------------------------------------------------------------

describe('host_free_guest', () => {
  const PHOTOS = 'player-photos'
  const uploaded: string[] = []

  afterAll(async () => {
    if (uploaded.length > 0) await admin.storage.from(PHOTOS).remove(uploaded)
  })

  /** A JPEG's first and last bytes: Storage and set_my_photo check the stated type and size, not the picture. */
  function jpeg(): Blob {
    const bytes = new Uint8Array(14)
    bytes.set([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1])
    bytes.set([0xff, 0xd9], 12)
    return new Blob([bytes], { type: 'image/jpeg' })
  }

  it('puts a joined guest back on the list as expected, same id, and everything the taker earned goes', async () => {
    const { party } = await listedParty('Free', ['Ana', 'Bo'])
    const ana = await world.claimGuest(party, 'Ana')
    const cy = await world.guest(party, 'Cy')
    const before = await playerRow(ana.playerId)

    // An award, a game score and a view, an answer, a profile, a photo, a move code and two toasts.
    await host.client.from('score_events').insert({ session_id: party.id, player_id: ana.playerId, points: 4 })
    const gameId = await world.game(host, party, 'lab', 'Lab')
    await engine(host, { type: 'start', gameId, stage: false })
    await engine(host, { type: 'host-action', gameId, action: { type: 'open', key: 'q', spec: { kind: 'choice', options: ['a', 'b'] } } })
    await ana.client.rpc('submit_answer', { p_game_id: gameId, p_key: 'q', p_payload: { choice: 'a' }, p_request_id: crypto.randomUUID() })
    // Revealed: the lab scores each revealed answer, so Ana has a game score too.
    expect((await engine(host, { type: 'host-action', gameId, action: { type: 'reveal', key: 'q' }, close: ['q'] })).status).toBe(200)
    await engine(host, { type: 'host-action', gameId, action: { type: 'announce', message: 'Ana only', to: [ana.playerId] } })
    await engine(host, { type: 'host-action', gameId, action: { type: 'announce', message: 'Ana and Cy', to: [ana.playerId, cy.playerId] } })
    await admin.from('players').update({ profile: { lab: { badge: true } } }).eq('id', ana.playerId)
    const path = `${party.id}/${ana.playerId}/${crypto.randomUUID()}.jpg`
    uploaded.push(path)
    expect((await ana.client.storage.from(PHOTOS).upload(path, jpeg(), { contentType: 'image/jpeg', upsert: false, cacheControl: '3600' })).error).toBeNull()
    expect(outcome(await ana.client.rpc('set_my_photo', { p_player_id: ana.playerId, p_path: path }))).toBe('ok')
    expect(outcome(await host.client.rpc('host_issue_transfer', { p_player_id: ana.playerId }))).toBe('ok')
    expect((await snapshot(ana, party, 'phone')).standings.find((s) => s.player_id === ana.playerId)?.points).toBe(5)
    expect((await rows('game_scores', 'player_id', ana.playerId)).length).toBe(1)
    expect((await rows('game_submissions', 'player_id', ana.playerId)).length).toBe(1)
    expect((await rows('game_player_views', 'player_id', ana.playerId)).length).toBe(1)

    const since = await lastLogId(party)
    const freed = await free(host, ana.playerId)
    expect(freed).toMatchObject({ data: { id: ana.playerId, name: 'Ana', previous_photo: path }, error: null })

    const after = await playerRow(ana.playerId)
    expect(after).toMatchObject({
      id: ana.playerId,
      name: 'Ana',
      created_at: before.created_at,
      user_id: null,
      joined_at: null,
      profile: {},
      photo: null,
    })
    expect(after.code).not.toBe(before.code)
    for (const table of ['score_events', 'game_scores', 'game_player_views', 'game_submissions', 'player_transfers']) {
      expect(await rows(table, 'player_id', ana.playerId), table).toEqual([])
    }
    const feed = await rows<{ message: string; audience: string[] | null }>('session_feed', 'session_id', party.id)
    expect(feed.filter((f) => f.audience !== null).map((f) => [f.message, f.audience])).toEqual([['Ana and Cy', [cy.playerId]]])

    const log = await admin.from('event_log').select('kind, actor, player_id, data').eq('session_id', party.id).gt('id', since).order('id')
    expect(log.data).toEqual([
      { kind: 'player.freed', actor: 'host', player_id: ana.playerId, data: { name: 'Ana', player_id: ana.playerId, from_user: ana.userId } },
    ])

    // The phone that had the name reads that it was freed, not moved.
    expect(await snapshot(ana, party, 'phone')).toMatchObject({ member: false, freed: true, moved: false })
    const hostView = await snapshot(host, party, 'host')
    expect(hostView.players.map((p) => p.name)).toEqual(['Cy'])
    expect(hostView.guests!.find((g) => g.id === ana.playerId)).toMatchObject({ name: 'Ana', joined_at: null })
    expect((await freeNames(cy, party)).data).toEqual(['Ana', 'Bo'])

    // Someone else takes it, with nothing of the earlier taker's.
    const next = await world.claimGuest(party, 'Ana')
    expect(next.playerId).toBe(ana.playerId)
    expect((await snapshot(next, party, 'phone')).standings.find((s) => s.player_id === ana.playerId)?.points).toBe(0)
    expect(await snapshot(ana, party, 'phone')).toMatchObject({ member: false, freed: true })
  })

  it('refuses guests, a name nobody took and an unknown id', async () => {
    const { party, ids } = await listedParty('Free refusals', ['Zelda'])
    const cy = await world.guest(party, 'Cy')
    expect(outcome(await free(cy, cy.playerId))).toBe('PT403 not_host')
    const notJoined = await free(host, ids.Zelda)
    expect(outcome(notJoined)).toBe('PT409 not_joined')
    expect(notJoined.error?.message).toBe('Zelda is already free')
    expect(outcome(await free(host, crypto.randomUUID()))).toBe('PT404 not_found')
    expect(outcome(await anonClient().rpc('host_free_guest', { p_player_id: cy.playerId }))).toBe('42501')
    expect((await playerRow(cy.playerId)).user_id).toBe(cy.userId)
  })
})

// Exits, renames and removals -------------------------------------------------------------------------

describe('exits and the list in the log', () => {
  it('a phone removed after a move reads removed, not moved; a removed row names the user it had', async () => {
    const party = await world.party(host, 'Exits')
    const cy = await world.guest(party, 'Cy')
    const { data: code } = await host.client.rpc('host_issue_transfer', { p_player_id: cy.playerId })
    expect(outcome(await (await world.user()).client.rpc('claim_player', { p_code: code }))).toBe('ok')
    expect(await snapshot(cy, party, 'phone')).toMatchObject({ member: false, moved: true, freed: false })

    // The old phone joins again with a new name, and the host removes it.
    const again = (await join(cy, party, 'Cy again')).data as { id: string }
    expect(outcome(await host.client.from('players').delete().eq('id', again.id))).toBe('ok')
    expect(await snapshot(cy, party, 'phone')).toMatchObject({ member: false, moved: false, freed: false })
    const [removed] = await logOf(party, ['player.removed'])
    expect(removed).toMatchObject({ actor: 'host', data: { name: 'Cy again', player_id: again.id, from_user: cy.userId } })
  })

  it('the host renames and removes a guest still expected directly; guests change nothing; the log says guest.*', async () => {
    const { party, ids } = await listedParty('Renames', ['Zelda', 'Ulrik'])
    const ana = await world.guest(party, 'Ana')
    expect(outcome(await host.client.from('players').update({ name: ' Zelda  K. ' }).eq('id', ids.Zelda))).toBe('ok')
    expect((await playerRow(ids.Zelda)).name).toBe('Zelda K.')
    expect(outcome(await host.client.from('players').update({ name: 'ana' }).eq('id', ids.Zelda))).toBe('23505')

    // A guest's direct writes reach nothing (the policies are the host's), and no client may write joined_at or user_id.
    await ana.client.from('players').update({ name: 'Hacked' }).eq('id', ids.Ulrik)
    await ana.client.from('players').delete().eq('id', ids.Ulrik)
    expect((await playerRow(ids.Ulrik)).name).toBe('Ulrik')
    for (const change of [{ joined_at: new Date().toISOString() }, { user_id: ana.userId }]) {
      expect(outcome(await host.client.from('players').update(change).eq('id', ids.Ulrik))).toBe('42501')
      expect(outcome(await ana.client.from('players').update(change).eq('id', ana.playerId))).toBe('42501')
    }
    expect(outcome(await host.client.from('players').insert({ session_id: party.id, name: 'Sneaky' }))).toBe('42501')

    expect(outcome(await host.client.from('players').delete().eq('id', ids.Ulrik))).toBe('ok')
    expect(await playerRow(ids.Ulrik)).toBeUndefined()
    const log = await logOf(party, ['guest.renamed', 'guest.removed', 'player.renamed', 'player.removed'])
    expect(log.map((row) => [row.kind, row.actor, row.data])).toEqual([
      ['guest.renamed', 'host', { name: 'Zelda K.', player_id: ids.Zelda, from: 'Zelda' }],
      ['guest.removed', 'host', { name: 'Ulrik', player_id: ids.Ulrik }],
    ])
  })

  it("the host room's Remove from the list deletes a name nobody took, and never a guest who just took it", async () => {
    // removeGuest in src/lib/queries.ts: the delete keeps to rows still expected and reads back what it deleted.
    const removeGuest = (id: string) => host.client.from('players').delete().eq('id', id).is('joined_at', null).select('id')
    const { party, ids } = await listedParty('Remove from the list', ['Zelda', 'Ulrik'])
    expect((await removeGuest(ids.Zelda)).data).toEqual([{ id: ids.Zelda }])
    expect(await playerRow(ids.Zelda)).toBeUndefined()
    const ulrik = await world.user()
    expect(outcome(await claim(ulrik, party, 'Ulrik'))).toBe('ok')
    const late = await removeGuest(ids.Ulrik)
    expect([late.error, late.data]).toEqual([null, []])
    expect((await playerRow(ids.Ulrik)).user_id).toBe(ulrik.userId)
    const log = await logOf(party, ['guest.removed', 'player.removed'])
    expect(log.map((row) => [row.kind, row.data.name])).toEqual([['guest.removed', 'Zelda']])
  })

  it("a move code the host issued for a guest still expected joins the phone that uses it", async () => {
    const { party, ids } = await listedParty('Move code on the list', ['Ulrik'])
    const { data: code, error } = await host.client.rpc('host_issue_transfer', { p_player_id: ids.Ulrik })
    expect(error).toBeNull()
    const phone = await world.user()
    expect((await phone.client.rpc('claim_player', { p_code: code })).data).toMatchObject({ id: ids.Ulrik, user_id: phone.userId })
    expect((await playerRow(ids.Ulrik)).joined_at).not.toBeNull()
    const log = await logOf(party, ['player.joined', 'player.moved'])
    expect(log.map((row) => [row.kind, row.actor, row.data.listed])).toEqual([['player.joined', 'player', true]])
    expect((await snapshot(phone, party, 'phone')).players.map((p) => p.name)).toEqual(['Ulrik'])
  })
})
