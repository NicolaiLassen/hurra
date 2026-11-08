// End-to-end tests of the game engine against the local Supabase stack
// (`supabase start`), through the real /api/game handler and real player
// logins. Run with `npm run test:integration`.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loadEnv } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import handler from '../functions/game.mts'

Object.assign(process.env, loadEnv('development', process.cwd(), ''))
const URL = process.env.VITE_SUPABASE_URL!
const PUBLISHABLE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!

const admin = createClient(URL, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })
const newClient = () => createClient(URL, PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

type Person = { client: SupabaseClient; token: string; playerId: string; name: string }

let host: Person
const players: Record<string, Person> = {}
let sessionId: string
let gameId: string
const createdUsers: string[] = []

async function call(person: Person | null, body: unknown) {
  const response = await handler(
    new Request('http://localhost/api/game', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(person ? { Authorization: `Bearer ${person.token}` } : {}) },
      body: JSON.stringify(body),
    }),
  )
  return {
    status: response.status,
    body: (await response.json()) as { error?: string; view?: { status: string; task?: string } },
  }
}

const tag = (by: Person, target: Person) =>
  call(by, { gameId, type: 'action', action: { type: 'tag', target: target.playerId } })

beforeAll(async () => {
  const email = `engine-test-${Date.now()}@example.com`
  const { data: created } = await admin.auth.admin.createUser({ email, password: 'test-password', email_confirm: true })
  createdUsers.push(created.user!.id)
  await admin.from('hosts').insert({ user_id: created.user!.id })
  const hostClient = newClient()
  const { data: hostLogin } = await hostClient.auth.signInWithPassword({ email, password: 'test-password' })
  host = { client: hostClient, token: hostLogin.session!.access_token, playerId: '', name: 'host' }

  const code = `T${String(Date.now()).slice(-6)}`
  const { data: session } = await hostClient
    .from('sessions')
    .insert({ name: 'Engine test', join_code: code })
    .select()
    .single()
  sessionId = session.id
  const { data: game } = await hostClient
    .from('session_games')
    .insert({
      session_id: sessionId,
      game_type: 'elimination',
      title: 'Killer',
      config: { tasks: ['sing', 'dance', 'ribbit', 'wave'] },
    })
    .select()
    .single()
  gameId = game.id

  for (const name of ['Ana', 'Bo', 'Cy', 'Dee']) {
    const client = newClient()
    const { data: login } = await client.auth.signInAnonymously()
    createdUsers.push(login.user!.id)
    const { data: player } = await client.rpc('join_session', { p_join_code: code, p_name: name })
    players[name] = { client, token: login.session!.access_token, playerId: player.id, name }
  }
})

afterAll(async () => {
  if (sessionId) await admin.from('sessions').delete().eq('id', sessionId)
  for (const id of createdUsers) await admin.auth.admin.deleteUser(id)
})

describe('starting', () => {
  it('needs a signed-in host', async () => {
    expect((await call(null, { gameId, type: 'start' })).status).toBe(401)
    expect((await call(players.Ana, { gameId, type: 'start' })).status).toBe(403)
    expect(
      (await call(players.Ana, { gameId, type: 'action', action: { type: 'tag', target: players.Bo.playerId } }))
        .status,
    ).toBe(409)
  })

  it('deals the game and keeps every task private', async () => {
    expect(await call(host, { gameId, type: 'start' })).toEqual({ status: 200, body: {} })
    // A double tap or a retried request must not deal it again.
    expect(await call(host, { gameId, type: 'start' })).toEqual({
      status: 409,
      body: { error: 'This game is already running' },
    })

    const { data: game } = await players.Ana.client
      .from('session_games')
      .select('status, public_state')
      .eq('id', gameId)
      .single()
    expect(game?.status).toBe('active')
    expect(game?.public_state.alive).toHaveLength(4)

    // Each player can read only their own view; the full state is hosts-only.
    const { data: anaViews } = await players.Ana.client
      .from('game_player_views')
      .select('player_id, view')
      .eq('game_id', gameId)
    expect(anaViews).toHaveLength(1)
    expect(anaViews?.[0].player_id).toBe(players.Ana.playerId)
    expect(anaViews?.[0].view.status).toBe('alive')
    expect((await players.Ana.client.from('game_states').select('state').eq('game_id', gameId)).data).toEqual([])
    expect((await host.client.from('game_states').select('state').eq('game_id', gameId)).data).toHaveLength(1)

    const { data: feed } = await players.Ana.client
      .from('session_feed')
      .select('message, detail')
      .eq('session_id', sessionId)
    expect(feed?.[0]).toMatchObject({ message: 'Last one standing has started', detail: expect.stringMatching(/players, one life each$/) })
  })
})

