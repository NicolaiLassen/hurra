// The secrecy matrix (docs/engine-v2.md, 9.2): what a guest, another guest,
// a paired TV, a signed-in outsider, anon and a host can read and write.
// Row level security and the grants decide; these tests prove it.
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { admin, anonClient, engine, rows, SUPABASE_URL, World, type Guest, type Party, type Person } from './testUsers'

const SECRET = 'TOP-SECRET-ANSWER'
const world = new World()
let host: Person
let party: Party
let ana: Guest
let bo: Guest
let tv: Person
let outsider: Person
let gameId: string
let finishedId: string

const lab = (game: string, action: unknown, close?: string[]) => engine(host, { type: 'host-action', gameId: game, action, close })

beforeAll(async () => {
  host = await world.host()
  party = await world.party(host, 'Secrets test')
  ana = await world.guest(party, 'Ana')
  bo = await world.guest(party, 'Bo')
  tv = await world.screen(host, party)
  outsider = await world.user()

  // A finished game Ana answered in, then a live one with a hidden setting, a prompt she answered and a toast just for her.
  finishedId = await world.game(host, party, 'lab', 'Earlier')
  await engine(host, { type: 'start', gameId: finishedId, stage: false })
  await lab(finishedId, { type: 'open', key: 'old', spec: { kind: 'choice', options: ['a', 'b'] } })
  await ana.client.rpc('submit_answer', { p_game_id: finishedId, p_key: 'old', p_payload: { choice: 'a' }, p_request_id: crypto.randomUUID() })
  await engine(host, { type: 'end', gameId: finishedId })

  gameId = await world.game(host, party, 'lab', 'Secret', { secret: SECRET })
  expect((await engine(host, { type: 'start', gameId, stage: true })).status).toBe(200)
  await lab(gameId, { type: 'open', key: 'p1', spec: { kind: 'choice', options: ['a', 'b'] } })
  await ana.client.rpc('submit_answer', { p_game_id: gameId, p_key: 'p1', p_payload: { choice: 'b' }, p_request_id: crypto.randomUUID() })
  await lab(gameId, { type: 'announce', message: 'For Ana only', to: [ana.playerId] })
  await lab(gameId, { type: 'announce', message: 'For everyone' })
  await host.client.from('session_recaps').insert({ session_id: party.id, data: { draft: true } })
  await host.client.rpc('host_issue_transfer', { p_player_id: bo.playerId })
})

afterAll(() => world.cleanup())

async function read(client: SupabaseClient, table: string, filter: [string, string] = ['session_id', party.id]) {
  const { data, error } = await client.from(table).select('*').eq(filter[0], filter[1])
  return error ? `error ${error.code}` : (data ?? []).length
}

describe('hidden tables', () => {
  it('give a guest and a paired TV nothing: settings, state, the log, the one-off codes', async () => {
    for (const person of [ana, bo, tv]) {
      expect(await read(person.client, 'game_settings', ['game_id', gameId])).toBe(0)
      expect(await read(person.client, 'game_states', ['game_id', gameId])).toBe(0)
      expect(await read(person.client, 'event_log')).toBe(0)
      expect(await read(person.client, 'session_screens')).toBe(0)
      expect(await read(person.client, 'player_transfers', ['player_id', bo.playerId])).toBe('error 42501')
      expect(await read(person.client, 'screen_codes')).toBe('error 42501')
      expect(await read(person.client, 'hosts', ['user_id', host.userId])).toBe('error 42501')
      // The recap is a draft (not published).
      expect(await read(person.client, 'session_recaps')).toBe(0)
    }
    // The host reads them all.
    expect(await read(host.client, 'game_settings', ['game_id', gameId])).toBe(1)
    expect(await read(host.client, 'game_states', ['game_id', gameId])).toBe(1)
    expect(await read(host.client, 'session_recaps')).toBe(1)
  })

  it("give each guest only their own views, answers and toasts", async () => {
    const views = async (person: Person) =>
      ((await person.client.from('game_player_views').select('player_id').eq('game_id', gameId)).data ?? []).map((r) => r.player_id)
    expect(await views(ana)).toEqual([ana.playerId])
    expect(await views(bo)).toEqual([bo.playerId])
    expect(await views(tv)).toEqual([])

    const answers = async (person: Person) => (await person.client.from('game_submissions').select('player_id').eq('game_id', gameId)).data ?? []
    expect(await answers(ana)).toEqual([{ player_id: ana.playerId }])
    expect(await answers(bo)).toEqual([])
    expect(await answers(tv)).toEqual([])

    const feed = async (person: Person) =>
      ((await person.client.from('session_feed').select('message').eq('session_id', party.id)).data ?? []).map((r) => r.message)
    expect(await feed(ana)).toContain('For Ana only')
    expect(await feed(bo)).not.toContain('For Ana only')
    expect(await feed(bo)).toContain('For everyone')
    expect(await feed(tv)).not.toContain('For Ana only')
  })
})

