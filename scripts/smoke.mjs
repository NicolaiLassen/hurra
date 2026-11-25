// A short smoke round against any Hurra deployment (docs/engine-v2.md, 11):
// it makes a throwaway host, party, 3 guests and a TV, checks the core flows
// end to end through the real API, and deletes everything it made, even when
// a step fails.
//
//   API_URL=http://127.0.0.1:54321 PUBLISHABLE_KEY=... SECRET_KEY=... \
//   SITE=http://localhost:5173 npm run smoke
//
// API_URL is the Supabase project URL, SITE the site that serves /api/game.
// Keys come from the shell's environment only, never from a file, and are
// never printed. Against anything but a local stack it also needs
// CONFIRM=<project ref> (the subdomain of API_URL), so it never runs against
// a project by accident. Plain Node 22 or later (a global WebSocket), with
// the repo's @supabase/supabase-js.
//
// What it checks, in order: the site and the engine's 401; keep_alive for
// anon; the host's party and games; 3 guests joining with anonymous sign-ins;
// pairing a TV; pings on private topics (a rename reaches a guest, an answer
// reaches the host as a tally, a guest's forged broadcast reaches nobody);
// secrets (game settings, states and the log stay host-only, the quiz's
// answer stays out of public state until its reveal); guest photos (a guest's
// photo reaches the TV and the other phones and is public, another guest can't
// upload into her folder or set her photo, a PNG, a 70 KB file and a second
// photo at once are refused, so are an upload with a content coding, a signed
// upload URL and her delete of the file her photo shows, the host's Remove
// photo reaches the room); Last one standing in the background with a
// knockout; a 2-question quiz on the stage to its crown, with the
// final-screen spotlight; fusion
// on the stage with one picture asked, locked in and revealed; a host award and its undo;
// moving a player to a new phone; the recap read, published and read back by
// a guest; a game-media upload; unpairing the TV; deleting the party.
import { createClient } from '@supabase/supabase-js'

const env = (name) => {
  const value = process.env[name]?.trim()
  if (!value) {
    console.error(`Set ${name}. Usage: API_URL=... PUBLISHABLE_KEY=... SECRET_KEY=... SITE=... node scripts/smoke.mjs`)
    process.exit(2)
  }
  return value
}

const API_URL = env('API_URL').replace(/\/+$/, '')
const PUBLISHABLE_KEY = env('PUBLISHABLE_KEY')
const SECRET_KEY = env('SECRET_KEY')
const SITE = env('SITE').replace(/\/+$/, '')

// The guard: a local stack, or the project the operator named.
const apiHost = new URL(API_URL).hostname
const local = apiHost === 'localhost' || apiHost === '127.0.0.1'
if (!local) {
  const ref = apiHost.split('.')[0]
  if (process.env.CONFIRM !== ref) {
    console.error(`${API_URL} is not a local stack. Run again with CONFIRM=${ref} if you mean to smoke-test that project.`)
    process.exit(2)
  }
}

const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(API_URL, SECRET_KEY, options)
const stamp = Date.now().toString(36).toUpperCase()
const made = { users: new Set(), sessionId: null, media: [], photos: [], clients: [] }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const startedAt = Date.now()
let failures = 0

function log(text) {
  console.log(`${((Date.now() - startedAt) / 1000).toFixed(1).padStart(5)}s  ${text}`)
}

function check(ok, what) {
  if (!ok) throw new Error(what)
  log(`  ok  ${what}`)
}

async function step(name, run) {
  log(name)
  try {
    await run()
  } catch (error) {
    failures++
    log(`  FAIL ${error.message}`)
    throw error
  }
}

/** The data of a supabase-js call, or its error as an exception. */
async function data(promise, what) {
  const { data: result, error } = await promise
  if (error) throw new Error(`${what}: ${error.message}${error.details ? ` (${error.details})` : ''}`)
  return result
}

/** The error a call should fail with (null when it succeeded). */
async function refusal(promise) {
  const { error } = await promise
  return error
}

function client() {
  const c = createClient(API_URL, PUBLISHABLE_KEY, options)
  made.clients.push(c)
  return c
}

