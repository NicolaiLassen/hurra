// A local host and a demo party to click around in (docs/engine-v2.md, 2.13).
//
//   npm run dev:setup
//
// Makes (or reuses) the local host user from DEV_HOST_EMAIL and
// DEV_HOST_PASSWORD in the gitignored .env.development.local, so no password
// ever sits in the repo, lists it in hosts, and adds a demo party with 6 bot
// guests and one game of each type. Local only: it refuses any URL that isn't
// localhost. Run it again after `supabase db reset`.
import { createClient } from '@supabase/supabase-js'
import { existsSync } from 'node:fs'

if (existsSync('.env.development.local')) process.loadEnvFile('.env.development.local')
const url = process.env.VITE_SUPABASE_URL ?? ''
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ''
const secretKey = process.env.SUPABASE_SECRET_KEY ?? ''
const email = process.env.DEV_HOST_EMAIL ?? ''
const password = process.env.DEV_HOST_PASSWORD ?? ''

if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url)) {
  console.error('dev:setup runs only against the local Supabase stack (VITE_SUPABASE_URL must be localhost).')
  process.exit(1)
}
if (!publishableKey || !secretKey) {
  console.error('Set VITE_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY in .env.development.local (see `supabase status`).')
  process.exit(1)
}
if (!email || password.length < 6) {
  console.error('Set DEV_HOST_EMAIL and DEV_HOST_PASSWORD (6 characters or more) in .env.development.local.')
  process.exit(1)
}

const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, secretKey, options)

/** The host's user id: an existing user with that email, or a new one. */
async function hostUserId(): Promise<string> {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (found) {
      await admin.auth.admin.updateUserById(found.id, { password })
      return found.id
    }
    if (data.users.length < 200) break
  }
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw error ?? new Error('createUser failed')
  return data.user.id
}

const hostId = await hostUserId()
const { error: hostError } = await admin.from('hosts').upsert({ user_id: hostId })
if (hostError) throw hostError
console.log(`Host ready: ${email}`)

const host = createClient(url, publishableKey, options)
const { error: loginError } = await host.auth.signInWithPassword({ email, password })
if (loginError) throw loginError

const joinCode = `DEMO${Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('')}`
const { data: party, error: partyError } = await host
  .from('sessions')
  .insert({ name: 'Demo party', join_code: joinCode })
  .select('id, join_code')
  .single()
if (partyError) throw partyError

const games: [string, string][] = [
  ['in-person', 'Beer pong'],
  ['elimination', 'Last one standing'],
  ['quiz', 'Quiz'],
  ['fusion', 'Participant fusion'],
]
for (const [index, [type, title]] of games.entries()) {
  const { error } = await host.from('session_games').insert({ session_id: party.id, game_type: type, title, position: index })
  if (error) throw error
}

for (const name of ['Ana', 'Bo', 'Cy', 'Dee', 'Eli', 'Fay']) {
  const guest = createClient(url, publishableKey, options)
  const { error } = await guest.auth.signInAnonymously()
  if (error) throw error
  const { error: joinError } = await guest.rpc('join_session', { p_join_code: party.join_code, p_name: name })
  if (joinError) throw joinError
}

console.log(`Demo party ready: join code ${party.join_code}, 6 guests, ${games.length} games.`)
console.log(`Host page: http://localhost:5173/host/s/${party.id}`)
process.exit(0)