describe('session_snapshot', () => {
  it('gives no host data to a guest or a TV, whatever screen they ask for', async () => {
    for (const person of [ana, bo, tv]) {
      for (const screen of ['host', 'tv', 'phone']) {
        const { data, error } = await person.client.rpc('session_snapshot', { p_session_id: party.id, p_screen: screen })
        expect(error).toBeNull()
        expect(data.member).toBe(true)
        expect(data.states).toBeNull()
        expect(data.screens).toBeNull()
        const messages = data.feed.map((f: { message: string }) => f.message)
        if (person === ana && screen === 'phone') expect(messages).toContain('For Ana only')
        else expect(messages).not.toContain('For Ana only')
        if (screen !== 'phone' || person === tv) expect(data.me).toBeNull()
        expect(JSON.stringify(data)).not.toContain(SECRET)
      }
    }
  })

  it("covers a phone's own views for the shown games and its answers for live games only", async () => {
    const { data: mine } = await ana.client.rpc('session_snapshot', { p_session_id: party.id, p_screen: 'phone' })
    expect(mine.me.player_id).toBe(ana.playerId)
    expect(Object.keys(mine.me.views).sort()).toEqual([finishedId, gameId].sort())
    expect(mine.me.answers).toEqual({ [gameId]: { p1: { choice: ['b'] } } })
    const { data: his } = await bo.client.rpc('session_snapshot', { p_session_id: party.id, p_screen: 'phone' })
    expect(his.me.answers).toEqual({})
    expect(JSON.stringify(his)).not.toContain(ana.playerId + '":{"p1"')
  })

  it('gives the host the full state and the paired screens', async () => {
    const { data } = await host.client.rpc('session_snapshot', { p_session_id: party.id, p_screen: 'host' })
    expect(Object.keys(data.states)).toEqual([gameId])
    expect(data.states[gameId].state.secret).toBe(SECRET)
    expect(data.screens).toBe(1)
    expect(data.feed.map((f: { message: string }) => f.message)).not.toContain('For Ana only')
  })

  it('says member: false to an outsider, and exists: false for a party that is gone', async () => {
    const { data } = await outsider.client.rpc('session_snapshot', { p_session_id: party.id, p_screen: 'phone' })
    expect(data).toMatchObject({ member: false, exists: true, session: null, games: [], players: [], me: null, moved: false })
    const gone = await outsider.client.rpc('session_snapshot', { p_session_id: crypto.randomUUID(), p_screen: 'tv' })
    expect(gone.data).toMatchObject({ member: false, exists: false })
  })
})

describe('the recap and the public rows', () => {
  it('refuses the raw recap to a guest and a TV', async () => {
    for (const person of [ana, tv]) {
      const { error } = await person.client.rpc('session_recap', { p_session_id: party.id })
      expect(error).toMatchObject({ code: 'PT403', details: 'not_host' })
    }
  })

  it('keeps a secret setting out of every public row: the public state, prompt specs and the feed', async () => {
    const pub = JSON.stringify([
      (await ana.client.from('session_games').select('public_state').eq('session_id', party.id)).data,
      (await ana.client.from('game_prompts').select('spec').eq('game_id', gameId)).data,
      (await ana.client.from('session_feed').select('*').eq('session_id', party.id)).data,
      (await ana.client.from('game_player_views').select('view').eq('game_id', gameId)).data,
    ])
    expect(pub).not.toContain(SECRET)
    expect(JSON.stringify((await rows('game_states', 'game_id', gameId))[0])).toContain(SECRET)
  })
})