async function anonymous(label) {
  const c = client()
  const result = await data(c.auth.signInAnonymously(), `${label} sign-in`)
  made.users.add(result.user.id)
  return { client: c, userId: result.user.id, token: result.session.access_token }
}

/** Sends a request to the engine with this user's token. */
async function engine(who, body) {
  const response = await fetch(`${SITE}/api/game`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${who.token}` },
    body: JSON.stringify({ ...body, requestId: crypto.randomUUID() }),
  })
  const answer = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`engine ${body.type} answered ${response.status}: ${answer.error ?? JSON.stringify(answer)}`)
  return answer
}

async function snapshot(who, sessionId, screen) {
  return data(who.client.rpc('session_snapshot', { p_session_id: sessionId, p_screen: screen }), `${screen} snapshot`)
}

async function game(gameId) {
  return data(admin.from('session_games').select('*').eq('id', gameId).single(), 'game row')
}

/** Joins a private topic as this user and records what arrives. */
async function listen(who, topic) {
  await who.client.realtime.setAuth()
  const events = []
  const channel = who.client.channel(topic, { config: { private: true } })
  channel.on('broadcast', { event: '*' }, (message) => events.push({ event: message.event, payload: message.payload ?? {}, at: Date.now() }))
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`joining ${topic.split(':')[0]}: timed out`)), 10_000)
    channel.subscribe((status, error) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer)
        resolve()
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer)
        reject(new Error(`joining ${topic.split(':')[0]}: ${status} ${error?.message ?? ''}`))
      }
    })
  })
  return {
    channel,
    events,
    async waitFor(event, since, test = () => true, timeoutMs = 5000) {
      const until = Date.now() + timeoutMs
      while (Date.now() < until) {
        const hit = events.find((e) => e.event === event && e.at >= since && test(e.payload))
        if (hit) return hit
        await sleep(50)
      }
      throw new Error(`no "${event}" on ${topic.split(':')[0]}: within ${timeoutMs} ms`)
    },
  }
}

// A 1x1 JPEG.
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
)

log(`smoke test: ${local ? 'local stack' : apiHost}, site ${new URL(SITE).host}`)

try {
  await step('the site and the engine', async () => {
    const page = await fetch(`${SITE}/`)
    check(page.ok && (await page.text()).includes('id="root"'), 'the site serves the app')
    const deep = await fetch(`${SITE}/tv/SMOKE`)
    check(deep.ok, 'a deep link (/tv/:code) serves the app too')
    const engineWithoutToken = await fetch(`${SITE}/api/game`, { method: 'POST', body: '{}' })
    check(engineWithoutToken.status === 401, '/api/game answers 401 without a token')
  })

  await step('anon', async () => {
    const anon = client()
    check((await data(anon.rpc('keep_alive'), 'keep_alive')) === true, 'anon may run keep_alive')
    const read = await anon.from('sessions').select('id').limit(1)
    check(read.error !== null || read.data.length === 0, 'anon reads no parties')
  })

  // The host and the party ------------------------------------------------------------------
  const email = `smoke-${stamp.toLowerCase()}@example.com`
  const password = `${crypto.randomUUID()}-Aa1`
  const host = { client: client() }
  let sessionId
  let joinCode
  const games = {}

  await step('a throwaway host and party', async () => {
    const created = await data(admin.auth.admin.createUser({ email, password, email_confirm: true }), 'host user')
    made.users.add(created.user.id)
    host.userId = created.user.id
    await data(admin.from('hosts').insert({ user_id: created.user.id }), 'hosts row')
    const signedIn = await data(host.client.auth.signInWithPassword({ email, password }), 'host sign-in')
    host.token = signedIn.session.access_token
    check((await data(host.client.rpc('is_host'), 'is_host')) === true, 'the host signs in as a host')
    joinCode = `SMK${stamp.slice(-6)}`.slice(0, 12)
    const party = await data(host.client.from('sessions').insert({ name: `Smoke ${stamp}`, join_code: joinCode }).select('id').single(), 'party')
    sessionId = party.id
    made.sessionId = party.id
    const add = async (gameType, title, position) =>
      (await data(host.client.from('session_games').insert({ session_id: sessionId, game_type: gameType, title, position }).select('id').single(), title)).id
    games.elimination = await add('elimination', 'Last one standing', 0)
    games.quiz = await add('quiz', 'Quiz', 1)
    games.fusion = await add('fusion', 'Who is fused?', 2)
    await data(
      host.client.from('game_settings').insert({
        game_id: games.quiz,
        config: {
          seconds: 20,
          pointsPerRight: 1,
          questions: [
            { text: 'Smoke question one', options: ['Wrong', 'Right', 'Wrong too'], correct: 1 },
            { text: 'Smoke question two', options: ['Right', 'Wrong'], correct: 0 },
          ],
        },
      }),
      'quiz settings',
    )
    check(true, `party ${joinCode} with 3 games`)
  })

  // Guests and the TV ---------------------------------------------------------------------------
  const guests = {}
  await step('3 guests join with anonymous sign-ins', async () => {
    for (const name of ['Ana', 'Bo', 'Cy']) {
      const guest = await anonymous(name)
      const found = await data(guest.client.rpc('session_by_code', { p_join_code: joinCode }), 'session_by_code')
      check(found?.id === sessionId, `${name} finds the party by its code`)
      guest.player = await data(guest.client.rpc('join_session', { p_join_code: joinCode, p_name: name }), `${name} joins`)
      guests[name] = guest
    }
    const again = await data(guests.Ana.client.rpc('join_session', { p_join_code: joinCode, p_name: 'Ana' }), 'Ana joins again')
    check(again.id === guests.Ana.player.id, 'joining again from the same phone returns the same player')
    const other = await anonymous('a fourth phone')
    const taken = await other.client.rpc('join_session', { p_join_code: joinCode, p_name: 'bo' })
    check(taken.error?.details === 'name_taken', 'a taken name from another phone is refused (name_taken)')
    const s = await snapshot(guests.Ana, sessionId, 'phone')
    check(s.member && s.players.length === 3 && s.me?.player_id === guests.Ana.player.id, "Ana's snapshot: member, 3 players, herself as me")
  })

  const tv = await anonymous('TV')
  await step('pair a TV', async () => {
    const before = await snapshot(tv, sessionId, 'tv')
    check(before.member === false && before.exists === true, 'an unpaired TV is not a member')
    const code = await data(host.client.rpc('host_issue_screen_code', { p_session_id: sessionId }), 'screen code')
    const paired = await data(tv.client.rpc('claim_screen', { p_code: code.toLowerCase() }), 'claim_screen')
    check(paired === sessionId, 'the TV claims the code')
    check((await snapshot(tv, sessionId, 'tv')).member === true, "the TV's snapshot says member")
    check((await snapshot(host, sessionId, 'host')).screens === 1, 'the host page counts 1 TV')
    const guestCode = await refusal(guests.Ana.client.rpc('host_issue_screen_code', { p_session_id: sessionId }))
    check(guestCode !== null, 'a guest may not issue a TV code')
  })

  // Pings -------------------------------------------------------------------------------------------
  let anaRoom
  let hostStage
  let tvStage
  await step('pings on private topics', async () => {
    anaRoom = await listen(guests.Ana, `room:${sessionId}`)
    await listen(guests.Ana, `player:${guests.Ana.player.id}`)
    hostStage = await listen(host, `stage:${sessionId}`)
    tvStage = await listen(tv, `stage:${sessionId}`)
    const stageRefused = await listen(guests.Bo, `stage:${sessionId}`).then(
      () => false,
      () => true,
    )
    check(stageRefused, 'a guest may not join the stage topic')
    // No insert policy on realtime.messages: a guest's own broadcast on the room topic reaches nobody.
    const boRoom = await listen(guests.Bo, `room:${sessionId}`)
    const forgedAt = Date.now()
    await anaRoom.channel.send({ type: 'broadcast', event: 'changed', payload: { forged: true } })
    await sleep(1500)
    check(!boRoom.events.some((e) => e.at >= forgedAt && e.payload.forged), "a guest's own broadcast never reaches another phone")
    const sentAt = Date.now()
    await data(host.client.from('sessions').update({ name: `Smoke ${stamp} renamed` }).eq('id', sessionId), 'rename')
    const ping = await anaRoom.waitFor('changed', sentAt)
    check(true, `a rename reaches a guest's room topic in ${ping.at - sentAt} ms`)
    const s = await snapshot(guests.Ana, sessionId, 'phone')
    check(s.session.name.endsWith('renamed'), 'the guest reads the new name')
  })

  await step('secrets stay host-only', async () => {
    const settings = await guests.Ana.client.from('game_settings').select('config')
    check(settings.error !== null || settings.data.length === 0, 'a guest reads no game settings')
    const states = await guests.Ana.client.from('game_states').select('state')
    check(states.error !== null || states.data.length === 0, 'a guest reads no game states')
    const logRows = await guests.Ana.client.from('event_log').select('id').limit(1)
    check(logRows.error !== null || logRows.data.length === 0, 'a guest reads no event log')
    const asHost = await snapshot(guests.Ana, sessionId, 'host')
    check(asHost.states === null && asHost.screens === null, "a guest asking for the host's snapshot gets no states")
    const recap = await refusal(guests.Ana.client.rpc('session_recap', { p_session_id: sessionId }))
    check(recap !== null, 'a guest may not read the raw recap')
    const screenSettings = await tv.client.from('game_settings').select('config')
    check(screenSettings.error !== null || screenSettings.data.length === 0, 'the TV reads no game settings')
  })

  // Guest photos (docs/guest-photos.md, 8.3) ----------------------------------------------------------
  await step('guest photos', async () => {
    const ana = guests.Ana
    const photos = (who) => who.client.storage.from('player-photos')
    // Every path goes into made.photos before its upload, so the cleanup deletes whatever got through.
    const newPath = () => {
      const path = `${sessionId}/${ana.player.id}/${crypto.randomUUID()}.jpg`
      made.photos.push(path)
      return path
    }
    const upload = (who, path, body = TINY_JPEG, contentType = 'image/jpeg') =>
      photos(who).upload(path, body, { contentType, upsert: false, cacheControl: '3600' })
    const setAnasPhoto = (who, path) => who.client.rpc('set_my_photo', { p_player_id: ana.player.id, p_path: path })

    const photo = newPath()
    await data(upload(ana, photo), 'photo upload')
    const setAt = Date.now()
    const set = await data(setAnasPhoto(ana, photo), 'set_my_photo')
    check(set.photo === photo && set.previous === null, 'Ana uploads a photo into her own folder and sets it')
    const heard = await tvStage.waitFor('changed', setAt)
    check(true, `the TV hears it on the stage topic in ${heard.at - setAt} ms`)
    const seen = await snapshot(guests.Bo, sessionId, 'phone')
    check(seen.players.find((p) => p.id === ana.player.id)?.photo === photo, "Bo's snapshot has Ana's photo")
    const served = await fetch(photos(ana).getPublicUrl(photo).data.publicUrl)
    check(served.status === 200 && served.headers.get('content-type') === 'image/jpeg', 'its public URL serves a JPEG')

    const intruder = await refusal(upload(guests.Bo, newPath()))
    check(intruder !== null, `Bo's upload into Ana's folder is refused (${intruder?.statusCode})`)
    const notHis = await refusal(setAnasPhoto(guests.Bo, photo))
    check(notHis?.details === 'not_your_player', "Bo may not set Ana's photo (not_your_player)")
    const png = await refusal(upload(ana, newPath(), TINY_JPEG, 'image/png'))
    check(png !== null, `a stated PNG is refused (${png?.statusCode})`)
    const big = await refusal(upload(ana, newPath(), Buffer.concat([TINY_JPEG, Buffer.alloc(70 * 1024)])))
    check(big !== null, `a 70 KB upload is refused (${big?.statusCode})`)
    const second = newPath()
    await data(upload(ana, second), 'second photo upload')
    const soon = await refusal(setAnasPhoto(ana, second))
    check(soon?.details === 'too_soon', 'a second photo at once answers too_soon')
    // The file a photo shows never changes, and no file is served packed: a few KB of brotli can unpack to gigabytes.
    const packed = await refusal(photos(ana).upload(newPath(), TINY_JPEG, { contentType: 'image/jpeg', contentEncoding: 'br' }))
    check(packed !== null, `an upload with Content-Encoding: br is refused (${packed?.statusCode})`)
    const signed = await refusal(photos(ana).createSignedUploadUrl(newPath()))
    check(signed !== null, `a guest may not sign an upload URL (${signed?.statusCode})`)
    const kept = await data(photos(ana).remove([photo]), "Ana's delete of her photo's file")
    check(kept.length === 0, "Ana can't delete the file her photo shows")

    const removedAt = Date.now()
    const removed = await data(host.client.rpc('host_remove_photo', { p_player_id: ana.player.id }), 'host_remove_photo')
    check(removed.previous === photo, "the host's Remove photo returns the photo's path")
    await anaRoom.waitFor('changed', removedAt)
    check(true, "Ana's room topic hears it")
    const after = await snapshot(guests.Bo, sessionId, 'phone')
    check(after.players.find((p) => p.id === ana.player.id)?.photo === null, "Bo's snapshot has no photo for Ana")
    const deleted = await data(photos(host).remove([photo]), 'host deletes the photo')
    check(deleted.length === 1, 'the host deletes the file')
  })

  // Last one standing in the background ---------------------------------------------------------
  await step('Last one standing in the background, with a knockout', async () => {
    await engine(host, { type: 'start', gameId: games.elimination, stage: false })
    const session = await data(admin.from('sessions').select('spotlight_game_id').eq('id', sessionId).single(), 'session')
    check(session.spotlight_game_id === null, 'a background start leaves the TV stage free')
    const views = await snapshot(guests.Ana, sessionId, 'phone')
    check(views.me.views[games.elimination]?.status === 'alive', 'Ana is dealt a secret task')
    const t0 = Date.now()
    await engine(guests.Ana, { type: 'action', gameId: games.elimination, action: { type: 'tag', target: guests.Bo.player.id } })
    log(`      a knockout took ${Date.now() - t0} ms through the engine`)
    const row = await game(games.elimination)
    check(row.public_state.alive.length === 2 && row.public_state.out.includes(guests.Bo.player.id), 'Bo is out, 2 still standing')
    const bo = await snapshot(guests.Bo, sessionId, 'phone')
    check(bo.me.views[games.elimination]?.status === 'out', "Bo's own view says out")
    const again = await fetch(`${SITE}/api/game`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${guests.Bo.token}` },
      body: JSON.stringify({ type: 'action', gameId: games.elimination, action: { type: 'tag', target: guests.Cy.player.id }, requestId: crypto.randomUUID() }),
    })
    check(again.status === 409 || again.status === 422 || again.status === 400, `a player who is out is refused (${again.status})`)
  })

  // The quiz on the stage -------------------------------------------------------------------------
  await step('a 2-question quiz on the stage, to its crown', async () => {
    await engine(host, { type: 'start', gameId: games.quiz, stage: true })
    const session = await data(admin.from('sessions').select('spotlight_game_id').eq('id', sessionId).single(), 'session')
    check(session.spotlight_game_id === games.quiz, 'the quiz takes the TV stage')
    const openedAt = Date.now()
    await engine(host, { type: 'host-action', gameId: games.quiz, action: { type: 'next', from: -1 } })
    const opened = await anaRoom.waitFor('changed', openedAt, (p) => p.prompt === true)
    check(true, `the question opens with a prompt ping (${opened.at - openedAt} ms)`)
    let row = await game(games.quiz)
    check(!JSON.stringify(row.public_state).includes('"correct"'), "the quiz's public state holds no right answer before its reveal")
    const tallySince = Date.now()
    const a = await data(
      guests.Ana.client.rpc('submit_answer', { p_game_id: games.quiz, p_key: 'q1', p_payload: { choice: ['1'] }, p_request_id: crypto.randomUUID() }),
      'Ana answers',
    )
    await data(
      guests.Cy.client.rpc('submit_answer', { p_game_id: games.quiz, p_key: 'q1', p_payload: { choice: ['0'] }, p_request_id: crypto.randomUUID() }),
      'Cy answers',
    )
    check(a.accepted === true, 'answers go straight to the database')
    const tally = await hostStage.waitFor('tally', tallySince, (p) => p.count === 2)
    check(true, `the host hears the tally (2 answers) in ${tally.at - tallySince} ms`)
    await tvStage.waitFor('tally', tallySince, (p) => p.count === 2)
    check(true, 'the TV hears it too')
    await engine(host, { type: 'host-action', gameId: games.quiz, action: { type: 'reveal', index: 0 }, close: ['q1'] })
    row = await game(games.quiz)
    check(row.public_state.reveal?.answered === 2 && row.public_state.reveal?.rightCount === 1, 'the reveal counts 2 answers, 1 right')
    const late = await refusal(
      guests.Bo.client.rpc('submit_answer', { p_game_id: games.quiz, p_key: 'q1', p_payload: { choice: ['1'] }, p_request_id: crypto.randomUUID() }),
    )
    check(late !== null, 'an answer after the reveal is refused')
    await engine(host, { type: 'host-action', gameId: games.quiz, action: { type: 'leaderboard', index: 0 } })
    await engine(host, { type: 'host-action', gameId: games.quiz, action: { type: 'next', from: 0 } })
    await data(
      guests.Cy.client.rpc('submit_answer', { p_game_id: games.quiz, p_key: 'q2', p_payload: { choice: ['1'] }, p_request_id: crypto.randomUUID() }),
      'Cy answers q2',
    )
    await engine(host, { type: 'host-action', gameId: games.quiz, action: { type: 'reveal', index: 1 }, close: ['q2'] })
    const skipped = await engine(host, { type: 'host-action', gameId: games.quiz, action: { type: 'reveal', index: 1 }, close: ['q2'] })
    check(skipped.skipped === true || skipped.replayed === true, 'a repeated Reveal is skipped')
    await engine(host, { type: 'host-action', gameId: games.quiz, action: { type: 'finish' } })
    row = await game(games.quiz)
    check(row.status === 'finished' && row.finished_by === 'game', 'Crown the winner finishes the quiz by itself')
    check(row.winners.length === 1 && row.winners[0] === guests.Ana.player.id, 'Ana, the only right answer, wins')
    const after = await data(admin.from('sessions').select('spotlight_game_id').eq('id', sessionId).single(), 'session')
    check(after.spotlight_game_id === games.quiz, 'its final screen holds the TV')
  })

  // Fusion ------------------------------------------------------------------------------------------
  await step('fusion on the stage: ask a picture, locks, Reveal now, crown', async () => {
    await data(
      host.client.from('game_settings').insert({
        game_id: games.fusion,
        config: { pictures: [{ label: '#1', people: [guests.Bo.player.id, guests.Cy.player.id] }], pointsPerPerson: 1, bonusForBoth: 1, seconds: 30, showSeconds: 3 },
      }),
      'fusion settings',
    )
    await engine(host, { type: 'start', gameId: games.fusion, stage: true })
    const session = await data(admin.from('sessions').select('spotlight_game_id').eq('id', sessionId).single(), 'session')
    check(session.spotlight_game_id === games.fusion, 'fusion takes the TV stage')
    let row = await game(games.fusion)
    check(row.public_state.phase === 'lobby', 'it opens on its lobby')
    await engine(host, { type: 'host-action', gameId: games.fusion, action: { type: 'ask', n: 1 } })
    row = await game(games.fusion)
    check(row.public_state.phase === 'asking' && row.public_state.current?.n === 1, 'the host asks picture #1')
    check(!JSON.stringify(row.public_state).includes(guests.Bo.player.id), 'who is in the picture stays secret before its reveal')
    const lock = (who, choice) =>
      who.client.rpc('submit_answer', { p_game_id: games.fusion, p_key: 'p1', p_payload: { choice }, p_request_id: crypto.randomUUID() })
    const locked = await data(lock(guests.Ana, [guests.Bo.player.id, guests.Cy.player.id]), 'Ana locks in')
    check(locked.accepted === true, 'a lock goes straight to the database')
    // With three guests Ana has one possible pair, so a changed lock can't be tried here (the unit tests refuse it):
    // the same lock sent again counts once.
    const again = await data(lock(guests.Ana, [guests.Cy.player.id, guests.Bo.player.id]), 'Ana sends her lock again')
    check(again.accepted === true && again.replayed === true, 'the same lock sent again counts once')
    const invalid = await refusal(lock(guests.Ana, [guests.Ana.player.id, guests.Bo.player.id]))
    check(invalid !== null, 'a lock on yourself is refused')
    await data(lock(guests.Bo, [guests.Ana.player.id, guests.Cy.player.id]), 'Bo, who is in it, locks in')
    await engine(host, { type: 'host-action', gameId: games.fusion, action: { type: 'reveal', n: 1 }, close: ['p1'] })
    row = await game(games.fusion)
    const picture = row.public_state.pictures[0]
    check(picture.revealed?.both === 1 && picture.revealed?.voters === 1, 'Reveal now scores Ana, who got both; Bo, in it, counts for nothing')
    const scores = await data(admin.from('game_scores').select('player_id, points').eq('game_id', games.fusion), 'fusion scores')
    check(scores.length === 1 && scores[0].player_id === guests.Ana.player.id && scores[0].points === 3, 'Ana has 3 points: both, plus the bonus')
    await engine(host, { type: 'host-action', gameId: games.fusion, action: { type: 'finish' } })
    row = await game(games.fusion)
    check(row.status === 'finished' && row.winners[0] === guests.Ana.player.id, 'fusion finishes with Ana as the face detective')
  })

  // Points, a new phone, the recap -------------------------------------------------------------------
  await step('a host award and its undo', async () => {
    const award = await data(
      host.client.from('score_events').insert({ session_id: sessionId, player_id: guests.Cy.player.id, points: 3, reason: 'Smoke' }).select('id').single(),
      'award',
    )
    let s = await snapshot(guests.Cy, sessionId, 'phone')
    const points = s.standings.find((r) => r.player_id === guests.Cy.player.id)?.points ?? 0
    check(points >= 3, `the award shows in the standings (${points} points)`)
    await data(host.client.from('score_events').delete().eq('id', award.id), 'undo')
    s = await snapshot(guests.Cy, sessionId, 'phone')
    check((s.standings.find((r) => r.player_id === guests.Cy.player.id)?.points ?? 0) === points - 3, 'Undo takes it back')
    const guestAward = await refusal(
      guests.Ana.client.from('score_events').insert({ session_id: sessionId, player_id: guests.Ana.player.id, points: 100 }),
    )
    check(guestAward !== null, 'a guest may not give points')
  })

  await step('move a player to a new phone', async () => {
    const code = await data(host.client.rpc('host_issue_transfer', { p_player_id: guests.Cy.player.id }), 'transfer code')
    const phone = await anonymous('new phone')
    const cyPlayer = await listen(guests.Cy, `player:${guests.Cy.player.id}`)
    const movedSince = Date.now()
    const claimed = await data(phone.client.rpc('claim_player', { p_code: code }), 'claim_player')
    check(claimed.id === guests.Cy.player.id, 'the new phone gets the same player')
    await cyPlayer.waitFor('moved', movedSince)
    check(true, 'the old phone hears "moved"')
    check((await snapshot(guests.Cy, sessionId, 'phone')).member === false, 'the old phone is no longer a member')
    check((await snapshot(phone, sessionId, 'phone')).me?.player_id === guests.Cy.player.id, 'the new phone plays as Cy')
    const reused = await refusal(phone.client.rpc('claim_player', { p_code: code }))
    check(reused !== null, 'a code works once')
  })

  await step('the recap: read, publish, read back, unpublish', async () => {
    const raw = await data(host.client.rpc('session_recap', { p_session_id: sessionId }), 'session_recap')
    check(Array.isArray(raw.games) && raw.games.length === 3 && Array.isArray(raw.log), `the raw recap holds 3 games and ${raw.log.length} log rows`)
    const doc = { version: 1, session: { id: sessionId, name: raw.session.name }, generatedAt: Date.now(), smoke: true }
    await data(host.client.from('session_recaps').upsert({ session_id: sessionId, data: doc, published_at: new Date().toISOString() }), 'publish')
    const s = await snapshot(guests.Ana, sessionId, 'phone')
    check(s.recap?.published_at > 0, "a guest's snapshot sees the published recap")
    const read = await data(guests.Ana.client.from('session_recaps').select('data').eq('session_id', sessionId).single(), 'guest reads the recap')
    check(read.data.smoke === true, 'a guest reads the published doc')
    await data(host.client.from('session_recaps').update({ published_at: null }).eq('session_id', sessionId), 'unpublish')
    const hidden = await guests.Ana.client.from('session_recaps').select('data').eq('session_id', sessionId)
    check(hidden.error !== null || hidden.data.length === 0, 'an unpublished recap is hidden from guests')
  })

  await step('game media', async () => {
    const path = `${sessionId}/${games.fusion}/${crypto.randomUUID()}.jpg`
    made.media.push(path)
    await data(host.client.storage.from('game-media').upload(path, TINY_JPEG, { contentType: 'image/jpeg' }), 'host upload')
    const url = host.client.storage.from('game-media').getPublicUrl(path).data.publicUrl
    const download = await fetch(url)
    check(download.ok, 'the host uploads a JPEG and it is public')
    const guestUpload = await refusal(
      guests.Ana.client.storage.from('game-media').upload(`${sessionId}/${games.fusion}/${crypto.randomUUID()}.jpg`, TINY_JPEG, { contentType: 'image/jpeg' }),
    )
    check(guestUpload !== null, 'a guest may not upload')
  })

  await step('end, unpair, and the TV falls back', async () => {
    await engine(host, { type: 'end', gameId: games.elimination })
    const row = await game(games.elimination)
    check(row.status === 'finished' && row.finished_by === 'host', 'End finishes Last one standing')
    await data(host.client.from('session_screens').delete().eq('session_id', sessionId), 'unpair')
    check((await snapshot(tv, sessionId, 'tv')).member === false, 'the unpaired TV is no longer a member')
    const sync = await fetch(`${SITE}/api/game`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tv.token}` },
      body: JSON.stringify({ type: 'sync', gameId: games.quiz, requestId: crypto.randomUUID() }),
    })
    check(sync.status === 403 || sync.status === 404, `the unpaired TV's sync is refused (${sync.status})`)
  })

  await step('delete the party', async () => {
    const deletedSince = Date.now()
    await data(host.client.from('sessions').delete().eq('id', sessionId), 'delete')
    await anaRoom.waitFor('changed', deletedSince, (p) => p.deleted === true)
    check(true, 'the room hears that the party was deleted')
    const s = await snapshot(guests.Ana, sessionId, 'phone')
    check(s.exists === false, 'the party is gone for its guests')
    made.sessionId = null
  })
} catch {
  // Reported by its step; the cleanup below still runs.
} finally {
  log('cleanup')
  for (const c of made.clients) {
    try {
      await c.removeAllChannels()
    } catch {
      // Already closed.
    }
  }
  if (made.media.length > 0) {
    const { error } = await admin.storage.from('game-media').remove(made.media)
    log(error ? `  could not delete the uploaded image: ${error.message}` : `  deleted ${made.media.length} uploaded image`)
  }
  if (made.photos.length > 0) {
    const { data: removed, error } = await admin.storage.from('player-photos').remove(made.photos)
    log(error ? `  could not delete the photos: ${error.message}` : `  deleted ${removed.length} uploaded photo file${removed.length === 1 ? '' : 's'}`)
  }
  if (made.sessionId) {
    const { error } = await admin.from('sessions').delete().eq('id', made.sessionId)
    log(error ? `  could not delete the party: ${error.message}` : '  deleted the party')
  }
  let deleted = 0
  for (const id of made.users) {
    const { error } = await admin.auth.admin.deleteUser(id)
    if (error) log(`  could not delete a user: ${error.message}`)
    else deleted++
  }
  log(`  deleted ${deleted} of ${made.users.size} users`)
  log(failures === 0 ? 'PASS' : 'FAIL')
  process.exit(failures === 0 ? 0 : 1)
}
