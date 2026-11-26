// Pings on private Broadcast topics, through the real local Realtime with real
// tokens (docs/engine-v2.md, 2.10 and 9.2): who may listen where, and which
// saves send which ping.
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { anonClient, engine, sleep, sql, World, type Guest, type Party, type Person } from './testUsers'

type Heard = { event: string; payload: Record<string, unknown> }
type Listener = { status: string; heard: Heard[]; channel: RealtimeChannel; close: () => Promise<unknown> }

const world = new World()
const listeners: Listener[] = []
let host: Person
let party: Party
let ana: Guest
let bo: Guest
let tv: Person
let outsider: Person
let gameId: string

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

/** Waits until a heard message matches, or fails after `ms`. */
async function hear(listener: Listener, match: (h: Heard) => boolean, ms = 5000): Promise<Heard> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const found = listener.heard.find(match)
    if (found) return found
    await sleep(50)
  }
  throw new Error(`Nothing matching arrived; heard ${JSON.stringify(listener.heard)}`)
}

/** Forgets what was heard, for the next step. */
const reset = (...all: Listener[]) => all.forEach((l) => l.heard.splice(0))

beforeAll(async () => {
  host = await world.host()
  party = await world.party(host, 'Realtime test')
  ana = await world.guest(party, 'Ana')
  bo = await world.guest(party, 'Bo')
  tv = await world.screen(host, party)
  outsider = await world.user()
  gameId = await world.game(host, party, 'lab', 'Lab')
  await engine(host, { type: 'start', gameId, stage: false })
})

afterAll(async () => {
  for (const l of listeners) await l.close()
  await world.cleanup()
})

describe('who may listen', () => {
  // Each check joins its own channels; leave them, so a topic can be joined afresh later.
  afterEach(async () => {
    for (const l of listeners.splice(0)) await l.close()
  })

  it('lets members join the room, and refuses outsiders, anon and guests on the stage', async () => {
    expect((await listen(ana, `room:${party.id}`)).status).toBe('SUBSCRIBED')
    expect((await listen(host, `room:${party.id}`)).status).toBe('SUBSCRIBED')
    expect((await listen(outsider, `room:${party.id}`)).status).toBe('CHANNEL_ERROR')
    expect((await listen(null, `room:${party.id}`)).status).toBe('CHANNEL_ERROR')
    expect((await listen(ana, `stage:${party.id}`)).status).toBe('CHANNEL_ERROR')
    expect((await listen(ana, `room:not-a-uuid`)).status).toBe('CHANNEL_ERROR')
  })

  it('lets a paired TV join the room and the stage, but no player topic', async () => {
    expect((await listen(tv, `room:${party.id}`)).status).toBe('SUBSCRIBED')
    expect((await listen(tv, `stage:${party.id}`)).status).toBe('SUBSCRIBED')
    expect((await listen(tv, `player:${ana.playerId}`)).status).toBe('CHANNEL_ERROR')
  })

  it("gives a guest their own player topic only", async () => {
    expect((await listen(ana, `player:${ana.playerId}`)).status).toBe('SUBSCRIBED')
    expect((await listen(ana, `player:${bo.playerId}`)).status).toBe('CHANNEL_ERROR')
  })
})