describe('outsiders and anon', () => {
  it('give an outsider no row of the party, though session_by_code finds it', async () => {
    for (const table of ['sessions', 'players', 'session_games', 'session_feed', 'game_scores', 'score_events']) {
      expect(await read(outsider.client, table, table === 'sessions' ? ['id', party.id] : ['session_id', party.id]), table).toBe(0)
    }
    expect(await read(outsider.client, 'game_prompts', ['game_id', gameId])).toBe(0)
    const { data } = await outsider.client.rpc('session_by_code', { p_join_code: party.join_code.toLowerCase() })
    expect(data).toEqual({ id: party.id, name: 'Secrets test', join_code: party.join_code, status: 'open', archived_at: null })
    expect((await anonClient().rpc('session_by_code', { p_join_code: party.join_code })).error?.code).toBe('42501')
  })

  it('lets anon run keep_alive and nothing else', async () => {
    const anon = anonClient()
    expect(await anon.rpc('keep_alive')).toMatchObject({ data: true, error: null })
    const tables = ['hosts', 'sessions', 'players', 'session_games', 'game_settings', 'game_states', 'game_player_views',
      'game_scores', 'score_events', 'session_feed', 'game_prompts', 'game_submissions', 'event_log', 'player_transfers',
      'session_screens', 'screen_codes', 'session_recaps', 'scoreboard']
    for (const table of tables) expect((await anon.from(table).select('*').limit(1)).error?.code, table).toBe('42501')
    for (const fn of ['join_session', 'submit_answer', 'session_snapshot', 'session_recap', 'prompt_tallies', 'claim_player',
      'claim_screen', 'host_issue_transfer', 'host_revoke_transfer', 'host_issue_screen_code', 'game_load', 'game_commit', 'is_host']) {
      expect((await anon.rpc(fn, {})).error, fn).not.toBeNull()
    }
  })
})

describe('writes', () => {
  it("keep a guest away from the engine's functions and from every table", async () => {
    for (const [fn, args] of [
      ['game_load', { p_game_id: gameId, p_user_id: ana.userId }],
      ['game_commit', { p: {} }],
      ['ping', { p_topic: `room:${party.id}` }],
      ['check_answer', { p_spec: {}, p_payload: {}, p_session_id: party.id, p_player_id: ana.playerId }],
    ] as const) {
      expect((await ana.client.rpc(fn, args)).error?.code, fn).toBe('42501')
    }
    const refused = async (result: PromiseLike<{ error: { code?: string } | null }>) => (await result).error?.code
    expect(await refused(ana.client.from('sessions').insert({ name: 'Mine', join_code: 'HACKED1' }))).toBe('42501')
    expect(await refused(ana.client.from('session_games').insert({ session_id: party.id, game_type: 'lab', title: 'Mine' }))).toBe('42501')
    expect(await refused(ana.client.from('score_events').insert({ session_id: party.id, player_id: ana.playerId, points: 99 }))).toBe('42501')
    expect(await refused(ana.client.from('session_feed').insert({ session_id: party.id, message: 'Fake' }))).toBe('42501')
    expect(await refused(ana.client.from('event_log').insert({ session_id: party.id, kind: 'fake.row', actor: 'host' }))).toBe('42501')
    expect(await refused(ana.client.from('session_screens').insert({ user_id: ana.userId, session_id: party.id }))).toBe('42501')
    // An update a policy filters out changes nothing.
    await ana.client.from('sessions').update({ name: 'Hacked' }).eq('id', party.id)
    await ana.client.from('players').update({ name: 'Hacked' }).eq('id', bo.playerId)
    expect((await rows<{ name: string }>('sessions', 'id', party.id))[0].name).toBe('Secrets test')
    expect((await rows<{ name: string }>('players', 'id', bo.playerId))[0].name).toBe('Bo')
  })

  it("keep even a host away from the engine's columns", async () => {
    const refused = async (result: PromiseLike<{ error: { code?: string } | null }>) => (await result).error?.code
    expect(await refused(host.client.from('session_games').update({ status: 'finished' }).eq('id', gameId))).toBe('42501')
    expect(await refused(host.client.from('session_games').update({ public_state: {} }).eq('id', gameId))).toBe('42501')
    expect(await refused(host.client.from('sessions').update({ data: { x: 1 } }).eq('id', party.id))).toBe('42501')
    expect(await refused(host.client.from('players').update({ profile: { x: 1 } }).eq('id', ana.playerId))).toBe('42501')
    expect(await refused(host.client.from('players').update({ user_id: host.userId }).eq('id', ana.playerId))).toBe('42501')
    expect(
      await refused(host.client.from('score_events').insert({ session_id: party.id, player_id: ana.playerId, points: 1, awarded_by: ana.userId })),
    ).toBe('42501')
  })
})