describe('playing', () => {
  it('tags a player out, hands over their task and scores', async () => {
    const { data: boView } = await players.Bo.client
      .from('game_player_views')
      .select('view')
      .eq('game_id', gameId)
      .single()

    const result = await tag(players.Ana, players.Bo)
    expect(result.status).toBe(200)
    expect(result.body.view).toMatchObject({ status: 'alive', task: boView?.view.task })

    const { data: boAfter } = await players.Bo.client
      .from('game_player_views')
      .select('view')
      .eq('game_id', gameId)
      .single()
    expect(boAfter?.view).toMatchObject({ status: 'out', by: players.Ana.playerId, method: 'tag' })

    const { data: anaRow } = await players.Cy.client
      .from('scoreboard')
      .select('points')
      .eq('player_id', players.Ana.playerId)
      .single()
    expect(anaRow?.points).toBe(1)
    const { data: anaPlayer } = await players.Cy.client
      .from('players')
      .select('profile')
      .eq('id', players.Ana.playerId)
      .single()
    expect(anaPlayer?.profile).toEqual({ elimination: { tags: 1 } })
  })

  it('rejects moves that break the rules with a message for the player', async () => {
    expect(await tag(players.Bo, players.Cy)).toEqual({ status: 400, body: { error: "You're out" } })
    expect(await tag(players.Ana, players.Ana)).toEqual({ status: 400, body: { error: "That's your own code" } })
    expect((await call(players.Ana, { gameId, type: 'action', action: { type: 'steal' } })).status).toBe(400)
  })

  it('lets exactly one of two simultaneous tags win', async () => {
    const results = await Promise.all([tag(players.Cy, players.Dee), tag(players.Dee, players.Cy)])
    expect(results.map((r) => r.status).sort()).toEqual([200, 400])
    expect(results.find((r) => r.status === 400)?.body.error).toBe("You're out")
  })

  it('crowns the last one standing', async () => {
    const { data: game } = await players.Ana.client
      .from('session_games')
      .select('public_state')
      .eq('id', gameId)
      .single()
    const survivor = Object.values(players).find(
      (p) => p !== players.Ana && game?.public_state.alive.includes(p.playerId),
    )!

    expect((await tag(players.Ana, survivor)).body.view).toEqual({ status: 'winner', knockouts: 2 })
    expect((await tag(players.Ana, survivor)).body.error).toBe('The game is over')
    const { data: anaPlayer } = await players.Ana.client
      .from('players')
      .select('profile')
      .eq('id', players.Ana.playerId)
      .single()
    expect(anaPlayer?.profile).toEqual({ elimination: { tags: 2, wins: 1 } })
  })
})

describe('events and ending', () => {
  it('sends personal announcements to the players involved, with their sound', async () => {
    const { data: feed } = await players.Ana.client
      .from('session_feed')
      .select('message, audience, sound, icon')
      .eq('session_id', sessionId)
      .order('id')
    const forBo = feed?.find((item) => item.audience?.includes(players.Bo.playerId))
    expect(forBo).toMatchObject({ sound: 'sad', icon: 'skull' })
    expect(forBo?.message).toContain("You're out")
    expect(feed?.some((item) => item.audience === null && item.sound === 'slash')).toBe(true)
  })

  it('lets only the host end a game, through the game', async () => {
    expect((await call(players.Ana, { gameId, type: 'end' })).status).toBe(403)
    expect(await call(host, { gameId, type: 'end' })).toEqual({ status: 200, body: {} })
    const { data: game } = await players.Ana.client.from('session_games').select('status').eq('id', gameId).single()
    expect(game?.status).toBe('finished')
    expect((await call(host, { gameId, type: 'end' })).status).toBe(409)
  })
})

