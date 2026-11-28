// Lydspor's typed moments and AI check against the local stack: moments typed
// straight to the database, Lock now, then the AI check through
// netlify/lib/lydsporAi.ts with the AI stubbed (no network), its verdicts
// applied through the real engine, the host overruling one, and every way it
// can fail leaving the game as it was. The function's own refusals go through
// the real /api/lydspor-ai handler. Every song, moment and answer is invented.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { playedKeys } from '../../src/games/soundtrack/logic'
import type { SoundtrackPlayerView, SoundtrackPublicState, SoundtrackState } from '../../src/games/soundtrack/types'
import aiHandler from '../functions/lydspor-ai.mts'
import { OPENROUTER_URL, runAiCheck } from './lydsporAi'
import { admin, call, rows, World, type Guest, type Party, type Person } from './testUsers'

const world = new World()
let host: Person
let party: Party
let guests: Guest[]

beforeAll(async () => {
  // The handler must find no key here: the test never reaches the network.
  delete process.env.OPENROUTER_API_KEY
  host = await world.host()
  party = await world.party(host, 'Lydspor AI test')
  guests = []
  for (const name of ['Ana', 'Bo', 'Cy']) guests.push(await world.guest(party, name))
})

afterAll(() => world.cleanup())

const MOMENT = 'Roskilde Festival 2015, first time camping, the tent flooded on the first night'

const SETTINGS = {
  songs: [
    { title: 'Paper Lanterns', singer: 'Mira Holm', moment: MOMENT, alsoMoments: ['Roskilde 2015'] },
    { title: 'Seven Ferries', singer: 'Coldwave', moment: 'Moving into the first flat' },
  ].map((song, i) => ({ alsoTitles: [], alsoSingers: [], photo: `test/lydspor/song-${i + 1}.jpg`, caption: '', startAt: 30, note: '', ...song })),
  extraPhotos: [],
  momentTyped: true,
  aiCheck: true,
  storyteller: 'Ida',
}

const submit = (person: Person, gameId: string, key: string, payload: unknown) =>
  person.client.rpc('submit_answer', { p_game_id: gameId, p_key: key, p_payload: payload, p_request_id: crypto.randomUUID() })
const hostAct = (gameId: string, action: unknown, close?: string[]) => call(host, { type: 'host-action', gameId, action, ...(close ? { close } : {}) })
const stateOf = async (id: string) => (await rows<{ state: SoundtrackState }>('game_states', 'game_id', id))[0].state
const pubOf = async (id: string) => (await rows<{ public_state: SoundtrackPublicState }>('session_games', 'id', id))[0].public_state
async function viewOf(gameId: string, guest: Guest) {
  const { data } = await guest.client.from('game_player_views').select('view').eq('game_id', gameId).eq('player_id', guest.playerId)
  return data?.[0]?.view as SoundtrackPlayerView | undefined
}

/** POST /api/lydspor-ai through the real handler. */
async function askHandler(person: Person | null, body: unknown) {
  const response = await aiHandler(
    new Request('http://localhost/api/lydspor-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(person ? { Authorization: `Bearer ${person.token}` } : {}) },
      body: JSON.stringify(body),
    }),
  )
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

/** A stub of OpenRouter: records each request and answers with `reply(questions)`. */
function stubAi(reply: (answers: { id: string; part: string; answer: string }[]) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit; body: Record<string, unknown> }[] = []
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages: { role: string; content: string }[] }
    calls.push({ url: String(url), init: init!, body })
    const user = JSON.parse(body.messages[1].content) as { songs: { answers: { id: string; part: string; answer: string }[] }[] }
    return reply(user.songs.flatMap((song) => song.answers))
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

const content = (text: string) => Response.json({ choices: [{ message: { role: 'assistant', content: text } }] })

