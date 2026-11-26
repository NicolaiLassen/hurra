// Lydspor against the local stack (.design/lydspor/spec.md; docs/engine-v2.md,
// 8.5 and 9.2): typed answers straight to the database through submit_answer,
// the last call and the timer's lock in two syncs from the paired TV, reveals,
// the host's Accept, the crown and the payout on the night board, through the
// real /api/game handler. Every song and answer here is invented.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SoundtrackPlayerView, SoundtrackPublicState, SoundtrackState } from '../../src/games/soundtrack/types'
import { call, rows, sleep, World, type Guest, type Party, type Person } from './testUsers'

const world = new World()
let host: Person
let party: Party
let tv: Person
let guests: Guest[]

beforeAll(async () => {
  host = await world.host()
  party = await world.party(host, 'Lydspor test')
  guests = []
  for (const name of ['Ana', 'Bo', 'Cy']) guests.push(await world.guest(party, name))
  tv = await world.screen(host, party)
})

afterAll(() => world.cleanup())

const SETTINGS = {
  songs: [
    { title: 'Paper Lanterns', singer: 'Mira Holm', alsoSingers: ['Mira'], caption: 'The harbour, 2009' },
    { title: 'Seven Ferries', singer: 'Coldwave', caption: 'Island trip, 2012' },
    { title: 'Under the Old Oak Tree', singer: 'The Lanterns', alsoTitles: ['Old Oak'], caption: 'The allotment, 2019' },
  ].map((song, i) => ({ alsoTitles: [], alsoSingers: [], photo: `test/lydspor/song-${i + 1}.jpg`, startAt: 30, note: '', inPhoto: [], ...song })),
  extraPhotos: [
    { photo: 'test/lydspor/extra-1.jpg', caption: 'A wedding, 2015' },
    { photo: 'test/lydspor/extra-2.jpg', caption: 'Ski trip, 2017' },
  ],
  lastCallSeconds: 20,
  boardMax: 20,
  storyteller: 'Ida',
}

const submit = (person: Person, gameId: string, key: string, payload: unknown) =>
  person.client.rpc('submit_answer', { p_game_id: gameId, p_key: key, p_payload: payload, p_request_id: crypto.randomUUID() })
const hostAct = (gameId: string, action: unknown, close?: string[]) => call(host, { type: 'host-action', gameId, action, ...(close ? { close } : {}) })
const gameRow = async (id: string) => (await rows<Record<string, unknown>>('session_games', 'id', id))[0]
const pubOf = async (id: string) => (await gameRow(id)).public_state as SoundtrackPublicState
const stateOf = async (id: string) => (await rows<{ state: SoundtrackState }>('game_states', 'game_id', id))[0].state
async function viewOf(gameId: string, guest: Guest) {
  const { data } = await guest.client.from('game_player_views').select('view').eq('game_id', gameId).eq('player_id', guest.playerId)
  return data?.[0]?.view as SoundtrackPlayerView | undefined
}

