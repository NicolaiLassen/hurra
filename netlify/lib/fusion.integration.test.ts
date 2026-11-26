// Participant fusion on the stage through the real engine and the local stack
// (docs/engine-v2.md, 8.4 and 9.2): one picture asked, locked in on the phones
// straight to the database as two names, and revealed by the paired TV's sync
// once the suspense, its countdown and the grace second have passed
// (closes_at, then wake_at). Each picture's image stays off every phone and
// the TV until it is asked, and the two people's own photos until its reveal.
// Who is in a picture is two typed names, not tied to the guest list: settings
// saved with guests' ids still start, as those guests' names, and a picture
// may be of someone who never joins. Everyone here guesses and scores, the
// two in the picture too.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { admin, engine, rows, sleep, World, type Guest, type Party, type Person } from './testUsers'

const world = new World()
let host: Person
let tv: Person
let party: Party
let ana: Guest, bo: Guest, cy: Guest, dee: Guest
let zelda: { id: string; name: string }
let gameId: string
// The pictures' images and the two people's own photos in the settings: paths only, as uploads make them (the files needn't exist).
const PHOTO = {
  bo: 'party/game/0a1b2c3d-bo-own.jpg',
  cy: 'party/game/4e5f6a7b-cy-own.jpg',
  ana: 'party/game/8c9d0e1f-ana-own.jpg',
  zelda: 'party/game/2a3b4c5d-zelda-own.jpg',
}
const IMAGE = {
  first: 'party/game/6d7e8f90-fused-1.jpg',
  second: 'party/game/a1b2c3d4-fused-2.jpg',
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
      // Typed names, one spelled in lower case: case never matters.
      { label: '#1', image: IMAGE.first, people: ['Bo', 'cy'], originals: [PHOTO.bo, PHOTO.cy] },
      // Settings saved before names: two guests' ids, read as their names at the start.
      { label: '#2', image: IMAGE.second, people: [ana.playerId, dee.playerId], originals: [PHOTO.ana, null] },
    ],
    pointsPerPerson: 1,
    bonusForBoth: 1,
    seconds: 10,
    // From settings saved while the round opened with a showing: no longer read.
    showSeconds: 3,
  })
})

afterAll(() => world.cleanup())

type Row = { public_state: Record<string, unknown> & { phase: string }; wake_at: string | null; status: string; winners: string[] }
const gameRow = async () => (await rows<Row>('session_games', 'id', gameId))[0]
const lock = (who: Guest, choice: string[]) =>
  who.client.rpc('submit_answer', { p_game_id: gameId, p_key: 'p1', p_payload: { choice }, p_request_id: crypto.randomUUID() })
const step = (action: Record<string, unknown>, close?: string[]) => engine(host, { type: 'host-action', gameId, action, ...(close ? { close } : {}) })
/** Which of the secret paths each guest's phone and the paired TV can read, through the snapshot every screen loads. */
async function seen(paths: Record<string, string>): Promise<string[]> {
  const found = new Set<string>()
  for (const [person, screen] of [[ana, 'phone'], [bo, 'phone'], [cy, 'phone'], [dee, 'phone'], [tv, 'tv']] as const) {
    const { data, error } = await person.client.rpc('session_snapshot', { p_session_id: party.id, p_screen: screen })
    expect(error).toBeNull()
    const text = JSON.stringify(data)
    for (const [what, path] of Object.entries(paths)) if (text.includes(path)) found.add(`${what} on ${screen === 'tv' ? 'the TV' : 'a phone'}`)
  }
  return [...found].sort()
}
const photosSeen = () => seen(PHOTO)
const imagesSeen = () => seen(IMAGE)

