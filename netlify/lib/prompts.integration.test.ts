// Prompts against the local stack (docs/engine-v2.md, 2.7 and 9.2): phones
// answer straight to the database with submit_answer, never through the
// engine. Every rule, an answer held in flight across a reveal, and the burst
// of 45 guests answering at once.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PromptSpec } from '../../src/games/core/Game'
import { admin, anonClient, engine, rows, sleep, sql, World, type Guest, type Party, type Person } from './testUsers'

const world = new World()
let host: Person
let party: Party
let guests: Guest[]
let gameId: string

beforeAll(async () => {
  host = await world.host()
  party = await world.party(host, 'Prompts test')
  guests = []
  for (const name of ['Ana', 'Bo', 'Cy']) guests.push(await world.guest(party, name))
  gameId = await world.game(host, party, 'lab', 'Lab')
  expect(await engine(host, { type: 'start', gameId, stage: false })).toMatchObject({ status: 200 })
})

afterAll(() => world.cleanup())

const open = async (key: string, spec: PromptSpec, closesInMs?: number, game = gameId) => {
  const result = await engine(host, { type: 'host-action', gameId: game, action: { type: 'open', key, spec, closesInMs } })
  expect(result.status).toBe(200)
}
const answer = (person: Person, key: string, payload: unknown, requestId: string = crypto.randomUUID(), game = gameId) =>
  person.client.rpc('submit_answer', { p_game_id: game, p_key: key, p_payload: payload, p_request_id: requestId })

/** The refusal's message and detail, or 'ok'. */
async function outcome(result: PromiseLike<{ error: { message: string; details?: string; code?: string } | null }>) {
  const { error } = await result
  return error ? `${error.code} ${error.details}: ${error.message}` : 'ok'
}

describe('who may answer, and when', () => {
  it('takes answers only while the prompt is open and before its deadline', async () => {
    const [ana, bo, cy] = guests
    expect(await outcome(answer(ana, 'nope', { choice: 'a' }))).toBe('PT409 closed: This question is not open')

    await open('deadline', { kind: 'choice', options: ['a', 'b'] }, 400)
    expect(await outcome(answer(ana, 'deadline', { choice: 'a' }))).toBe('ok')
    await sleep(500)
    expect(await outcome(answer(bo, 'deadline', { choice: 'a' }))).toBe('PT409 closed: Too late, answers are closed')

    await open('closed', { kind: 'choice', options: ['a', 'b'] })
    await engine(host, { type: 'host-action', gameId, action: { type: 'close', key: 'closed' } })
    expect(await outcome(answer(cy, 'closed', { choice: 'a' }))).toBe('PT409 closed: Too late, answers are closed')
  })

  it('refuses anyone who is not a player of the party: an outsider, a paired TV and anon', async () => {
    await open('who', { kind: 'choice', options: ['a', 'b'] })
    const outsider = await world.user()
    const tv = await world.screen(host, party)
    expect(await outcome(answer(outsider, 'who', { choice: 'a' }))).toBe("PT403 not_player: You're not a player in this party")
    expect(await outcome(answer(tv, 'who', { choice: 'a' }))).toBe("PT403 not_player: You're not a player in this party")
    const { error } = await anonClient().rpc('submit_answer', {
      p_game_id: gameId,
      p_key: 'who',
      p_payload: { choice: 'a' },
      p_request_id: crypto.randomUUID(),
    })
    expect(error?.code).toBe('42501')
  })

  it('refuses answers to a game that is not running', async () => {
    const other = await world.game(host, party, 'lab', 'Over')
    await engine(host, { type: 'start', gameId: other, stage: false })
    await open('late', { kind: 'choice', options: ['a'] }, undefined, other)
    await engine(host, { type: 'end', gameId: other })
    // A finish closes every prompt.
    expect(await outcome(answer(guests[0], 'late', { choice: 'a' }, undefined, other))).toBe(
      'PT409 closed: Too late, answers are closed',
    )
  })
})