describe('codes and joining', () => {
  it('lets only hosts issue codes, and refuses wrong, expired and doubled claims', async () => {
    expect((await ana.client.rpc('host_issue_transfer', { p_player_id: bo.playerId })).error).toMatchObject({ code: 'PT403' })
    expect((await ana.client.rpc('host_issue_screen_code', { p_session_id: party.id })).error).toMatchObject({ code: 'PT403' })
    const stranger = await world.user()
    expect((await stranger.client.rpc('claim_player', { p_code: 'WRONG1' })).error).toMatchObject({ code: 'PT404' })
    expect((await stranger.client.rpc('claim_screen', { p_code: 'WRONG1' })).error).toMatchObject({ code: 'PT404' })

    // Expired codes.
    await admin.from('player_transfers').delete().eq('player_id', bo.playerId)
    await admin.from('player_transfers').insert({ code: 'OLDXY1', player_id: bo.playerId, expires_at: new Date(Date.now() - 1000).toISOString() })
    expect((await stranger.client.rpc('claim_player', { p_code: 'oldxy1' })).error).toMatchObject({ code: 'PT404' })
    const old = await world.party(host, 'Old codes')
    await admin.from('screen_codes').insert({ code: 'OLDXY2', session_id: old.id, expires_at: new Date(Date.now() - 1000).toISOString() })
    expect((await stranger.client.rpc('claim_screen', { p_code: 'OLDXY2' })).error).toMatchObject({ code: 'PT404' })

    // A phone that already has a player in the party can't take another one.
    const { data: code } = await host.client.rpc('host_issue_transfer', { p_player_id: bo.playerId })
    expect((await ana.client.rpc('claim_player', { p_code: code })).error).toMatchObject({ code: 'PT409', details: 'already_player' })
  })

  it('cancels a move code when the host closes its dialog: nobody can claim it after', async () => {
    const { data: code } = await host.client.rpc('host_issue_transfer', { p_player_id: bo.playerId })
    // Only hosts cancel codes.
    expect((await ana.client.rpc('host_revoke_transfer', { p_code: code })).error).toMatchObject({ code: 'PT403', details: 'not_host' })
    // Typed as a guest might read it out: lower case, with spaces.
    expect((await host.client.rpc('host_revoke_transfer', { p_code: ` ${String(code).toLowerCase()} ` })).error).toBeNull()
    const fresh = await world.user()
    expect((await fresh.client.rpc('claim_player', { p_code: code })).error).toMatchObject({ code: 'PT404', details: 'bad_code' })
    // A used or unknown code cancels as a no-op, and another player's code still works.
    expect((await host.client.rpc('host_revoke_transfer', { p_code: code })).error).toBeNull()
    const dee = await world.guest(party, 'Dee')
    const { data: other } = await host.client.rpc('host_issue_transfer', { p_player_id: dee.playerId })
    await host.client.rpc('host_revoke_transfer', { p_code: 'NOSUCH' })
    const { data: moved, error } = await fresh.client.rpc('claim_player', { p_code: other })
    expect(error).toBeNull()
    expect(moved).toMatchObject({ id: dee.playerId, user_id: fresh.userId })
  })

  it('gives a move code 5 minutes, and a TV pairing code 15', async () => {
    const { data: code } = await host.client.rpc('host_issue_transfer', { p_player_id: bo.playerId })
    const [transfer] = await rows<{ expires_at: string }>('player_transfers', 'code', code)
    const minutes = (Date.parse(transfer.expires_at) - Date.now()) / 60_000
    expect(minutes).toBeGreaterThan(4.5)
    expect(minutes).toBeLessThanOrEqual(5.1)
    const { data: screenCode } = await host.client.rpc('host_issue_screen_code', { p_session_id: party.id })
    const [pairing] = await rows<{ expires_at: string }>('screen_codes', 'code', screenCode)
    expect((Date.parse(pairing.expires_at) - Date.now()) / 60_000).toBeGreaterThan(14.5)
  })

  it('moves a player to a new phone; the old phone then reads member: false', async () => {
    const cy = await world.guest(party, 'Cy')
    const { data: code } = await host.client.rpc('host_issue_transfer', { p_player_id: cy.playerId })
    const newPhone = await world.user()
    const { data: moved, error } = await newPhone.client.rpc('claim_player', { p_code: code })
    expect(error).toBeNull()
    expect(moved).toMatchObject({ id: cy.playerId, name: 'Cy', user_id: newPhone.userId })
    const old = await cy.client.rpc('session_snapshot', { p_session_id: party.id, p_screen: 'phone' })
    // moved: an old phone that slept through the ping still learns why it is out.
    expect(old.data).toMatchObject({ member: false, exists: true, moved: true })
    const now = await newPhone.client.rpc('session_snapshot', { p_session_id: party.id, p_screen: 'phone' })
    expect(now.data).toMatchObject({ member: true, moved: false, me: { player_id: cy.playerId } })
    // The code was used up.
    expect((await (await world.user()).client.rpc('claim_player', { p_code: code })).error).toMatchObject({ code: 'PT404' })
  })

  it('drops a TV back to its pairing screen when the host unpairs it', async () => {
    const extra = await world.screen(host, party)
    expect((await extra.client.rpc('session_snapshot', { p_session_id: party.id, p_screen: 'tv' })).data.member).toBe(true)
    await host.client.from('session_screens').delete().eq('session_id', party.id).eq('user_id', extra.userId)
    expect((await extra.client.rpc('session_snapshot', { p_session_id: party.id, p_screen: 'tv' })).data.member).toBe(false)
  })

  it('counts look-alike, invisible and odd-spaced names as the same name, and stores names clean', async () => {
    const twins = await world.party(host, 'Twins')
    await world.guest(twins, 'Ana')
    const bo = await world.guest(twins, 'Bo')
    // One browser tries them all: a refused join leaves it without a player.
    const newcomer = await world.user()
    const join = (name: string) => newcomer.client.rpc('join_session', { p_join_code: twins.join_code, p_name: name })
    // A no-break space, a Cyrillic A, a zero-width space, a direction override, odd case and spacing, full-width letters.
    for (const name of ['Ana\u00a0', '\u0410na', 'An\u200ba', '\u202eAna', ' ana ', '\uff21\uff4e\uff41']) {
      expect((await join(name)).error, JSON.stringify(name)).toMatchObject({ code: 'PT409', details: 'name_taken' })
    }
    // Nothing to see: a zero-width space, a Hangul filler, a lone emoji joiner, only spaces.
    for (const name of ['\u200b', '\u3164', '\u200d', ' \u00a0\u3000 ']) {
      expect((await join(name)).error, JSON.stringify(name)).toMatchObject({ code: 'PT400', details: 'bad_name' })
    }
    // A name joins as it reads: composed, single spaces, no invisible characters. Emoji stay.
    const { data: zoe, error } = await join('  Zoe\u0308  Marie\u2060 \u{1F389}')
    expect(error).toBeNull()
    expect(zoe.name).toBe('Zo\u00eb Marie \u{1F389}')
    // The host's rename goes through the same rules: the same name is taken, nothing to see is refused, spaces are cleaned.
    const rename = (name: string) => host.client.from('players').update({ name }).eq('id', zoe.id).select('name')
    expect((await rename('Bo\u200b')).error).toMatchObject({ code: '23505' })
    expect((await rename('\u200b\u2060')).error).toMatchObject({ code: '23514' })
    expect((await rename('Zoe  B\u00a0')).data).toEqual([{ name: 'Zoe B' }])
    expect((await rows<{ name: string }>('players', 'id', bo.playerId))[0].name).toBe('Bo')
  })

  it('refuses to join an archived party', async () => {
    const over = await world.party(host, 'Over')
    await host.client.from('sessions').update({ archived_at: new Date().toISOString() }).eq('id', over.id)
    const late = await world.user()
    const { error } = await late.client.rpc('join_session', { p_join_code: over.join_code, p_name: 'Late' })
    expect(error).toMatchObject({ code: 'PT409', details: 'archived', message: 'This party is over' })
  })
})

