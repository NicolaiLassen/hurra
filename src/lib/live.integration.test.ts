// The client data layer against the real local stack (npm run test:integration):
// private channels with real tokens, pings and snapshot reads, a tally from a
// real answer, a player moved to a new phone and a TV unpaired. The party and
// users it makes are deleted afterwards. Local only: it uses the secret key.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loadEnv } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createGameApi } from './gameApi'
import { createLiveSession, type LiveState, type Screen } from './live'

const env = loadEnv('development', '.', '')
const SUPABASE_URL = env.VITE_SUPABASE_URL ?? ''
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(SUPABASE_URL)) {
  throw new Error('This test runs only against the local Supabase stack (supabase start).')
}
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(SUPABASE_URL, env.SUPABASE_SECRET_KEY ?? '', options)
const newClient = () => createClient(SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '', options)

const users: string[] = []
let partyId = ''
let joinCode = ''
const sessions: { close(): void }[] = []

async function anonymous(): Promise<SupabaseClient> {
  const client = newClient()
  const { data, error } = await client.auth.signInAnonymously()
  if (error || !data.user) throw error ?? new Error('anonymous sign-in failed')
  users.push(data.user.id)
  return client
}

async function guest(name: string): Promise<{ client: SupabaseClient; playerId: string }> {
  const client = await anonymous()
  const { data, error } = await client.rpc('join_session', { p_join_code: joinCode, p_name: name })
  if (error) throw error
  return { client, playerId: (data as { id: string }).id }
}

/** A live session that records every state it reports. */
function watch(client: SupabaseClient, screen: Screen, playerId: string | null = null) {
  let state: LiveState | undefined
  const live = createLiveSession(client, { sessionId: partyId, screen, playerId }, (next) => (state = next))
  sessions.push(live)
  return { live, state: () => state }
}

async function until(check: () => boolean, ms = 8000, what = 'the condition') {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${what}`)
}

let host: SupabaseClient
let ana: { client: SupabaseClient; playerId: string }
let bo: { client: SupabaseClient; playerId: string }
let tv: SupabaseClient
let gameId = ''

beforeAll(async () => {
  const email = `data-host-${crypto.randomUUID()}@example.com`
  const password = `pw-${crypto.randomUUID()}`
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error || !created.data.user) throw created.error ?? new Error('createUser failed')
  users.push(created.data.user.id)
  const listed = await admin.from('hosts').insert({ user_id: created.data.user.id })
  if (listed.error) throw listed.error
  host = newClient()
  const login = await host.auth.signInWithPassword({ email, password })
  if (login.error) throw login.error

  joinCode = `D${crypto.randomUUID().replace(/[^0-9]/g, '').slice(0, 7)}`
  const party = await host.from('sessions').insert({ name: 'Data layer test', join_code: joinCode }).select('id').single()
  if (party.error) throw party.error
  partyId = party.data.id

  ana = await guest('Ana')
  bo = await guest('Bo')
  tv = await anonymous()
  const code = await host.rpc('host_issue_screen_code', { p_session_id: partyId })
  if (code.error) throw code.error
  const claimed = await tv.rpc('claim_screen', { p_code: code.data })
  if (claimed.error) throw claimed.error

  // A live game with an open prompt, set up as game_commit would leave it.
  const game = await host.from('session_games').insert({ session_id: partyId, game_type: 'lab', title: 'Lab' }).select('id').single()
  if (game.error) throw game.error
  gameId = game.data.id
  for (const step of [
    admin.from('session_games').update({ status: 'active', started_at: new Date().toISOString(), public_state: {} }).eq('id', gameId),
    admin.from('game_states').insert({ game_id: gameId, state: {}, members: [ana.playerId, bo.playerId] }),
    admin.from('game_prompts').insert({ game_id: gameId, key: 'q1', round: 1, spec: { kind: 'choice', options: ['a', 'b'] } }),
  ]) {
    const { error } = await step
    if (error) throw error
  }
})

afterAll(async () => {
  for (const session of sessions) session.close()
  if (partyId) await admin.from('sessions').delete().eq('id', partyId)
  for (const id of users) await admin.auth.admin.deleteUser(id)
})

describe('live sessions on the local stack', () => {
  let phone: ReturnType<typeof watch>
  let screen: ReturnType<typeof watch>
  let hostPage: ReturnType<typeof watch>

  it('reads the snapshot and joins every private channel, for a phone, a paired TV and the host page', async () => {
    phone = watch(ana.client, 'phone', ana.playerId)
    screen = watch(tv, 'tv')
    hostPage = watch(host, 'host')
    for (const [name, s] of [
      ['phone', phone],
      ['tv', screen],
      ['host', hostPage],
    ] as const) {
      await until(() => s.state()?.connected === true, 10_000, `${name} to connect`)
      expect(s.state()?.snapshot).toMatchObject({ member: true, exists: true, session: { id: partyId } })
    }
    expect(phone.state()?.snapshot?.me?.player_id).toBe(ana.playerId)
    expect(hostPage.state()?.snapshot?.screens).toBe(1)
    expect(screen.state()?.snapshot?.states).toBeNull()
    expect(phone.live.serverNow()).toBeGreaterThan(0)
  })

  it('a host write pings every screen, and each reads the change', async () => {
    const renamed = await host.from('sessions').update({ name: 'Data layer test, renamed' }).eq('id', partyId)
    expect(renamed.error).toBeNull()
    for (const s of [phone, screen, hostPage]) {
      // Usually about 100 ms; the first database broadcast after the local
      // Realtime has been idle can take several seconds while it starts up.
      await until(() => s.state()?.snapshot?.session?.name === 'Data layer test, renamed', 15_000, 'the rename')
      expect(s.state()?.pings).toBe('ok')
    }
  })

  it('a real answer reaches the TV and the host page as a tally, and the settle read confirms it', async () => {
    const answered = await createGameApi(bo.client).submitAnswer(gameId, 'q1', { choice: ['a'] })
    expect(answered).toMatchObject({ accepted: true, answer: { choice: ['a'] } })
    for (const s of [screen, hostPage]) {
      await until(() => s.state()?.tallies[gameId]?.q1 === 1, 5000, 'the tally')
      await until(() => s.state()?.snapshot?.tallies[gameId]?.q1 === 1, 5000, 'the settle read')
    }
    // The answer is Bo's: his own snapshot has it, nobody else's does.
    expect(phone.state()?.snapshot?.me?.answers[gameId]).toBeUndefined()
  })

  it('tells the old phone its player moved, and it leaves the party’s channels', async () => {
    const code = await host.rpc('host_issue_transfer', { p_player_id: ana.playerId })
    expect(code.error).toBeNull()
    const newPhone = await anonymous()
    const claimed = await newPhone.rpc('claim_player', { p_code: code.data })
    expect(claimed.error).toBeNull()
    await until(() => phone.state()?.moved === true, 5000, 'moved')
    await until(() => phone.state()?.snapshot?.member === false, 5000, 'the old phone to lose the party')
    expect(phone.state()?.connected).toBe(false)
    expect(phone.state()?.snapshot?.exists).toBe(true)
  })

  it('an unpaired TV reads that it is no longer a member', async () => {
    const unpaired = await host.from('session_screens').delete().eq('session_id', partyId)
    expect(unpaired.error).toBeNull()
    await until(() => screen.state()?.snapshot?.member === false, 8000, 'the TV to fall back to pairing')
    await until(() => hostPage.state()?.snapshot?.screens === 0, 5000, 'the host page to count 0 screens')
  })
})