describe('Participant fusion on the stage', () => {
  it('takes the TV, asks a picture after the suspense, and the TV’s sync reveals it once its time is up', async () => {
    expect(await engine(host, { type: 'start', gameId })).toMatchObject({ status: 200 })
    const session = (await rows<{ spotlight_game_id: string }>('sessions', 'id', party.id))[0]
    expect(session.spotlight_game_id).toBe(gameId)
    expect((await gameRow()).public_state.phase).toBe('lobby')
    // No picture is asked yet: nobody has an image, only placeholders.
    expect(await photosSeen()).toEqual([])
    expect(await imagesSeen()).toEqual([])
    expect(JSON.stringify((await gameRow()).public_state.pictures)).not.toContain('.jpg')

    // The lobby's step is the first picture: no showing.
    expect(await step({ type: 'show' })).toMatchObject({ status: 400, body: { error: 'Unknown host action' } })
    expect(await step({ type: 'ask', n: 1 })).toMatchObject({ status: 200 })
    const asked = await gameRow()
    expect(asked.public_state).toMatchObject({ phase: 'asking', current: { n: 1, step: 1, key: 'p1' } })
    const current = asked.public_state.current as { openedAt: number; startsAt: number; endsAt: number }
    // The countdown starts after the TV's suspense, and keeps its whole 10 s.
    expect(current.startsAt - current.openedAt).toBe(2800)
    expect(current.endsAt - current.startsAt).toBe(10_000)
    // Its image reaches the room now; #2's still doesn't.
    expect(await imagesSeen()).toEqual(['first on a phone', 'first on the TV'])
    // Who is in it stays secret: never in the public state, the prompt or a guest's view.
    expect(JSON.stringify(asked.public_state)).not.toMatch(/"Bo"|"cy"|"Cy"/)
    const [prompt] = await rows<{ spec: unknown; closes_at: string }>('game_prompts', 'game_id', gameId)
    // The names a guess offers: everyone here and every name in the pictures, each once, the same for every picture.
    expect(prompt.spec).toEqual({ kind: 'choice', options: ['Ana', 'Bo', 'Cy', 'Dee'], min: 2, max: 2, final: true })
    const views = await rows<{ player_id: string; view: Record<string, unknown> }>('game_player_views', 'game_id', gameId)
    expect(views.every((v) => !('inPicture' in v.view))).toBe(true)
    expect(Date.parse(prompt.closes_at) - Date.parse(asked.wake_at!)).toBe(-250)
    // The own photos too: on no phone and not on the TV while it is asked.
    expect(await photosSeen()).toEqual([])

    expect((await lock(ana, ['Bo', 'Cy'])).error).toBeNull() // both
    expect((await lock(dee, ['Bo', 'Ana'])).error).toBeNull() // one
    expect((await lock(bo, ['Ana', 'Cy'])).error).toBeNull() // in it, and scores: Cy is right
    expect((await lock(cy, ['Bo', 'Zelda'])).error?.message).toBe('That is not one of the options')
    expect((await lock(ana, ['Bo', 'Dee'])).error?.message).toBe('You already answered')
    expect(await engine(host, { type: 'host-action', gameId, action: { type: 'ask', n: 2 } })).toMatchObject({
      status: 400,
      body: { error: 'Reveal #1 first' },
    })

    // Early: nothing is due. Then the suspense, the countdown, the grace second and the margin pass.
    expect(await engine(tv, { type: 'sync', gameId })).toEqual({ status: 200, body: { skipped: true } })
    await sleep(Math.max(0, Date.parse(asked.wake_at!) - Date.now()) + 300)
    expect((await lock(cy, ['Ana', 'Dee'])).error?.message).toBe('Too late, answers are closed')
    expect(await engine(tv, { type: 'sync', gameId })).toEqual({ status: 200, body: {} })

    const revealed = await gameRow()
    expect(revealed.public_state).toMatchObject({
      phase: 'reveal',
      current: { n: 1 },
      pictures: [
        { n: 1, asked: true, image: IMAGE.first, revealed: { names: ['Bo', 'cy'], both: 1, one: 2, none: 0, voters: 3, step: 1 } },
        { n: 2, asked: false, image: null, revealed: null },
      ],
    })
    // The reveal hands the room #1's two photos, in the order of its people, and never #2's.
    expect((revealed.public_state.pictures as { revealed: { originals: unknown } | null }[])[0].revealed?.originals).toEqual([PHOTO.bo, PHOTO.cy])
    expect(await photosSeen()).toEqual(['bo on a phone', 'bo on the TV', 'cy on a phone', 'cy on the TV'])
    expect(await imagesSeen()).toEqual(['first on a phone', 'first on the TV'])
    const scores = await rows<{ player_id: string; points: number }>('game_scores', 'game_id', gameId)
    expect(Object.fromEntries(scores.map((s) => [s.player_id, s.points]))).toEqual({ [ana.playerId]: 3, [dee.playerId]: 1, [bo.playerId]: 1 })
    expect(await step({ type: 'reveal', n: 1 }, ['p1'])).toEqual({ status: 200, body: { skipped: true } })

    expect(await step({ type: 'wall', from: 'reveal', n: 1 })).toMatchObject({ status: 200 })
    expect(await step({ type: 'finish' })).toMatchObject({ status: 200 })
    const done = await gameRow()
    expect(done).toMatchObject({ status: 'finished', winners: [ana.playerId], wake_at: null })
    // #2 was never asked: its image stays secret after the end too.
    expect(await imagesSeen()).toEqual(['first on a phone', 'first on the TV'])
    const crowned = await admin.from('session_feed').select('message, interrupt').eq('game_id', gameId).order('id')
    expect(crowned.data).toEqual([{ message: 'Ana has the sharpest eye', interrupt: true }, { message: 'You have the sharpest eye', interrupt: false }])
  }, 40_000)

  it('asks and reveals a picture of a name nobody joined with, from old settings with ids; everyone here scores, the one in it too', async () => {
    const second = await world.game(host, party, 'fusion', 'Who else is fused?', {
      pictures: [
        // Old settings: Ana's id and the id of Zelda, on the guest list, who never joins.
        { label: '#1', people: [ana.playerId, zelda.id], originals: [null, PHOTO.zelda] },
        // A typed name not on the guest list at all.
        { label: '#2', people: ['Tilde', 'Bo'] },
      ],
      pointsPerPerson: 1,
      bonusForBoth: 0,
      seconds: 30,
    })
    const act = (action: Record<string, unknown>, close?: string[]) =>
      engine(host, { type: 'host-action', gameId: second, action, ...(close ? { close } : {}) })
    const room = async () => (await rows<Row>('session_games', 'id', second))[0].public_state
    const vote = (who: Guest, choice: string[]) =>
      who.client.rpc('submit_answer', { p_game_id: second, p_key: 'p1', p_payload: { choice }, p_request_id: crypto.randomUUID() })

    expect(await engine(host, { type: 'start', gameId: second })).toMatchObject({ status: 200 })
    const [state] = await rows<{ state: { key: Record<string, string[]> } }>('game_states', 'game_id', second)
    // The ids became names at the start: the state holds no guest's id.
    expect(state.state.key).toEqual({ 1: ['Ana', 'Zelda'], 2: ['Tilde', 'Bo'] })
    expect(await act({ type: 'ask', n: 1 })).toMatchObject({ status: 200 })
    const asked = await room()
    expect(asked).not.toHaveProperty('expected')
    expect(JSON.stringify(asked)).not.toContain(zelda.id)
    const [prompt] = await rows<{ spec: { options: string[] } }>('game_prompts', 'game_id', second)
    expect(prompt.spec.options).toEqual(['Ana', 'Bo', 'Cy', 'Dee', 'Tilde', 'Zelda'])
    // Phones get her name to pick, and nothing else: not the key, not her photo, not her player code.
    const { data: phone } = await bo.client.rpc('session_snapshot', { p_session_id: party.id, p_screen: 'phone' })
    const text = JSON.stringify(phone)
    expect(text).not.toContain(PHOTO.zelda)
    expect((phone as { players: { id: string }[] }).players.map((p) => p.id)).not.toContain(zelda.id)
    const [row] = await rows<{ code: string }>('players', 'id', zelda.id)
    expect(text).not.toContain(row.code)

    expect((await vote(bo, ['Ana', 'Zelda'])).error).toBeNull() // both right, naming her
    expect((await vote(cy, ['Ana', 'Dee'])).error).toBeNull() // one
    expect((await vote(dee, ['Zelda', 'Cy'])).error).toBeNull() // one
    expect((await vote(ana, ['Zelda', 'Bo'])).error).toBeNull() // in it: knows herself, names Zelda: one
    expect((await vote(dee, ['Zelda', 'Bo'])).error?.message).toBe('You already answered')

    expect(await act({ type: 'reveal', n: 1 }, ['p1'])).toMatchObject({ status: 200 })
    const revealed = await room()
    expect((revealed.pictures as unknown[])[0]).toMatchObject({
      revealed: { names: ['Ana', 'Zelda'], originals: [null, PHOTO.zelda], both: 1, one: 3, none: 0, voters: 4 },
    })
    const scores = await rows<{ player_id: string; points: number }>('game_scores', 'game_id', second)
    expect(Object.fromEntries(scores.map((s) => [s.player_id, s.points]))).toEqual({
      [bo.playerId]: 2,
      [cy.playerId]: 1,
      [dee.playerId]: 1,
      [ana.playerId]: 1,
    })
    expect(await act({ type: 'finish' })).toMatchObject({ status: 200 })
    expect((await rows<Row>('session_games', 'id', second))[0]).toMatchObject({ status: 'finished', winners: [bo.playerId] })
  }, 30_000)
})