describe('game media', () => {
  // A few bytes with a JPEG header; Storage checks the type, not the picture.
  const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9])], { type: 'image/jpeg' })

  it('lets only hosts upload, change, list and delete; everyone reads the public URL', async () => {
    const folder = `${party.id}/${gameId}`
    const path = `${folder}/${crypto.randomUUID()}.jpg`
    const bucket = (client: SupabaseClient) => client.storage.from('game-media')

    for (const client of [ana.client, anonClient()]) {
      expect((await bucket(client).upload(`${folder}/${crypto.randomUUID()}.jpg`, jpeg(), { contentType: 'image/jpeg' })).error).not.toBeNull()
    }
    expect((await bucket(host.client).upload(path, jpeg(), { contentType: 'image/jpeg' })).error).toBeNull()
    // JPEG only: the browser re-encodes every upload first.
    const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })
    expect((await bucket(host.client).upload(path.replace('.jpg', '.png'), png, { contentType: 'image/png' })).error).not.toBeNull()

    // Guests and anon can't list, change or delete it.
    for (const client of [ana.client, anonClient()]) {
      const listed = await bucket(client).list(folder)
      expect(listed.data ?? []).toEqual([])
      expect((await bucket(client).update(path, jpeg(), { contentType: 'image/jpeg' })).error).not.toBeNull()
      await bucket(client).remove([path])
    }
    expect((await bucket(host.client).list(folder)).data?.map((f) => f.name)).toEqual([path.split('/').pop()])

    const publicUrl = bucket(anonClient()).getPublicUrl(path).data.publicUrl
    expect(publicUrl.startsWith(SUPABASE_URL)).toBe(true)
    expect((await fetch(publicUrl)).status).toBe(200)

    expect((await bucket(host.client).update(path, jpeg(), { contentType: 'image/jpeg' })).error).toBeNull()
    expect((await bucket(host.client).remove([path])).error).toBeNull()
    expect((await bucket(host.client).list(folder)).data).toEqual([])
  })
})

