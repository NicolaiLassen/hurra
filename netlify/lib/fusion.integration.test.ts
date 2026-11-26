// Participant fusion on the stage through the real engine and the local stack
// (docs/engine-v2.md, 8.4 and 9.2): one picture asked, locked in on the phones
// straight to the database, and revealed by the paired TV's sync once its
// countdown and the grace second have passed (closes_at, then wake_at). The
// two people's own photos stay off every phone and the TV until the reveal.
// A picture may be of a guest on the host's guest list who never joins
// (docs/guest-list.md, 9.2): it is asked, guessed and revealed with their name.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { admin, engine, rows, sleep, World, type Guest, type Party, type Person } from './testUsers'

const world = new World()
let host: Person
let tv: Person
let party: Party
let ana: Guest, bo: Guest, cy: Guest, dee: Guest
let zelda: { id: string; name: string }
let gameId: string
// The two people's own photos in the settings: paths only, as uploads make them (the files needn't exist).
const PHOTO = {
  bo: 'party/game/0a1b2c3d-bo-own.jpg',
  cy: 'party/game/4e5f6a7b-cy-own.jpg',
  ana: 'party/game/8c9d0e1f-ana-own.jpg',
  zelda: 'party/game/2a3b4c5d-zelda-own.jpg',
}

beforeAll(async () => {
  host = await world.host()
  party = await world.party(host, 'Fusion test')
  ;[ana, bo, cy, dee] = await Promise.all(['Ana', 'Bo', 'Cy', 'Dee'].map((name) => world.guest(party, name)))
  tv = await world.screen(host, party)
  // On the guest list, never joins.
  ;[zelda] = (await world.listGuests(host, party, ['Zelda'])).added
  gameId = await world.game(host, party, 'fusion', 'Who is fused?', {
    pictures: [
      { label: '#1', people: [bo.playerId, cy.playerId], originals: [PHOTO.bo, PHOTO.cy] },
      { label: '#2', people: [ana.playerId, dee.playerId], originals: [PHOTO.ana, null] },
    ],
    pointsPerPerson: 1,
    bonusForBoth: 1,
    seconds: 10,
    showSeconds: 3,
  })
})

afterAll(() => world.cleanup())

type Row = { public_state: Record<string, unknown> & { phase: string }; wake_at: string | null; status: string; winners: string[] }
const gameRow = async () => (await rows<Row>('session_games', 'id', gameId))[0]
const lock = (who: Guest, choice: string[]) =>
  who.client.rpc('submit_answer', { p_game_id: gameId, p_key: 'p1', p_payload: { choice }, p_request_id: crypto.randomUUID() })
const step = (action: Record<string, unknown>, close?: string[]) => engine(host, { type: 'host-action', gameId, action, ...(close ? { close } : {}) })
/** Which of the own photos each guest's phone and the paired TV can read, through the snapshot every screen loads. */
async function photosSeen(): Promise<string[]> {
  const seen = new Set<string>()
  for (const [person, screen] of [[ana, 'phone'], [bo, 'phone'], [cy, 'phone'], [dee, 'phone'], [tv, 'tv']] as const) {
    const { data, error } = await person.client.rpc('session_snapshot', { p_session_id: party.id, p_screen: screen })
    expect(error).toBeNull()
    const text = JSON.stringify(data)
    for (const [who, path] of Object.entries(PHOTO)) if (text.includes(path)) seen.add(`${who} on ${screen === 'tv' ? 'the TV' : 'a phone'}`)
  }
  return [...seen].sort()
}

