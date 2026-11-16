// Guest photos against the local stack (docs/guest-photos.md, 8.2): who may
// upload into which folder of the player-photos bucket, what set_my_photo and
// host_remove_photo check, what every screen's snapshot shows, and that each
// change is logged once, never with its file, and pings the stage (a guest's
// own change) or the room (the host's). On the shared stack it runs alone:
// `INTEGRATION=1 npx vitest run photos.integration`. Deleting the parties and
// users leaves their files, so every path a test tried is deleted at the end
// with the secret key.
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { admin, anonClient, rows, sleep, sql, World, type Guest, type Party, type Person } from './testUsers'

const BUCKET = 'player-photos'
const world = new World()
let host: Person
let party: Party
let ana: Guest
let bo: Guest
let tv: Person
let outsider: Person
let other: Party
let cy: Guest
let tvStage: Listener
let boRoom: Listener

// Pings: the realtime test's helpers -------------------------------------------------------

type Heard = { event: string; payload: Record<string, unknown> }
type Listener = { status: string; heard: Heard[]; channel: RealtimeChannel; close: () => Promise<unknown> }
const listeners: Listener[] = []

/** Joins a private topic as this person (anon with null) and records what arrives. */
async function listen(person: Person | null, topic: string): Promise<Listener> {
  const client: SupabaseClient = person ? person.client : anonClient()
  if (person) await client.realtime.setAuth(person.token)
  const heard: Heard[] = []
  const channel = client.channel(topic, { config: { private: true } })
  channel.on('broadcast', { event: '*' }, (message) => heard.push({ event: message.event, payload: message.payload }))
  const status = await new Promise<string>((resolve) => {
    const timer = setTimeout(() => resolve('TIMED_OUT'), 8000)
    channel.subscribe((state) => {
      if (state === 'SUBSCRIBED' || state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
        clearTimeout(timer)
        resolve(state)
      }
    })
  })
  const listener = { status, heard, channel, close: () => client.removeChannel(channel) }
  // A refused channel would keep rejoining on this socket: leave it at once.
  if (status !== 'SUBSCRIBED') await listener.close()
  else listeners.push(listener)
  return listener
}

/** Forgets what was heard, for the next step. */
const reset = (...all: Listener[]) => all.forEach((l) => l.heard.splice(0))

/** The changed pings a listener heard since its last reset. */
const pings = (listener: Listener) => listener.heard.filter((h) => h.event === 'changed').length

/** Waits until the listener has heard `count` changed pings, then a moment more, and expects exactly `count`. */
async function expectPings(listener: Listener, count: number) {
  const until = Date.now() + 5000
  while (pings(listener) < count && Date.now() < until) await sleep(50)
  await sleep(500)
  expect(pings(listener)).toBe(count)
}

/** Lets the pings already sent arrive, then forgets them. */
async function settle() {
  await sleep(500)
  reset(tvStage, boRoom)
}

// Files ------------------------------------------------------------------------------------

/** Every path a test tried to write: deleted after the tests with the secret key. */
const tried = new Set<string>()

/** `size` bytes with a JPEG's first and last bytes, stating `type`: Storage checks the stated type, not the picture. */
function jpeg(size = 14, type = 'image/jpeg'): Blob {
  const bytes = new Uint8Array(size)
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1])
  bytes.set([0xff, 0xd9], size - 2)
  return new Blob([bytes], { type })
}

/** An upload as the app makes one (media.ts): no upsert, cached an hour. */
function upload(client: SupabaseClient, path: string, body: Blob = jpeg(), upsert = false) {
  tried.add(path)
  return client.storage.from(BUCKET).upload(path, body, { contentType: body.type, upsert, cacheControl: '3600' })
}

/** 'ok', or the status Storage refused with: the one in its body, which the app reads (media.ts, storageFailure). */
const outcome = (result: { error: { statusCode?: string } | null }) => (result.error ? result.error.statusCode : 'ok')

const folder = (guest: Guest, of: Party = party) => `${of.id}/${guest.playerId}`
const newPath = (guest: Guest, of: Party = party) => `${folder(guest, of)}/${crypto.randomUUID()}.jpg`
const fileName = (path: string) => path.split('/').pop()
const publicUrl = (path: string) => admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl

/** The names in a folder, as this client may list them. */
async function names(client: SupabaseClient, prefix: string): Promise<string[]> {
  const { data, error } = await client.storage.from(BUCKET).list(prefix)
  expect(error).toBeNull()
  return (data ?? []).map((entry) => entry.name).sort()
}

// Photos -----------------------------------------------------------------------------------