describe('deleting a party', () => {
  it('removes everything in it at once, and writes no log rows for its parts', async () => {
    const doomed = await world.party(host, 'Doomed')
    const guest = await world.guest(doomed, 'Gus')
    await world.guest(doomed, 'Gil')
    await world.screen(host, doomed)
    const game = await world.game(host, doomed, 'lab', 'Doomed game', { secret: 'x' })
    await engine(host, { type: 'start', gameId: game, stage: true })
    await engine(host, { type: 'host-action', gameId: game, action: { type: 'open', key: 'k', spec: { kind: 'choice', options: ['a'] } } })
    await guest.client.rpc('submit_answer', { p_game_id: game, p_key: 'k', p_payload: { choice: 'a' }, p_request_id: crypto.randomUUID() })
    await host.client.from('score_events').insert({ session_id: doomed.id, player_id: guest.playerId, game_id: game, points: 2 })
    await host.client.rpc('host_issue_transfer', { p_player_id: guest.playerId })
    await host.client.rpc('host_issue_screen_code', { p_session_id: doomed.id })
    expect((await rows('event_log', 'session_id', doomed.id)).length).toBeGreaterThan(5)
    const before = (await admin.from('event_log').select('id').order('id', { ascending: false }).limit(1)).data![0].id

    const { error } = await host.client.from('sessions').delete().eq('id', doomed.id)
    expect(error).toBeNull()

    for (const table of ['players', 'session_games', 'score_events', 'session_feed', 'event_log', 'session_screens', 'screen_codes', 'session_recaps', 'game_scores']) {
      expect(await rows(table, 'session_id', doomed.id), table).toEqual([])
    }
    for (const table of ['game_settings', 'game_states', 'game_player_views', 'game_prompts', 'game_submissions']) {
      expect(await rows(table, 'game_id', game), table).toEqual([])
    }
    expect(await rows('player_transfers', 'player_id', guest.playerId)).toEqual([])
    // The next log row follows the last one before the delete: the delete wrote (or tried) none.
    const probe = await world.party(host, 'After the delete')
    const next = (await rows<{ id: number; kind: string }>('event_log', 'session_id', probe.id))[0]
    expect(next).toMatchObject({ kind: 'session.created', id: before + 1 })
  })
})