describe('archived games', () => {
  it("won't start", async () => {
    const { data: archived } = await host.client
      .from('session_games')
      .insert({
        session_id: sessionId,
        game_type: 'elimination',
        title: 'Old round',
        archived_at: new Date().toISOString(),
      })
      .select()
      .single()
    expect(await call(host, { gameId: archived.id, type: 'start' })).toEqual({
      status: 409,
      body: { error: 'Unarchive this game before starting it' },
    })
  })
})

describe('sessions', () => {
  it('can only be archived or deleted by hosts, and deleting removes everything in them', async () => {
    const { data: party } = await host.client
      .from('sessions')
      .insert({ name: 'Throwaway party', join_code: `D${String(Date.now()).slice(-6)}` })
      .select()
      .single()
    const { data: guestLogin } = await players.Ana.client.auth.getSession()
    expect(guestLogin.session).not.toBeNull()
    const { data: guest } = await players.Ana.client.rpc('join_session', {
      p_join_code: party.join_code,
      p_name: 'Ana',
    })
    await host.client.from('session_games').insert({ session_id: party.id, game_type: 'in-person', title: 'Quiz' })
    await host.client.from('score_events').insert({ session_id: party.id, player_id: guest.id, points: 3 })

    // Players can read the session but not change it.
    await players.Ana.client.from('sessions').update({ archived_at: new Date().toISOString() }).eq('id', party.id)
    await players.Ana.client.from('sessions').delete().eq('id', party.id)
    const { data: untouched } = await admin.from('sessions').select('archived_at').eq('id', party.id).single()
    expect(untouched?.archived_at).toBeNull()

    const { error: archiveError } = await host.client
      .from('sessions')
      .update({ archived_at: new Date().toISOString(), status: 'closed' })
      .eq('id', party.id)
    expect(archiveError).toBeNull()

    const { error: deleteError } = await host.client.from('sessions').delete().eq('id', party.id)
    expect(deleteError).toBeNull()
    for (const table of ['players', 'session_games', 'score_events']) {
      const { count } = await admin.from(table).select('*', { count: 'exact', head: true }).eq('session_id', party.id)
      expect(count, table).toBe(0)
    }
  })
})

describe('effects', () => {
  it('applies every kind of effect in one transaction', async () => {
    const { error } = await admin.rpc('apply_game_state', {
      p_game_id: gameId,
      p_expected_version: null,
      p_state: {},
      p_public_state: {},
      p_player_views: {},
      p_scores: {},
      p_effects: {
        points: [{ player_id: players.Bo.playerId, points: 5, reason: 'Comeback bonus' }],
        profiles: { [players.Bo.playerId]: { title: 'Phoenix' } },
        session_data: { round: 2 },
        announcements: ['Bo rises again'],
      },
    })
    expect(error).toBeNull()

    const { data: bo } = await players.Bo.client
      .from('scoreboard')
      .select('points')
      .eq('player_id', players.Bo.playerId)
      .single()
    expect(bo?.points).toBe(5)
    const { data: boPlayer } = await players.Bo.client
      .from('players')
      .select('profile')
      .eq('id', players.Bo.playerId)
      .single()
    expect(boPlayer?.profile).toEqual({ elimination: { title: 'Phoenix' } })
    const { data: session } = await players.Bo.client.from('sessions').select('data').eq('id', sessionId).single()
    expect(session?.data).toEqual({ elimination: { round: 2 } })
  })

  it('is only callable by the engine', async () => {
    const { error } = await players.Ana.client.rpc('apply_game_state', {
      p_game_id: gameId,
      p_expected_version: null,
      p_state: {},
      p_public_state: {},
      p_player_views: {},
      p_scores: { [players.Ana.playerId]: 999 },
      p_effects: {},
    })
    expect(error?.message).toContain('permission denied')
  })
})