describe('the spec decides what an answer may be', () => {
  it('checks choices: options, repeats, how many, and the players list', async () => {
    const [ana, bo, cy] = guests
    await open('pick', { kind: 'choice', options: ['a', 'b', 'c'], min: 1, max: 2 })
    const cases: [unknown, string][] = [
      [{ choice: 'z' }, 'That is not one of the options'],
      [{ choice: [] }, 'Pick an option'],
      [{ nothing: true }, 'Pick an option'],
      [{ choice: ['a', 'a'] }, 'Pick each option only once'],
      [{ choice: ['a', 'b', 'c'] }, 'Pick 1 to 2'],
      [{ choice: [1] }, 'That is not one of the options'],
      ['a', 'That answer is not valid'],
      [{ choice: 'a', pad: 'x'.repeat(3000) }, 'That answer is not valid'],
    ]
    for (const [payload, message] of cases) {
      expect(await outcome(answer(ana, 'pick', payload)), JSON.stringify(payload).slice(0, 30)).toBe(
        `PT400 answer_invalid: ${message}`,
      )
    }
    // Normalised: one string becomes a list, choices come back sorted.
    const { data } = await answer(ana, 'pick', { choice: ['c', 'a'] })
    expect(data).toMatchObject({ accepted: true, answer: { choice: ['a', 'c'] } })

    await open('pair', { kind: 'choice', options: 'players', min: 2, max: 2, exclude_self: true })
    expect(await outcome(answer(ana, 'pair', { choice: [ana.playerId, bo.playerId] }))).toBe(
      'PT400 answer_invalid: That is not one of the options',
    )
    expect(await outcome(answer(ana, 'pair', { choice: [bo.playerId] }))).toBe('PT400 answer_invalid: Pick 2')
    expect(await outcome(answer(ana, 'pair', { choice: [crypto.randomUUID(), bo.playerId] }))).toBe(
      'PT400 answer_invalid: That is not one of the options',
    )
    expect(await outcome(answer(ana, 'pair', { choice: [cy.playerId, bo.playerId] }))).toBe('ok')
  })

  it('checks numbers and text, and refuses a prompt kind it does not know', async () => {
    const [ana, bo] = guests
    await open('number', { kind: 'number', min: 0, max: 10, integer: true })
    expect(await outcome(answer(ana, 'number', { value: 'x' }))).toBe('PT400 answer_invalid: Enter a number')
    expect(await outcome(answer(ana, 'number', { value: 11 }))).toBe('PT400 answer_invalid: That number is out of range')
    expect(await outcome(answer(ana, 'number', { value: 2.5 }))).toBe('PT400 answer_invalid: That number is out of range')
    expect((await answer(ana, 'number', { value: 7 })).data).toMatchObject({ answer: { value: 7 } })

    await open('text', { kind: 'text', max_length: 5 })
    expect(await outcome(answer(ana, 'text', { text: '   ' }))).toBe('PT400 answer_invalid: Answers are 1 to 5 characters')
    expect(await outcome(answer(ana, 'text', { text: 'too long' }))).toBe('PT400 answer_invalid: Answers are 1 to 5 characters')
    expect((await answer(bo, 'text', { text: '  hi  ' })).data).toMatchObject({ answer: { text: 'hi' } })

    await open('odd', { kind: 'colour' } as unknown as PromptSpec)
    expect(await outcome(answer(ana, 'odd', { text: 'red' }))).toBe('PT400 answer_invalid: This question takes no answers')
  })
})