describe('Participant fusion on the stage', () => {
  it('takes the TV, asks a picture, and the TV’s sync reveals it once its time is up', async () => {
    expect(await engine(host, { type: 'start', gameId })).toMatchObject({ status: 200 })
    const session = (await rows<{ spotlight_game_id: string }>('sessions', 'id', party.id))[0]
    expect(session.spotlight_game_id).toBe(gameId)
    expect((await gameRow()).public_state.phase).toBe('lobby')

    expect(await photosSeen()).toEqual([])
    expect(await step({ type: 'show' })).toMatchObject({ status: 200 })
    expect((await gameRow()).wake_at).not.toBeNull()
    expect(await step({ type: 'wall', from: 'showing' })).toMatchObject({ status: 200 })
    expect(await step({ type: 'wall', from: 'showing' })).toEqual({ status: 200, body: { skipped: true } })

    expect(await step({ type: 'ask', n: 1 })).toMatchObject({ status: 200 })
    const asked = await gameRow()
    expect(asked.public_state).toMatchObject({ phase: 'asking', current: { n: 1, step: 1, key: 'p1' } })
    // Who is in it stays secret: never in the public state, the prompt or another guest's view.
    expect(JSON.stringify(asked.public_state)).not.toContain(bo.playerId)
    const [prompt] = await rows<{ spec: unknown; closes_at: string }>('game_prompts', 'game_id', gameId)
    expect(prompt.spec).toEqual({ kind: 'choice', options: 'guests', min: 2, max: 2, exclude_self: true, final: true })
    const views = await rows<{ player_id: string; view: { inPicture: boolean } }>('game_player_views', 'game_id', gameId)
    expect(views.filter((v) => v.view.inPicture).map((v) => v.player_id).sort()).toEqual([bo.playerId, cy.playerId].sort())
    expect(Date.parse(prompt.closes_at) - Date.parse(asked.wake_at!)).toBe(-250)
    // Their own photos too: on no phone and not on the TV while it is asked.
    expect(await photosSeen()).toEqual([])

    expect((await lock(ana, [bo.playerId, cy.playerId])).error).toBeNull()
    expect((await lock(dee, [bo.playerId, ana.playerId])).error).toBeNull()
    expect((await lock(bo, [ana.playerId, cy.playerId])).error).toBeNull() // in it: the reveal ignores it
    expect((await lock(ana, [bo.playerId, dee.playerId])).error?.message).toBe('You already answered')
    expect(await engine(host, { type: 'host-action', gameId, action: { type: 'ask', n: 2 } })).toMatchObject({
      status: 400,
      body: { error: 'Reveal #1 first' },
    })

    // Early: nothing is due. Then the countdown, the grace second and the margin pass.
    expect(await engine(tv, { type: 'sync', gameId })).toEqual({ status: 200, body: { skipped: true } })
    await sleep(Math.max(0, Date.parse(asked.wake_at!) - Date.now()) + 300)
    expect((await lock(cy, [ana.playerId, dee.playerId])).error?.message).toBe('Too late, answers are closed')
    expect(await engine(tv, { type: 'sync', gameId })).toEqual({ status: 200, body: {} })

    const revealed = await gameRow()
    expect(revealed.public_state).toMatchObject({
      phase: 'reveal',
      current: { n: 1 },
      pictures: [
        { n: 1, revealed: { people: [bo.playerId, cy.playerId], names: ['Bo', 'Cy'], both: 1, one: 1, none: 0, voters: 2, step: 1 } },
        { n: 2, revealed: null },
      ],
    })
    // The reveal hands the room #1's two photos, in the order of its people, and never #2's.
    expect((revealed.public_state.pictures as { revealed: { originals: unknown } | null }[])[0].revealed?.originals).toEqual([PHOTO.bo, PHOTO.cy])
    expect(await photosSeen()).toEqual(['bo on a phone', 'bo on the TV', 'cy on a phone', 'cy on the TV'])
    const scores = await rows<{ player_id: string; points: number }>('game_scores', 'game_id', gameId)
    expect(Object.fromEntries(scores.map((s) => [s.player_id, s.points]))).toEqual({ [ana.playerId]: 3, [dee.playerId]: 1 })
    expect(await step({ type: 'reveal', n: 1 }, ['p1'])).toEqual({ status: 200, body: { skipped: true } })

    expect(await step({ type: 'wall', from: 'reveal', n: 1 })).toMatchObject({ status: 200 })
    expect(await step({ type: 'finish' })).toMatchObject({ status: 200 })
    const done = await gameRow()
    expect(done).toMatchObject({ status: 'finished', winners: [ana.playerId], wake_at: null })
    const crowned = await admin.from('session_feed').select('message, interrupt').eq('game_id', gameId).order('id')
    expect(crowned.data).toEqual([{ message: 'Ana has the sharpest eye', interrupt: true }, { message: 'You have the sharpest eye', interrupt: false }])
  }, 30_000)

  it('asks and reveals a picture of a guest who never joined, with her name and own photo; only guests here score', async () => {
    const second = await world.game(host, party, 'fusion', 'Who else is fused?', {
      pictures: [{ label: '#1', people: [ana.playerId, zelda.id], originals: [null, PHOTO.zelda] }],
      pointsPerPerson: 1,
      bonusForBoth: 0,
      seconds: 30,
      showSeconds: 3,
    })
    const act = (action: Record<string, unknown>, close?: string[]) =>
      engine(host, { type: 'host-action', gameId: second, action, ...(close ? { close } : {}) })
    const room = async () => (await rows<Row>('session_games', 'id', second))[0].public_state
    const vote = (who: Guest, choice: string[]) =>
      who.client.rpc('submit_answer', { p_game_id: second, p_key: 'p1', p_payload: { choice }, p_request_id: crypto.randomUUID() })

    // The start takes a picture of someone still expected.
    expect(await engine(host, { type: 'start', gameId: second })).toMatchObject({ status: 200 })
    expect(await act({ type: 'ask', n: 1 })).toMatchObject({ status: 200 })
    // Phones get her id and name to pick, and nothing else: not the key, not her photo, not her player code.
    const asked = await room()
    expect(asked.expected).toEqual([{ id: zelda.id, name: 'Zelda' }])
    expect(JSON.stringify(asked.pictures)).not.toContain(zelda.id)
    const { data: phone } = await bo.client.rpc('session_snapshot', { p_session_id: party.id, p_screen: 'phone' })
    const text = JSON.stringify(phone)
    expect(text).not.toContain(PHOTO.zelda)
    expect((phone as { players: { id: string }[] }).players.map((p) => p.id)).not.toContain(zelda.id)
    const [row] = await rows<{ code: string }>('players', 'id', zelda.id)
    expect(text).not.toContain(row.code)

    expect((await vote(bo, [ana.playerId, zelda.id])).error).toBeNull() // both right, naming her
    expect((await vote(cy, [ana.playerId, dee.playerId])).error).toBeNull() // one
    expect((await vote(dee, [zelda.id, cy.playerId])).error).toBeNull() // one
    expect((await vote(ana, [zelda.id, bo.playerId])).error).toBeNull() // in it: the reveal ignores it
    expect((await vote(dee, [zelda.id, bo.playerId])).error?.message).toBe('You already answered')

    expect(await act({ type: 'reveal', n: 1 }, ['p1'])).toMatchObject({ status: 200 })
    const revealed = await room()
    expect((revealed.pictures as unknown[])[0]).toMatchObject({
      revealed: { people: [ana.playerId, zelda.id], names: ['Ana', 'Zelda'], originals: [null, PHOTO.zelda], both: 1, one: 2, none: 0, voters: 3 },
    })
    const scores = await rows<{ player_id: string; points: number }>('game_scores', 'game_id', second)
    expect(Object.fromEntries(scores.map((s) => [s.player_id, s.points]))).toEqual({ [bo.playerId]: 2, [cy.playerId]: 1, [dee.playerId]: 1 })
    expect(await act({ type: 'finish' })).toMatchObject({ status: 200 })
    expect((await rows<Row>('session_games', 'id', second))[0]).toMatchObject({ status: 'finished', winners: [bo.playerId] })
  }, 30_000)
})
