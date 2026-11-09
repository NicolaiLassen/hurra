// The phase-0 gate (docs/engine-v2.md, 9.4): the init file, the private
// Realtime topics and the game-media bucket working together on the local stack.
//
//   npm run db:smoke
//
// With the local secret key it makes a host and a guest; the host makes a
// party and a game; the guest joins; a prompt is opened as game_commit would;
// the host listens on the private stage:<party> topic; the guest answers, and
// the tally must arrive within 5 s. Then a small JPEG goes up, comes back and
// is deleted. Everything it made is deleted again. Prints PASS, or the step
// that failed. Local only: it refuses any URL that isn't localhost.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { existsSync } from 'node:fs'

if (existsSync('.env.development.local')) process.loadEnvFile('.env.development.local')
const url = process.env.VITE_SUPABASE_URL ?? ''
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ''
const secretKey = process.env.SUPABASE_SECRET_KEY ?? ''
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url)) {
  console.error('db:smoke runs only against the local Supabase stack (VITE_SUPABASE_URL must be localhost).')
  process.exit(1)
}
if (!publishableKey || !secretKey) {
  console.error('Set VITE_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY in .env.development.local (see `supabase status`).')
  process.exit(1)
}

const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, secretKey, options)
const users: string[] = []
let sessionId: string | null = null
let current = 'starting'

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  current = name
  const result = await run()
  console.log(`ok    ${name}`)
  return result
}

function must<T>(result: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (result.error) throw new Error(result.error.message)
  return result.data as NonNullable<T>
}

async function signedIn(email?: string): Promise<SupabaseClient> {
  const client = createClient(url, publishableKey, options)
  if (email) {
    const password = `pw-${crypto.randomUUID()}`
    const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (!data.user) throw new Error('createUser failed')
    users.push(data.user.id)
    must(await admin.from('hosts').insert({ user_id: data.user.id }))
    const { error } = await client.auth.signInWithPassword({ email, password })
    if (error) throw error
  } else {
    const { data, error } = await client.auth.signInAnonymously()
    if (error || !data.user) throw error ?? new Error('anonymous sign-in failed')
    users.push(data.user.id)
  }
  return client
}

async function main() {
  // Right after `supabase db reset` the API takes a moment to load the schema.
  await step('the API answers', async () => {
    for (let i = 0; i < 30; i++) {
      const response = await fetch(`${url}/rest/v1/rpc/keep_alive`, {
        method: 'POST',
        headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
        body: '{}',
      }).catch(() => null)
      if (response?.ok) return
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    throw new Error('rpc/keep_alive did not answer within 30 s (is the stack running?)')
  })
  const host = await step('a host signs in', () => signedIn(`smoke-${crypto.randomUUID()}@example.com`))
  const guest = await step('a guest signs in anonymously', () => signedIn())

  const party = await step('the host makes a party and a game', async () => {
    const code = `S${Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('')}`
    const session = must(await host.from('sessions').insert({ name: 'Smoke test', join_code: code }).select('id, join_code').single())
    sessionId = session.id
    const game = must(await host.from('session_games').insert({ session_id: session.id, game_type: 'quiz', title: 'Smoke' }).select('id').single())
    return { ...session, gameId: game.id as string }
  })

  await step('the guest joins with join_session', async () => {
    must(await guest.rpc('join_session', { p_join_code: party.join_code, p_name: 'Smoke guest' }))
  })

  await step('a prompt opens, as game_commit would open it', async () => {
    must(await admin.from('session_games').update({ status: 'active', started_at: new Date().toISOString() }).eq('id', party.gameId))
    must(await admin.from('game_states').insert({ game_id: party.gameId, state: {}, config: {} }))
    must(await admin.from('game_prompts').insert({ game_id: party.gameId, key: 'q1', round: 1, spec: { kind: 'choice', options: ['0', '1'], final: true } }))
  })

  const tally = await step('the host listens on the private stage topic', async () => {
    const { data } = await host.auth.getSession()
    await host.realtime.setAuth(data.session!.access_token)
    let resolveTally: (count: number) => void = () => {}
    let warm = false
    const heard = new Promise<number>((resolve) => (resolveTally = resolve))
    const channel = host.channel(`stage:${party.id}`, { config: { private: true } })
    channel.on('broadcast', { event: 'tally' }, (message) => resolveTally(Number(message.payload.count)))
    channel.on('broadcast', { event: 'warmup' }, () => (warm = true))
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the channel did not join within 8 s')), 8000)
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timer)
          resolve()
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timer)
          reject(new Error(`the channel answered ${status}`))
        }
      })
    })
    // Right after `supabase db reset`, Realtime takes a few seconds to follow the
    // database again: wait until a ping from the database comes through.
    for (let i = 0; i < 20 && !warm; i++) {
      must(await admin.rpc('ping', { p_topic: `stage:${party.id}`, p_event: 'warmup', p_payload: {} }))
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    if (!warm) throw new Error('no ping from the database arrived within 20 s (is Realtime running?)')
    return { heard, close: () => host.removeChannel(channel) }
  })

  await step('the guest answers and the tally arrives within 5 s', async () => {
    must(await guest.rpc('submit_answer', { p_game_id: party.gameId, p_key: 'q1', p_payload: { choice: '1' }, p_request_id: crypto.randomUUID() }))
    const count = await Promise.race([tally.heard, new Promise<number>((_, reject) => setTimeout(() => reject(new Error('no tally within 5 s')), 5000))])
    if (count !== 1) throw new Error(`the tally said ${count}, not 1`)
    await tally.close()
  })

  await step('the host uploads, reads back and deletes a JPEG in game-media', async () => {
    const path = `${party.id}/${party.gameId}/${crypto.randomUUID()}.jpg`
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9])
    const bucket = host.storage.from('game-media')
    must(await bucket.upload(path, new Blob([bytes], { type: 'image/jpeg' }), { contentType: 'image/jpeg' }))
    const response = await fetch(bucket.getPublicUrl(path).data.publicUrl)
    if (response.status !== 200) throw new Error(`the public URL answered ${response.status}`)
    must(await bucket.remove([path]))
  })
}

try {
  await main()
  console.log('PASS')
} catch (error) {
  console.error(`FAIL  ${current}: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  if (sessionId) await admin.from('sessions').delete().eq('id', sessionId)
  for (const id of users) await admin.auth.admin.deleteUser(id)
  // Realtime sockets would keep Node running.
  process.exit(process.exitCode ?? 0)
}