describe('Lydspor through the real handler', () => {
  it('plays three songs, locks by the timer, reveals with an accept, and pays the night board once', async () => {
    const [ana, bo, cy] = guests
    const gameId = await world.game(host, party, 'soundtrack', 'Lydspor', SETTINGS)
    expect((await call(host, { type: 'start', gameId })).status).toBe(200)
    for (let index = 0; index < 3; index++) expect((await hostAct(gameId, { type: 'play', index })).status).toBe(200)
    // A double tap on Play is a skip, not a second song.
    expect(await hostAct(gameId, { type: 'play', index: 2 })).toMatchObject({ status: 200, body: { skipped: true } })

    const prompts = await rows<{ key: string; spec: unknown; closes_at: string | null }>('game_prompts', 'game_id', gameId)
    expect(prompts.map((p) => p.key).sort()).toEqual(
      ['s1.event', 's1.singer', 's1.title', 's2.event', 's2.singer', 's2.title', 's3.event', 's3.singer', 's3.title'],
    )
    expect(prompts.find((p) => p.key === 's1.title')!.spec).toEqual({ kind: 'text', max_length: 60 })
    expect(prompts.every((p) => p.closes_at === null)).toBe(true)
    const wall = (await stateOf(gameId)).wall
    const photo = (song: number) => String(wall.indexOf(song))
    const extra = String(wall.findIndex((k) => k >= 3))

    // Typed answers: trimmed by the database, changeable, never empty or over 60 characters.
    expect((await submit(ana, gameId, 's1.title', { text: '  Papir Lanterner ' })).error).toBeNull()
    expect((await submit(ana, gameId, 's1.singer', { text: 'Mira Hlom' })).error).toBeNull()
    expect((await submit(ana, gameId, 's1.event', { choice: [photo(0)] })).error).toBeNull()
    expect((await submit(bo, gameId, 's1.title', { text: 'papir lanterner' })).error).toBeNull()
    expect((await submit(bo, gameId, 's1.event', { choice: [extra] })).error).toBeNull()
    // A take: song 1 gives its photo up for song 2.
    expect((await submit(bo, gameId, 's1.event', { choice: ['none'] })).error).toBeNull()
    expect((await submit(bo, gameId, 's2.event', { choice: [extra] })).error).toBeNull()
    expect((await submit(cy, gameId, 's1.title', { text: 'Paper Lanterns' })).error).toBeNull()
    expect((await submit(cy, gameId, 's2.title', { text: 'Seven ferries' })).error).toBeNull()
    expect((await submit(cy, gameId, 's2.title', { text: 'Sevn Ferries' })).error).toBeNull()
    expect((await submit(cy, gameId, 's2.singer', { text: '   ' })).error?.message).toBe('Answers are 1 to 60 characters')
    expect((await submit(cy, gameId, 's2.singer', { text: 'x'.repeat(61) })).error?.message).toBe('Answers are 1 to 60 characters')
    const tallies = (await host.client.rpc('prompt_tallies', { p_session_id: party.id })).data as Record<string, Record<string, number>>
    expect(tallies[gameId]).toMatchObject({ 's1.title': 3, 's1.event': 2, 's2.title': 1 })

    // Nothing secret reaches the room, and a guest reads only their own answers.
    const before = JSON.stringify(await pubOf(gameId))
    for (const word of ['Paper Lanterns', 'Mira Holm', 'Papir', 'The harbour']) expect(before).not.toContain(word)
    const { data: seen } = await bo.client.from('game_submissions').select('player_id').eq('game_id', gameId)
    expect(new Set(seen!.map((s) => s.player_id))).toEqual(new Set([bo.playerId]))
    expect((await bo.client.from('game_states').select('state').eq('game_id', gameId)).data).toEqual([])

    // The last call: the TV's first sync at lockAt closes every prompt, the next one locks.
    expect((await hostAct(gameId, { type: 'lastCall', after: 3 })).status).toBe(200)
    const lockAt = Date.parse(String((await gameRow(gameId)).wake_at))
    await sleep(Math.max(0, lockAt - Date.now()) + 300)
    expect((await call(tv, { type: 'sync', gameId })).status).toBe(200)
    expect((await submit(cy, gameId, 's3.title', { text: 'Old Oak' })).error?.message).toBe('Too late, answers are closed')
    await sleep(1200)
    expect((await call(tv, { type: 'sync', gameId })).status).toBe(200)
    const locked = await stateOf(gameId)
    expect(locked.phase).toBe('locked')
    expect(locked.picks![ana.playerId]).toEqual({ event: [Number(photo(0)), null, null], title: ['Papir Lanterner', null, null], singer: ['Mira Hlom', null, null] })
    expect(locked.picks![bo.playerId].event).toEqual([null, Number(extra), null])
    expect((await gameRow(gameId)).wake_at).toBeNull()

    // Reveals, and the host accepts the close title two guests typed.
    expect((await hostAct(gameId, { type: 'reveal', index: 0 })).status).toBe(200)
    expect((await pubOf(gameId)).reveal).toMatchObject({ n: 1, title: 'Paper Lanterns', counts: { event: 1, title: 1, singer: 1 }, scoring: 3 })
    expect(await viewOf(gameId, ana)).toMatchObject({ songs: [{ event: 'right', title: 'close', singer: 'typo', points: 3 }] })
    const accept = { type: 'accept', index: 0, part: 'title', key: 'papirlanterner', accepted: true }
    expect((await hostAct(gameId, accept)).status).toBe(200)
    expect(await hostAct(gameId, accept)).toMatchObject({ status: 200, body: { skipped: true } })
    expect((await pubOf(gameId)).reveal!.counts.title).toBe(3)
    expect(await viewOf(gameId, bo)).toMatchObject({ songs: [{ title: 'accepted', points: 1 }] })
    expect(await hostAct(gameId, { ...accept, key: 'paperlanterns' })).toMatchObject({ status: 400, body: { error: 'That answer counts already' } })
    expect((await hostAct(gameId, { type: 'reveal', index: 1 })).status).toBe(200)
    expect((await hostAct(gameId, { type: 'reveal', index: 2 })).status).toBe(200)
    expect((await pubOf(gameId)).extras).toHaveLength(2)

    // The night board moves once, at the crown, and never by more than boardMax.
    expect((await rows('game_scores', 'game_id', gameId)).length).toBe(0)
    expect((await hostAct(gameId, { type: 'crown' })).status).toBe(200)
    const done = await gameRow(gameId)
    expect(done).toMatchObject({ status: 'finished', finished_by: 'game', winners: [ana.playerId] })
    const scores = await rows<{ player_id: string; points: number }>('game_scores', 'game_id', gameId)
    // Ana 4 of 12, Cy 2, Bo 1: scaled to 20 over the 12 points three songs give.
    expect(Object.fromEntries(scores.map((s) => [s.player_id, s.points]))).toEqual({
      [ana.playerId]: 7,
      [cy.playerId]: 3,
      [bo.playerId]: 2,
    })
    expect(await viewOf(gameId, ana)).toMatchObject({ final: { points: 4, place: 1, paid: 7 } })
    expect(await hostAct(gameId, accept)).toMatchObject({ status: 409, body: { code: 'not_running' } })
  }, 60_000)

  it('starts with guests on the list who have not joined in a photo and sitting out, and counts only the guests here', async () => {
    const [ana, bo] = guests
    // On the guest list, not joined (docs/guest-list.md, 9.3).
    const [zelda, ulrik] = (await world.listGuests(host, party, ['Zelda', 'Ulrik'])).added
    const gameId = await world.game(host, party, 'soundtrack', 'Lydspor again', {
      ...SETTINGS,
      songs: SETTINGS.songs.map((song, i) => (i === 0 ? { ...song, inPhoto: [zelda.id, ana.playerId] } : song)),
      sitOut: [ulrik.id, bo.playerId],
    })
    expect((await call(host, { type: 'start', gameId })).status).toBe(200)
    const state = await stateOf(gameId)
    expect(state.sitOut).toEqual([ulrik.id, bo.playerId])
    expect(state.inPhoto[0]).toEqual([zelda.id, ana.playerId])
    // The room counts the guests here who play: Ana and Cy, not Bo (sitting out) and nobody listed.
    const room = await pubOf(gameId)
    expect(room.playing).toBe(2)
    expect(JSON.stringify(room)).not.toContain(zelda.id)
    expect(JSON.stringify(room)).not.toContain(ulrik.id)
    expect(await viewOf(gameId, bo)).toMatchObject({ sittingOut: true })
    expect((await call(host, { type: 'end', gameId })).status).toBe(200)
  }, 30_000)
})