describe('Lydspor typed moments and the AI check', () => {
  it('judges the moments at the lock, applies the AI verdicts once, lets the host overrule, and changes nothing when the AI fails', async () => {
    const [ana, bo, cy] = guests
    const gameId = await world.game(host, party, 'soundtrack', 'Lydspor', SETTINGS)
    expect((await call(host, { type: 'start', gameId })).status).toBe(200)
    // Before the lock the check is refused, whoever asks.
    expect(await askHandler(host, { gameId })).toMatchObject({ status: 409, body: { error: 'Lock the answers first' } })

    for (let index = 0; index < 2; index++) expect((await hostAct(gameId, { type: 'play', index })).status).toBe(200)
    const prompts = await rows<{ key: string; spec: unknown }>('game_prompts', 'game_id', gameId)
    expect(prompts.map((p) => p.key).sort()).toEqual(['s1.moment', 's1.singer', 's1.title', 's2.moment', 's2.singer', 's2.title'])
    expect(prompts.find((p) => p.key === 's1.moment')!.spec).toEqual({ kind: 'text', max_length: 100 })
    // Song 1's photo is public from its Play on; no wall, no moment.
    const room = await pubOf(gameId)
    expect(room).toMatchObject({ momentTyped: true, wall: [{ path: 'test/lydspor/song-1.jpg' }, { path: 'test/lydspor/song-2.jpg' }] })
    expect(JSON.stringify(room)).not.toContain('Roskilde')

    // A moment may be longer than a title: up to 100 characters.
    const long = 'Roskilde festival, our first time camping, and the tent flooded on the very first night, 2015'
    expect(long.length).toBeGreaterThan(60)
    expect((await submit(ana, gameId, 's1.moment', { text: long })).error).toBeNull()
    expect((await submit(ana, gameId, 's1.moment', { text: 'Roskilde festval camping' })).error).toBeNull()
    expect((await submit(ana, gameId, 's1.title', { text: 'Papir Lanterner' })).error).toBeNull()
    expect((await submit(bo, gameId, 's1.moment', { text: 'a party' })).error).toBeNull()
    expect((await submit(cy, gameId, 's1.moment', { text: 'roskilde 2015' })).error).toBeNull()
    expect((await submit(cy, gameId, 's1.moment', { text: 'x'.repeat(101) })).error).not.toBeNull()
    expect((await submit(cy, gameId, 's2.moment', { text: 'first flat' })).error).toBeNull()

    // Lock now, as the host page sends it: the moments closed with the rest.
    expect((await hostAct(gameId, { type: 'lock' }, playedKeys(2, true))).status).toBe(200)
    const locked = await stateOf(gameId)
    expect(locked.phase).toBe('locked')
    expect(locked.picks![ana.playerId].moment).toEqual(['Roskilde festval camping', null])
    expect(locked.review![0].moment!.find((r) => r.text === 'roskilde 2015')?.verdict).toBe('exact')

    // Hosts only, signed in only.
    expect(await askHandler(ana, { gameId })).toMatchObject({ status: 403, body: { code: 'not_host' } })
    expect(await askHandler(null, { gameId })).toMatchObject({ status: 401 })
    expect(await askHandler(host, { gameId: 'nope' })).toMatchObject({ status: 400 })
    // No key on the server: nothing changes, and the host page says so.
    expect(await askHandler(host, { gameId })).toMatchObject({ status: 200, body: { ran: false, reason: 'no_key' } })

    // A failure, a timeout and a reply of the wrong shape change nothing either.
    const failing = [
      stubAi(() => new Response('upstream error', { status: 502 })),
      stubAi(() => {
        throw Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' })
      }),
      stubAi(() => content('I think they are all close enough!')),
      stubAi((answers) => content(JSON.stringify({ verdicts: answers.slice(1).map((a) => ({ id: a.id, ok: true })) }))),
    ]
    const reasons = []
    for (const stub of failing) reasons.push(await runAiCheck(admin, host.userId, gameId, { apiKey: 'test-key', fetch: stub.fetch }))
    expect(reasons.map((r) => (r.ran ? 'ran' : r.reason))).toEqual(['failed', 'timeout', 'junk', 'junk'])
    expect((await stateOf(gameId)).review).toEqual(locked.review)
    expect((await stateOf(gameId)).ai ?? null).toBeNull()

    // The AI says yes to Ana's moment and title, no to Bo's "a party" and Cy's "first flat".
    const yes = new Set(['Roskilde festval camping', 'Papir Lanterner'])
    const ai = stubAi((answers) => content('```json\n' + JSON.stringify({ verdicts: answers.map((a) => ({ id: a.id, ok: yes.has(a.answer) })) }) + '\n```'))
    const result = await runAiCheck(admin, host.userId, gameId, { apiKey: 'test-key', fetch: ai.fetch })
    expect(result).toEqual({ ran: true, asked: 4, accepted: 2 })
    expect(ai.calls).toHaveLength(1)
    const [request] = ai.calls
    expect(request.url).toBe(OPENROUTER_URL)
    expect(new Headers(request.init.headers).get('authorization')).toBe('Bearer test-key')
    expect(request.body).toMatchObject({ model: 'anthropic/claude-sonnet-5.5', temperature: 0, reasoning: { effort: 'minimal' } })
    const asked = JSON.parse((request.body.messages as { content: string }[])[1].content) as { songs: { song: number; moment: string; answers: unknown[] }[] }
    expect(asked.songs.map((s) => [s.song, s.moment, s.answers.length])).toEqual([
      [1, MOMENT, 3],
      [2, 'Moving into the first flat', 1],
    ])
    expect(JSON.stringify(asked)).not.toContain('roskilde 2015')

    const judged = await stateOf(gameId)
    expect(judged.ai).toMatchObject({ asked: 4, accepted: 2 })
    const moment = (text: string) => judged.review![0].moment!.find((r) => r.text === text)!
    expect(moment('Roskilde festval camping')).toMatchObject({ accepted: true, ai: 'yes' })
    expect(moment('a party')).toMatchObject({ accepted: false, ai: 'no' })
    // Once per lock: a second check (another host page) asks nobody.
    const again = stubAi(() => content('{}'))
    expect(await runAiCheck(admin, host.userId, gameId, { apiKey: 'test-key', fetch: again.fetch })).toMatchObject({ ran: true, already: true })
    expect(again.calls).toHaveLength(0)

    // The reveal counts the AI's accepts; the host overrules one, and only Ana's phone hears of her own answer.
    expect((await hostAct(gameId, { type: 'reveal', index: 0 })).status).toBe(200)
    expect((await pubOf(gameId)).reveal).toMatchObject({ n: 1, moment: MOMENT, counts: { event: 2, title: 1, singer: 0 }, scoring: 3 })
    expect(await viewOf(gameId, ana)).toMatchObject({ songs: [{ moment: 'accepted', event: 'right', title: 'accepted', points: 3 }] })
    const key = moment('Roskilde festval camping').key
    expect((await hostAct(gameId, { type: 'accept', index: 0, part: 'moment', key, accepted: false })).status).toBe(200)
    expect(await viewOf(gameId, ana)).toMatchObject({ songs: [{ moment: 'close', event: 'wrong', points: 1 }] })
    expect((await pubOf(gameId)).reveal!.counts.event).toBe(1)
    expect((await hostAct(gameId, { type: 'accept', index: 0, part: 'moment', key: moment('a party').key, accepted: true })).status).toBe(200)
    expect(await viewOf(gameId, bo)).toMatchObject({ songs: [{ moment: 'accepted', points: 2 }] })
    for (const text of ['Roskilde festval camping', 'a party', 'Papir Lanterner']) {
      expect(JSON.stringify(await pubOf(gameId))).not.toContain(text)
      expect(JSON.stringify(await viewOf(gameId, cy))).not.toContain(text)
    }
    expect((await call(host, { type: 'end', gameId })).status).toBe(200)
  }, 60_000)

  it('is refused for a game with the check off', async () => {
    const gameId = await world.game(host, party, 'soundtrack', 'Lydspor without AI', { ...SETTINGS, aiCheck: false })
    expect((await call(host, { type: 'start', gameId })).status).toBe(200)
    expect((await hostAct(gameId, { type: 'play', index: 0 })).status).toBe(200)
    expect((await hostAct(gameId, { type: 'lock' }, playedKeys(1, true))).status).toBe(200)
    expect(await askHandler(host, { gameId })).toMatchObject({ status: 409, body: { error: 'The AI check is off for this game' } })
    expect(await hostAct(gameId, { type: 'ai', yes: [] })).toMatchObject({ status: 400, body: { error: 'The AI check is off for this game' } })
    expect((await call(host, { type: 'end', gameId })).status).toBe(200)
  }, 30_000)
})