describe('resends, final answers and changeable votes', () => {
  it('takes a final answer once; a resend and the same answer again count as success', async () => {
    const [ana] = guests
    await open('final', { kind: 'choice', options: ['a', 'b'], final: true })
    const tap = crypto.randomUUID()
    const first = await answer(ana, 'final', { choice: 'a' }, tap)
    expect(first.data).toMatchObject({ accepted: true, answer: { choice: ['a'] }, at: expect.any(Number), ms: expect.any(Number) })
    expect((await answer(ana, 'final', { choice: 'a' }, tap)).data).toMatchObject({ accepted: true, replayed: true, answer: { choice: ['a'] } })
    expect((await answer(ana, 'final', { choice: ['a'] })).data).toMatchObject({ accepted: true, replayed: true })
    expect(await outcome(answer(ana, 'final', { choice: 'b' }))).toBe('PT409 already_answered: You already answered')

    // One log row for the tap, however often it was sent.
    const log = (await rows<{ kind: string; request_id: string }>('event_log', 'game_id', gameId)).filter(
      (r) => r.kind === 'prompt.answered' && r.request_id === tap,
    )
    expect(log).toHaveLength(1)
  })

  it('answers a resend of a saved tap as success even after the prompt closed', async () => {
    const [, bo] = guests
    await open('resend', { kind: 'choice', options: ['a', 'b'] })
    const tap = crypto.randomUUID()
    expect(await outcome(answer(bo, 'resend', { choice: 'b' }, tap))).toBe('ok')
    await engine(host, { type: 'host-action', gameId, action: { type: 'close', key: 'resend' } })
    expect((await answer(bo, 'resend', { choice: 'b' }, tap)).data).toMatchObject({ accepted: true, replayed: true, answer: { choice: ['b'] } })
  })

  it('lets a vote change until it closes, at most 20 times', async () => {
    const [, , cy] = guests
    await open('vote', { kind: 'choice', options: ['a', 'b'] })
    expect(await outcome(answer(cy, 'vote', { choice: 'a' }))).toBe('ok')
    for (let i = 0; i < 20; i++) expect(await outcome(answer(cy, 'vote', { choice: i % 2 ? 'a' : 'b' }))).toBe('ok')
    expect(await outcome(answer(cy, 'vote', { choice: 'b' }))).toBe("PT409 too_many_changes: That's enough changes for this one")
    const [sub] = (await rows<{ changes: number; key: string; player_id: string }>('game_submissions', 'game_id', gameId)).filter(
      (s) => s.key === 'vote',
    )
    expect(sub.changes).toBe(20)
  })
})

describe('closing waits for answers in flight', () => {
  it('lets a reveal see an answer that was in flight, and refuses one after the close', async () => {
    const [ana, , cy] = guests
    await open('flight', { kind: 'choice', options: ['a', 'b'] })
    // Cy's answer is saved in a transaction that stays open for 1.5 s, holding the prompt's share lock.
    const inFlight = sql(`
      begin;
      select set_config('request.jwt.claims', '{"sub":"${cy.userId}","role":"authenticated"}', true);
      set local role authenticated;
      select public.submit_answer('${gameId}'::uuid, 'flight', '{"choice":"b"}'::jsonb, '${crypto.randomUUID()}'::uuid);
      select pg_sleep(1.5);
      commit;
    `)
    await sleep(400)
    const started = Date.now()
    const reveal = await engine(host, { type: 'host-action', gameId, action: { type: 'reveal', key: 'flight' }, close: ['flight'] })
    expect(reveal.status).toBe(200)
    // The close waited for Cy's transaction.
    expect(Date.now() - started).toBeGreaterThan(800)
    await inFlight
    const state = (await rows<{ state: { revealed: { key: string; count: number; answers: Record<string, unknown> }[] } }>(
      'game_states',
      'game_id',
      gameId,
    ))[0].state
    const flight = state.revealed.find((r) => r.key === 'flight')!
    expect(flight.count).toBe(1)
    expect(flight.answers).toEqual({ [cy.playerId]: { choice: ['b'] } })
    expect(await outcome(answer(ana, 'flight', { choice: 'a' }))).toBe('PT409 closed: Too late, answers are closed')
  })
})