const setPhoto = (guest: Guest, path: string | null, client: SupabaseClient = guest.client) =>
  client.rpc('set_my_photo', { p_player_id: guest.playerId, p_path: path })

/** Moves the guest's last photo 11 s back with the secret key, instead of waiting out the 10 s throttle. */
const backdate = (guest: Guest) =>
  sql(`update public.players set photo_set_at = clock_timestamp() - interval '11 seconds' where id = '${guest.playerId}'`)

/** Uploads a new photo into the guest's folder and sets it; returns its path. */
async function addPhoto(guest: Guest, of: Party = party): Promise<string> {
  const path = newPath(guest, of)
  expect(outcome(await upload(guest.client, path))).toBe('ok')
  expect((await setPhoto(guest, path)).error).toBeNull()
  return path
}

/** Where most tests start: no photo, an empty folder, and free to set a photo at once. */
async function fresh(guest: Guest) {
  const [player] = await rows<{ photo: string | null }>('players', 'id', guest.playerId)
  if (player.photo) expect((await setPhoto(guest, null)).error).toBeNull()
  const paths = (await names(admin, folder(guest))).map((name) => `${folder(guest)}/${name}`)
  if (paths.length > 0) expect((await admin.storage.from(BUCKET).remove(paths)).error).toBeNull()
  await backdate(guest)
}

type Snapshot = { member: boolean; players: { id: string; photo?: string | null }[] }
async function snapshot(person: Person, screen: 'phone' | 'tv' | 'host'): Promise<Snapshot> {
  const { data, error } = await person.client.rpc('session_snapshot', { p_session_id: party.id, p_screen: screen })
  expect(error).toBeNull()
  return data
}
const photoIn = (snap: Snapshot, guest: Guest) => snap.players.find((p) => p.id === guest.playerId)?.photo

type LogRow = { actor: string; player_id: string; about: string[]; data: Record<string, unknown> }
/** The party's player.photo_changed rows after log row `since`, oldest first. */
async function photoLog(since: number): Promise<LogRow[]> {
  const { data, error } = await admin
    .from('event_log')
    .select('*')
    .eq('session_id', party.id)
    .eq('kind', 'player.photo_changed')
    .gt('id', since)
    .order('id')
  if (error) throw error
  return data
}
const lastLogId = async (): Promise<number> =>
  (await admin.from('event_log').select('id').order('id', { ascending: false }).limit(1)).data?.[0]?.id ?? 0

beforeAll(async () => {
  host = await world.host()
  party = await world.party(host, 'Photos test')
  ana = await world.guest(party, 'Ana')
  bo = await world.guest(party, 'Bo')
  tv = await world.screen(host, party)
  outsider = await world.user()
  other = await world.party(host, 'Photos test, the other party')
  cy = await world.guest(other, 'Cy')
  tvStage = await listen(tv, `stage:${party.id}`)
  boRoom = await listen(bo, `room:${party.id}`)
  expect([tvStage.status, boRoom.status]).toEqual(['SUBSCRIBED', 'SUBSCRIBED'])
})

afterAll(async () => {
  for (const l of listeners) await l.close()
  const paths = [...tried]
  for (let i = 0; i < paths.length; i += 100) await admin.storage.from(BUCKET).remove(paths.slice(i, i + 100))
  await world.cleanup()
})

it('a guest uploads into her own folder and sets it; every screen of her party reads it', async () => {
  await fresh(ana)
  const path = newPath(ana)
  expect(outcome(await upload(ana.client, path))).toBe('ok')
  expect(await setPhoto(ana, path)).toMatchObject({ data: { photo: path, previous: null }, error: null })
  for (const [person, screen] of [[bo, 'phone'], [tv, 'tv'], [host, 'host']] as const) {
    const snap = await snapshot(person, screen)
    expect(photoIn(snap, ana), screen).toBe(path)
    expect(photoIn(snap, bo), screen).toBeNull()
    expect(JSON.stringify(snap), screen).not.toContain('photo_set_at')
  }
  expect(await snapshot(outsider, 'phone')).toMatchObject({ member: false, players: [] })
  const served = await fetch(publicUrl(path))
  expect(served.status).toBe(200)
  expect(served.headers.get('content-type')).toBe('image/jpeg')
  expect(served.headers.get('cache-control')).toContain('max-age=3600')
})