describe('what a save sends', () => {
  let room: Listener
  let boRoom: Listener
  let stage: Listener

  beforeAll(async () => {
    room = await listen(ana, `room:${party.id}`)
    boRoom = await listen(bo, `room:${party.id}`)
    stage = await listen(host, `stage:${party.id}`)
    expect([room.status, boRoom.status, stage.status]).toEqual(['SUBSCRIBED', 'SUBSCRIBED', 'SUBSCRIBED'])
  })

  it("never delivers a guest's own broadcast", async () => {
    reset(room, boRoom)
    await room.channel.send({ type: 'broadcast', event: 'changed', payload: { forged: true } })
    await sleep(1000)
    expect(boRoom.heard).toEqual([])
  })

  it('sends one changed for a host write', async () => {
    reset(room)
    await host.client.from('sessions').update({ name: 'Realtime test, renamed' }).eq('id', party.id)
    const heard = await hear(room, (h) => h.event === 'changed')
    expect(heard.payload).toMatchObject({ session: party.id, at: expect.any(Number) })
    await sleep(500)
    expect(room.heard.filter((h) => h.event === 'changed')).toHaveLength(1)
  })

  it("pings the room when the host changes the TV's sound volume, so a TV reads it at once", async () => {
    const tvRoom = await listen(tv, `room:${party.id}`)
    expect(tvRoom.status).toBe('SUBSCRIBED')
    reset(tvRoom)
    await host.client.from('sessions').update({ sound_volume: 40 }).eq('id', party.id)
    expect((await hear(tvRoom, (h) => h.event === 'changed')).payload).toMatchObject({ session: party.id })
    const { data } = await tv.client.rpc('session_snapshot', { p_session_id: party.id, p_screen: 'tv' })
    expect(data.session.sound_volume).toBe(40)
    await sleep(500)
    expect(tvRoom.heard.filter((h) => h.event === 'changed')).toHaveLength(1)
  })

  it('marks a save that opens a prompt, so phones read at once', async () => {
    reset(room)
    await engine(host, { type: 'host-action', gameId, action: { type: 'open', key: 'p1', spec: { kind: 'choice', options: ['a', 'b'] } } })
    expect((await hear(room, (h) => h.event === 'changed')).payload).toMatchObject({ game: gameId, prompt: true })
  })

  it('sends a tally to the TV and the host page for an answer, and nothing to phones', async () => {
    reset(room, stage)
    await bo.client.rpc('submit_answer', { p_game_id: gameId, p_key: 'p1', p_payload: { choice: 'a' }, p_request_id: crypto.randomUUID() })
    expect((await hear(stage, (h) => h.event === 'tally')).payload).toMatchObject({ game: gameId, key: 'p1', count: 1 })
    await sleep(500)
    expect(room.heard).toEqual([])
  })

  it('pings the room when a deadline closes a prompt, even when the request then skips', async () => {
    await engine(host, {
      type: 'host-action',
      gameId,
      action: { type: 'open', key: 'p2', spec: { kind: 'choice', options: ['a'] }, closesInMs: 200 },
    })
    await sleep(400)
    reset(room)
    expect(await engine(host, { type: 'host-action', gameId, action: { type: 'noop' } })).toEqual({ status: 200, body: { skipped: true } })
    expect((await hear(room, (h) => h.event === 'changed')).payload).toMatchObject({ game: gameId })
  })

  it('sends nothing from a rolled-back transaction', async () => {
    reset(room)
    await sql(`begin; select public.ping('room:${party.id}', 'changed', '{"rolled_back": true}'); rollback;`)
    await sql(`begin; select public.ping('room:${party.id}', 'changed', '{"committed": true}'); commit;`)
    await hear(room, (h) => h.payload.committed === true)
    expect(room.heard.some((h) => h.payload.rolled_back)).toBe(false)
  })

  it('tells the old phone its player moved', async () => {
    const cy = await world.guest(party, 'Cy')
    const own = await listen(cy, `player:${cy.playerId}`)
    expect(own.status).toBe('SUBSCRIBED')
    const { data: code } = await host.client.rpc('host_issue_transfer', { p_player_id: cy.playerId })
    const newPhone = await world.user()
    expect((await newPhone.client.rpc('claim_player', { p_code: code })).error).toBeNull()
    expect((await hear(own, (h) => h.event === 'moved')).payload).toMatchObject({ player: cy.playerId })
  })

  it('pings only the stage when the host changes the guest list: phones never show guests still expected', async () => {
    reset(room, stage)
    expect((await host.client.rpc('host_add_guests', { p_session_id: party.id, p_names: ['Fay', 'Gil'] })).error).toBeNull()
    expect((await hear(stage, (h) => h.event === 'changed')).payload).toMatchObject({ session: party.id })
    await sleep(500)
    expect(stage.heard.filter((h) => h.event === 'changed')).toHaveLength(1)
    expect(room.heard).toEqual([])
  })

  it('pings the room when the host frees a name, and the phone that had it hears that on its open room channel', async () => {
    const fay = await world.claimGuest(party, 'Fay')
    const fayRoom = await listen(fay, `room:${party.id}`)
    expect(fayRoom.status).toBe('SUBSCRIBED')
    reset(fayRoom, room)
    expect((await host.client.rpc('host_free_guest', { p_player_id: fay.playerId })).error).toBeNull()
    expect((await hear(fayRoom, (h) => h.event === 'changed')).payload).toMatchObject({ session: party.id })
    await hear(room, (h) => h.event === 'changed')
    const { data } = await fay.client.rpc('session_snapshot', { p_session_id: party.id, p_screen: 'phone' })
    expect(data).toMatchObject({ member: false, freed: true, moved: false })
    await sleep(500)
    expect(fayRoom.heard.filter((h) => h.event === 'changed')).toHaveLength(1)
  })

  it('pings and moves published_at on every recap Publish and Update', async () => {
    reset(room)
    await host.client.from('session_recaps').upsert({ session_id: party.id, data: { v: 1 }, published_at: new Date().toISOString() })
    await hear(room, (h) => h.event === 'changed')
    const first = (await ana.client.rpc('session_snapshot', { p_session_id: party.id, p_screen: 'phone' })).data.recap.published_at
    await sleep(50)
    reset(room)
    // An Update that changes the data: publishRecap always sends published_at, and the trigger stamps it.
    await host.client.from('session_recaps').upsert({ session_id: party.id, data: { v: 2 }, published_at: new Date(0).toISOString() })
    await hear(room, (h) => h.event === 'changed')
    const second = (await ana.client.rpc('session_snapshot', { p_session_id: party.id, p_screen: 'phone' })).data.recap.published_at
    expect(second).toBeGreaterThan(first)
    const { data } = await ana.client.from('session_recaps').select('data').eq('session_id', party.id).single()
    expect(data?.data).toEqual({ v: 2 })
  })

  it('sends one deleted ping when a whole party is deleted', async () => {
    const doomed = await world.party(host, 'Doomed')
    const gus = await world.guest(doomed, 'Gus')
    await world.guest(doomed, 'Gil')
    const game = await world.game(host, doomed, 'lab', 'Doomed game')
    await engine(host, { type: 'start', gameId: game, stage: true })
    const watching = await listen(gus, `room:${doomed.id}`)
    expect(watching.status).toBe('SUBSCRIBED')
    reset(watching)
    await host.client.from('sessions').delete().eq('id', doomed.id)
    expect((await hear(watching, (h) => h.event === 'changed')).payload).toMatchObject({ session: doomed.id, deleted: true })
    await sleep(500)
    expect(watching.heard).toHaveLength(1)
  })
})