describe('closes in the log', () => {
  type LogRow = {
    kind: string
    actor: string
    user_id: string | null
    request_id: string | null
    game_type: string | null
    round: number | null
    data: Record<string, unknown>
  }
  const logRows = () => rows<LogRow>('event_log', 'game_id', gameId)
  const closesOf = async (key: string) => (await logRows()).filter((r) => r.kind === 'prompt.closed' && r.data.key === key)

  it('logs a deadline close as the timer, even when the request that closed it saves nothing', async () => {
    await open('log-deadline', { kind: 'choice', options: ['a', 'b'] }, 300)
    await sleep(400)
    // Any request for the game closes due deadlines first: here one that changes nothing.
    expect(await engine(host, { type: 'host-action', gameId, action: { type: 'noop' } })).toEqual({ status: 200, body: { skipped: true } })
    const [prompt] = (await rows<{ key: string; closes_at: string; closed_at: string | null }>('game_prompts', 'game_id', gameId)).filter(
      (p) => p.key === 'log-deadline',
    )
    expect(prompt.closed_at).toBe(prompt.closes_at)
    const closes = await closesOf('log-deadline')
    expect(closes).toEqual([expect.objectContaining({ actor: 'timer', user_id: null, request_id: null, game_type: 'lab', round: 1 })])
    expect(closes[0].data).toMatchObject({ key: 'log-deadline', round: 1 })
    // The deadline, not the moment the request found it past.
    expect(Math.abs((closes[0].data.closed_at as number) - Date.parse(prompt.closes_at))).toBeLessThanOrEqual(1)
  })

  it("logs a host's close as the host, even when the request is then refused", async () => {
    await open('log-host', { kind: 'choice', options: ['a', 'b'] })
    // A close with a host action the game refuses: the close stands, and the log says who made it.
    expect(await engine(host, { type: 'host-action', gameId, action: null, close: ['log-host'] })).toMatchObject({
      status: 400,
      body: { code: 'rule' },
    })
    expect(await outcome(answer(guests[0], 'log-host', { choice: 'a' }))).toBe('PT409 closed: Too late, answers are closed')
    const closes = await closesOf('log-host')
    expect(closes).toEqual([expect.objectContaining({ actor: 'host', user_id: host.userId, request_id: null, game_type: 'lab', round: 1 })])
    expect(closes[0].data).toEqual({ key: 'log-host', round: 1, closed_at: expect.any(Number) })

    // A guest's close is ignored, so it logs nothing.
    await open('log-guest', { kind: 'choice', options: ['a', 'b'] })
    expect(await engine(guests[0], { type: 'host-action', gameId, action: { type: 'noop' }, close: ['log-guest'] })).toMatchObject({
      status: 403,
    })
    expect(await closesOf('log-guest')).toEqual([])
  })

  it('logs the close of a Reveal now that saves, and its own claim is still a claim, not a replay', async () => {
    await open('log-reveal', { kind: 'choice', options: ['a', 'b'] })
    const requestId = crypto.randomUUID()
    expect(
      await engine(host, { type: 'host-action', gameId, requestId, action: { type: 'reveal', key: 'log-reveal' }, close: ['log-reveal'] }),
    ).toEqual({ status: 200, body: {} })
    expect(await closesOf('log-reveal')).toEqual([expect.objectContaining({ actor: 'host', user_id: host.userId, request_id: null })])
    const claim = (await logRows()).filter((r) => r.request_id === requestId)
    expect(claim).toEqual([expect.objectContaining({ kind: 'game.host_action', data: expect.objectContaining({ close: ['log-reveal'] }) })])
    const [prompt] = (await rows<{ key: string; revealed_at: string | null }>('game_prompts', 'game_id', gameId)).filter(
      (p) => p.key === 'log-reveal',
    )
    expect(prompt.revealed_at).not.toBeNull()
  })
})