it("a guest can't write another guest's folder or another party's, a wrong path, or over a file", async () => {
  await fresh(ana)
  const path = newPath(ana)
  const original = jpeg()
  expect(outcome(await upload(ana.client, path, original))).toBe('ok')
  expect(outcome(await upload(bo.client, newPath(ana)))).toBe('403')
  expect(outcome(await upload(ana.client, newPath(ana, other)))).toBe('403')
  const id = crypto.randomUUID()
  // A fourth segment, another ending, upper case, no party segment.
  for (const wrong of [
    `${folder(ana)}/x/${id}.jpg`,
    `${folder(ana)}/${id}.png`,
    `${folder(ana)}/${id.toUpperCase()}.jpg`,
    `${ana.playerId}/${id}.jpg`,
  ]) {
    expect(outcome(await upload(ana.client, wrong)), wrong).toBe('403')
  }
  // Her own file can't be overwritten: no upload replaces one, and an upsert has no update policy.
  expect(outcome(await upload(ana.client, path, jpeg(40)))).toBe('409')
  expect(outcome(await upload(ana.client, path, jpeg(40), true))).not.toBe('ok')
  const stored = await (await fetch(publicUrl(path))).arrayBuffer()
  expect(new Uint8Array(stored)).toEqual(new Uint8Array(await original.arrayBuffer()))
})

it("anon, a signed-in outsider and a paired TV can't upload anywhere in the bucket", async () => {
  for (const [who, client] of [['anon', anonClient()], ['outsider', outsider.client], ['TV', tv.client]] as const) {
    expect(outcome(await upload(client, newPath(ana))), who).toBe('403')
    const madeUp = `${crypto.randomUUID()}/${crypto.randomUUID()}/${crypto.randomUUID()}.jpg`
    expect(outcome(await upload(client, madeUp)), who).toBe('403')
  }
})

it('a file over 64 KB and a stated PNG are refused; a 60 KB JPEG uploads but is never set', async () => {
  await fresh(ana)
  expect(outcome(await upload(ana.client, newPath(ana), jpeg(70 * 1024)))).toBe('413')
  expect(outcome(await upload(ana.client, newPath(ana), jpeg(14, 'image/png')))).toBe('415')
  const big = newPath(ana)
  expect(outcome(await upload(ana.client, big, jpeg(60 * 1024)))).toBe('ok')
  expect((await setPhoto(ana, big)).error).toMatchObject({ code: 'PT415', details: 'bad_file' })
  expect((await ana.client.storage.from(BUCKET).remove([big])).data).toHaveLength(1)
  expect(await names(ana.client, folder(ana))).toEqual([])
})

it('a copy given another type is refused', async () => {
  await fresh(ana)
  const source = await addPhoto(ana)
  // POST /storage/v1/object/copy as Ana, with copyMetadata false: the copy states the type it asks for.
  const copy = (target: string, metadata?: { mimetype: string }) => {
    tried.add(target)
    return ana.client.storage.from(BUCKET).copy(source, target, { copyMetadata: false, metadata })
  }
  for (const mimetype of ['text/html', 'image/svg+xml']) {
    const target = newPath(ana)
    expect(outcome(await copy(target, { mimetype })), mimetype).toBe('403')
    expect((await fetch(publicUrl(target))).status, mimetype).not.toBe(200)
  }
  const target = newPath(ana)
  expect(outcome(await copy(target))).toBe('ok')
  const served = await fetch(publicUrl(target))
  expect(served.status).toBe(200)
  expect(served.headers.get('content-type')).toBe('image/jpeg')
})

it("set_my_photo refuses another player, a path outside the folder and a file that isn't there", async () => {
  await fresh(ana)
  await fresh(bo)
  const hers = newPath(ana)
  const his = newPath(bo)
  expect(outcome(await upload(ana.client, hers))).toBe('ok')
  expect(outcome(await upload(bo.client, his))).toBe('ok')
  expect((await setPhoto(ana, hers, bo.client)).error).toMatchObject({ code: 'PT403', details: 'not_your_player' })
  expect((await setPhoto(ana, his)).error).toMatchObject({ code: 'PT400', details: 'bad_path' })
  expect((await setPhoto(ana, newPath(ana))).error).toMatchObject({ code: 'PT409', details: 'not_uploaded' })
  expect((await setPhoto(ana, hers, anonClient())).error?.code).toBe('42501')
  // No client writes the columns themselves, not even a host.
  for (const person of [ana, host]) {
    for (const change of [{ photo: hers }, { photo_set_at: new Date().toISOString() }]) {
      expect((await person.client.from('players').update(change).eq('id', ana.playerId)).error?.code).toBe('42501')
    }
  }
  expect((await rows<{ photo: string | null }>('players', 'id', ana.playerId))[0].photo).toBeNull()
})

it('a second photo within 10 s is throttled, and costs nothing', async () => {
  await fresh(ana)
  const first = await addPhoto(ana)
  await settle()
  const since = await lastLogId()
  const second = newPath(ana)
  expect(outcome(await upload(ana.client, second))).toBe('ok')
  const { error } = await setPhoto(ana, second)
  expect(error).toMatchObject({ code: 'PT429', details: 'too_soon' })
  expect(Number(error?.hint)).toBeGreaterThanOrEqual(1)
  expect(Number(error?.hint)).toBeLessThanOrEqual(10_000)
  // The photo she already has: no error, and nothing changes.
  expect(await setPhoto(ana, first)).toMatchObject({ data: { photo: first, previous: first }, error: null })
  await sleep(1000)
  expect([pings(tvStage), pings(boRoom)]).toEqual([0, 0])
  expect(await photoLog(since)).toEqual([])
  // Removing is never throttled (and the TV hears it, so the silence above was real); a new photo right after
  // still is throttled, and 11 s later it isn't.
  expect(await setPhoto(ana, null)).toMatchObject({ data: { photo: null, previous: first }, error: null })
  await expectPings(tvStage, 1)
  expect((await setPhoto(ana, second)).error).toMatchObject({ code: 'PT429', details: 'too_soon' })
  await backdate(ana)
  expect(await setPhoto(ana, second)).toMatchObject({ data: { photo: second, previous: null }, error: null })
})

it('only the owner and hosts list and delete', async () => {
  await fresh(ana)
  const path = await addPhoto(ana)
  expect(await names(bo.client, folder(ana))).toEqual([])
  // A delete of a file Bo can't see changes nothing.
  expect(await bo.client.storage.from(BUCKET).remove([path])).toMatchObject({ data: [], error: null })
  expect(await names(ana.client, folder(ana))).toEqual([fileName(path)])
  expect(await names(host.client, folder(ana))).toEqual([fileName(path)])
})

it("the host removes a photo and deletes its file; a guest can't", async () => {
  await fresh(ana)
  const path = await addPhoto(ana)
  const remove = (person: Person, playerId = ana.playerId) => person.client.rpc('host_remove_photo', { p_player_id: playerId })
  expect((await remove(bo)).error).toMatchObject({ code: 'PT403', details: 'not_host' })
  expect(await remove(host)).toMatchObject({ data: { photo: null, previous: path }, error: null })
  expect(photoIn(await snapshot(bo, 'phone'), ana)).toBeNull()
  expect((await host.client.storage.from(BUCKET).remove([path])).data?.map((file) => file.name)).toEqual([path])
  expect((await fetch(publicUrl(path))).status).not.toBe(200)
  // A player without a photo is no error; a player who isn't there is.
  expect(await remove(host)).toMatchObject({ data: { photo: null, previous: null }, error: null })
  expect((await remove(host, crypto.randomUUID())).error).toMatchObject({ code: 'PT404', details: 'not_found' })
  expect(outcome(await upload(host.client, newPath(ana)))).toBe('403')
})

it("the host lists and deletes a guest's folder and a party's folders", async () => {
  await fresh(ana)
  await fresh(bo)
  const hers = [newPath(ana), newPath(ana)]
  const his = newPath(bo)
  for (const path of hers) expect(outcome(await upload(ana.client, path))).toBe('ok')
  expect(outcome(await upload(bo.client, his))).toBe('ok')
  // What removePlayer and deleteSession rely on (docs/guest-photos.md, 4.3): one folder per player, then their files.
  expect(await names(host.client, party.id)).toEqual([ana.playerId, bo.playerId].sort())
  expect(await names(host.client, folder(ana))).toEqual(hers.map(fileName).sort())
  expect(await names(host.client, folder(bo))).toEqual([fileName(his)])
  expect((await host.client.storage.from(BUCKET).remove([...hers, his])).data).toHaveLength(3)
  expect(await names(host.client, party.id)).toEqual([])
})