describe('tallies', () => {
  it('counts answers for members and hosts, and gives an outsider nothing', async () => {
    await open('count', { kind: 'choice', options: ['a', 'b'] })
    await answer(guests[0], 'count', { choice: 'a' })
    await answer(guests[1], 'count', { choice: 'b' })
    const { data: mine } = await guests[2].client.rpc('prompt_tallies', { p_session_id: party.id })
    expect(mine[gameId].count).toBe(2)
    const { data: hosts } = await host.client.rpc('prompt_tallies', { p_session_id: party.id })
    expect(hosts[gameId].count).toBe(2)
    const outsider = await world.user()
    expect((await outsider.client.rpc('prompt_tallies', { p_session_id: party.id })).data).toEqual({})
  })
})

describe('the burst', () => {
  it('takes 45 answers at once: none lost, none counted twice, and one save reveals them all', async () => {
    const burstParty = await world.party(host, 'Burst')
    const crowd: Guest[] = []
    for (let i = 0; i < 45; i += 15) {
      crowd.push(...(await Promise.all(Array.from({ length: 15 }, (_, j) => world.guest(burstParty, `Guest ${i + j + 1}`)))))
    }
    const quiz = await world.game(host, burstParty, 'lab', 'Burst')
    await engine(host, { type: 'start', gameId: quiz, stage: false })
    await open('b1', { kind: 'choice', options: ['0', '1', '2', '3'], final: true }, undefined, quiz)

    const started = Date.now()
    const results = await Promise.all(crowd.map((g, i) => answer(g, 'b1', { choice: String(i % 4) }, crypto.randomUUID(), quiz)))
    const ms = Date.now() - started
    console.info(`45 answers at once: ${ms} ms`)
    const errors = results.filter((r) => r.error)
    expect(errors.map((r) => r.error?.message)).toEqual([])
    expect(results.filter((r) => (r.data as { accepted?: boolean })?.accepted)).toHaveLength(45)
    expect(ms).toBeLessThan(2000)

    const { data: tallies } = await host.client.rpc('prompt_tallies', { p_session_id: burstParty.id })
    expect(tallies[quiz].b1).toBe(45)
    expect(await rows('game_submissions', 'game_id', quiz)).toHaveLength(45)

    const reveal = crypto.randomUUID()
    expect(
      await engine(host, { type: 'host-action', gameId: quiz, requestId: reveal, action: { type: 'reveal', key: 'b1' }, close: ['b1'] }),
    ).toMatchObject({ status: 200 })
    const state = (await rows<{ state: { revealed: { key: string; count: number }[] } }>('game_states', 'game_id', quiz))[0].state
    expect(state.revealed).toEqual([expect.objectContaining({ key: 'b1', count: 45 })])

    // All 45 views, written in that one save.
    const views = await rows<{ player_id: string; view: { mine: { key: string; answer: { choice: string[] } | null }[] } }>(
      'game_player_views',
      'game_id',
      quiz,
    )
    expect(views).toHaveLength(45)
    for (const { player_id, view } of views) {
      const index = crowd.findIndex((g) => g.playerId === player_id)
      expect(view.mine).toEqual([{ key: 'b1', answer: { choice: [String(index % 4)] } }])
    }
    const log = await rows<{ kind: string; request_id: string | null; cause_id: number | null; id: number; data: { prompts?: unknown } }>(
      'event_log',
      'game_id',
      quiz,
    )
    const claim = log.filter((r) => r.request_id === reveal)
    expect(claim).toHaveLength(1)
    expect(log.filter((r) => r.cause_id === claim[0].id && r.kind === 'game.effects')).toEqual([
      // game_load closed it (the host's close list), so this save only reveals it.
      expect.objectContaining({ data: expect.objectContaining({ prompts: { revealed: ['b1'] } }) }),
    ])
    expect(log.filter((r) => r.kind === 'prompt.answered')).toHaveLength(45)
    // Nothing more is taken once revealed.
    const late = await answer(crowd[0], 'b1', { choice: '1' }, crypto.randomUUID(), quiz)
    expect(late.error?.message).toBe('Too late, answers are closed')
    const { count } = await admin.from('game_submissions').select('*', { count: 'exact', head: true }).eq('game_id', quiz)
    expect(count).toBe(45)
  })
})