it('each change is logged once, never the file, and pings the stage, or the room for a host', async () => {
  await fresh(ana)
  await settle()
  const since = await lastLogId()
  // Ana adds, replaces and removes: one changed on the stage each, none on the room.
  const first = await addPhoto(ana)
  await expectPings(tvStage, 1)
  await backdate(ana)
  const second = newPath(ana)
  expect(outcome(await upload(ana.client, second))).toBe('ok')
  expect(await setPhoto(ana, second)).toMatchObject({ data: { photo: second, previous: first }, error: null })
  await expectPings(tvStage, 2)
  expect(await setPhoto(ana, null)).toMatchObject({ data: { photo: null, previous: second }, error: null })
  await expectPings(tvStage, 3)
  expect(pings(boRoom)).toBe(0)
  const own = await photoLog(since)
  expect(own.map((row) => [row.actor, row.data.change])).toEqual([['player', 'added'], ['player', 'replaced'], ['player', 'removed']])
  for (const row of own) expect(row).toMatchObject({ player_id: ana.playerId, about: [ana.playerId], data: { name: 'Ana', player_id: ana.playerId } })

  // The host's removal pings the room once and is logged as the host's.
  await backdate(ana)
  await addPhoto(ana)
  await settle()
  expect((await host.client.rpc('host_remove_photo', { p_player_id: ana.playerId })).error).toBeNull()
  await expectPings(boRoom, 1)
  const all = await photoLog(since)
  expect(all.map((row) => [row.actor, row.data.change])).toEqual([
    ['player', 'added'], ['player', 'replaced'], ['player', 'removed'], ['player', 'added'], ['host', 'removed'],
  ])
  // Never the file: the data is exactly the name, the player and the change, and no column holds a path.
  for (const row of all) {
    expect(Object.keys(row.data).sort()).toEqual(['change', 'name', 'player_id'])
    expect(JSON.stringify(row)).not.toContain('.jpg')
  }

  // The same path set twice: one row, one ping.
  await backdate(ana)
  await settle()
  const before = await lastLogId()
  const twice = newPath(ana)
  expect(outcome(await upload(ana.client, twice))).toBe('ok')
  expect((await setPhoto(ana, twice)).error).toBeNull()
  expect((await setPhoto(ana, twice)).error).toBeNull()
  await expectPings(tvStage, 1)
  expect((await photoLog(before)).map((row) => row.data.change)).toEqual(['added'])
})

it('a folder holds at most 10 files, for the app', async () => {
  await fresh(ana)
  const ten = Array.from({ length: 10 }, () => newPath(ana))
  for (const path of ten) expect(outcome(await upload(admin, path))).toBe('ok')
  const eleventh = newPath(ana)
  expect(outcome(await upload(ana.client, eleventh))).toBe('403')
  expect((await ana.client.storage.from(BUCKET).remove([ten[0]])).data).toHaveLength(1)
  expect(outcome(await upload(ana.client, eleventh))).toBe('ok')
})

it('after the party, no new photos, and removing still works', async () => {
  const kept = await addPhoto(cy, other)
  const next = newPath(cy, other)
  expect(outcome(await upload(cy.client, next))).toBe('ok')
  expect((await host.client.from('sessions').update({ archived_at: new Date().toISOString() }).eq('id', other.id)).error).toBeNull()
  expect(outcome(await upload(cy.client, newPath(cy, other)))).toBe('403')
  expect((await setPhoto(cy, next)).error).toMatchObject({ code: 'PT409', details: 'archived' })
  expect(await setPhoto(cy, null)).toMatchObject({ data: { photo: null, previous: kept }, error: null })
})

it("renames and the engine's profile updates still work with a photo set", async () => {
  await fresh(ana)
  const path = await addPhoto(ana)
  const rename = await host.client.from('players').update({ name: 'Ana Photo' }).eq('id', ana.playerId).select('name, photo')
  expect(rename).toMatchObject({ data: [{ name: 'Ana Photo', photo: path }], error: null })
  // As game_commit writes a profile: as service_role, which Postgres checks against every constraint of the row.
  const profile = await admin.from('players').update({ profile: { lives: 2 } }).eq('id', ana.playerId).select('profile, photo')
  expect(profile).toMatchObject({ data: [{ profile: { lives: 2 }, photo: path }], error: null })
})

// Last: Ana's first phone owns nothing after this.
it('the folder follows the player to a new phone', async () => {
  await fresh(ana)
  const old = await addPhoto(ana)
  const { data: code, error } = await host.client.rpc('host_issue_transfer', { p_player_id: ana.playerId })
  expect(error).toBeNull()
  const phone = await world.user()
  expect((await phone.client.rpc('claim_player', { p_code: code })).error).toBeNull()
  // The new phone lists the folder, replaces the photo and deletes the old file.
  expect(await names(phone.client, folder(ana))).toEqual([fileName(old)])
  await backdate(ana)
  const next = newPath(ana)
  expect(outcome(await upload(phone.client, next))).toBe('ok')
  expect(await setPhoto(ana, next, phone.client)).toMatchObject({ data: { photo: next, previous: old }, error: null })
  expect((await phone.client.storage.from(BUCKET).remove([old])).data).toHaveLength(1)
  // The old phone sees, uploads and sets nothing.
  expect(await names(ana.client, folder(ana))).toEqual([])
  expect(outcome(await upload(ana.client, newPath(ana)))).toBe('403')
  expect((await setPhoto(ana, next)).error).toMatchObject({ code: 'PT403', details: 'not_your_player' })
})
