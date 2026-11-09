// The engine against the local Supabase stack (`supabase start`), through the
// real /api/game handler and real signed-in users (docs/engine-v2.md, 9.2).
// Run with `npm run test:integration`. Test-only plugins (the probe) go
// through handleGameRequest with logicFor, as the handler would run them.
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ProbeGame, type ProbePublicState, type ProbeState, type ProbeView } from '../../src/games/core/probe'
import { simulateParty } from '../../src/games/core/simulate'
import type { EliminationPublicState } from '../../src/games/elimination/logic'
import { handleGameRequest, parseGameRequest } from './engine'
import { admin, call, engine, rows, sleep, testLogic, World, type Guest, type Party, type Person } from './testUsers'

const world = new World()
let host: Person
let party: Party
let guests: Guest[]

beforeAll(async () => {
  host = await world.host()
  party = await world.party(host, 'Engine test')
  guests = []
  for (const name of ['Ana', 'Bo', 'Cy', 'Dee']) guests.push(await world.guest(party, name))
})

afterAll(() => world.cleanup())

const elimination = (gameId: string) => ({
  start: (stage?: boolean) => call(host, { type: 'start', gameId, ...(stage === undefined ? {} : { stage }) }),
  tag: (by: Guest, target: Guest, requestId?: string) =>
    call(by, { type: 'action', gameId, action: { type: 'tag', target: target.playerId }, ...(requestId ? { requestId } : {}) }),
  end: () => call(host, { type: 'end', gameId }),
})

const gameRow = async (id: string) => (await rows<Record<string, unknown>>('session_games', 'id', id))[0]
const spotlight = async () => (await rows<{ spotlight_game_id: string | null }>('sessions', 'id', party.id))[0].spotlight_game_id
const logOf = async (gameId: string) =>
  (await admin.from('event_log').select('*').eq('game_id', gameId).order('id')).data as {
    id: number
    kind: string
    actor: string
    request_id: string | null
    cause_id: number | null
    round: number | null
    data: Record<string, unknown>
  }[]

/** A client whose rpc() runs `before` once, right before the named call goes out: an interleaving. */
function interleave(name: 'game_load' | 'game_commit', nth: number, before: () => Promise<unknown>): SupabaseClient {
  let seen = 0
  return {
    rpc: async (rpcName: string, args: Record<string, unknown>) => {
      if (rpcName === name && ++seen === nth) await before()
      return admin.rpc(rpcName, args)
    },
  } as unknown as SupabaseClient
}

async function viaEngine(db: SupabaseClient, person: Person, body: Record<string, unknown>) {
  const { data } = await admin.auth.getClaims(person.token)
  return handleGameRequest(db, data!.claims.sub, parseGameRequest({ requestId: crypto.randomUUID(), ...body }), {
    logicFor: testLogic,
  })
}

describe('requests and replies', () => {
  it('answers each failure with its status and code', async () => {
    const gameId = await world.game(host, party, 'elimination', 'Codes')
    const get = await (await import('../functions/game.mts')).default(new Request('http://localhost/api/game'))
    expect(get.status).toBe(405)
    expect(await call(null, { type: 'start', gameId })).toMatchObject({ status: 401, body: { code: 'not_signed_in' } })
    expect(await call({ ...host, token: 'not-a-token' }, { type: 'start', gameId })).toMatchObject({ status: 401 })
    expect(await call(host, { type: 'start' })).toMatchObject({ status: 400, body: { code: 'bad_request', error: 'gameId is required' } })
    expect(await call(host, { type: 'start', gameId: crypto.randomUUID() })).toMatchObject({ status: 404, body: { code: 'not_found' } })
    expect(await call(guests[0], { type: 'start', gameId })).toMatchObject({ status: 403, body: { code: 'not_host' } })
    // Who may comes first: the host has no player, so a move is refused as such.
    expect(await call(host, { type: 'action', gameId, action: {} })).toMatchObject({ status: 403, body: { code: 'not_player' } })
    expect(await call(guests[0], { type: 'action', gameId, action: {} })).toMatchObject({ status: 409, body: { code: 'not_running' } })

    const unknown = await world.game(host, party, 'karaoke', 'Unknown')
    expect(await call(host, { type: 'start', gameId: unknown })).toMatchObject({
      status: 409,
      body: { code: 'unknown_game_type', error: "This app doesn't know the game type karaoke" },
    })
    const timing = (await call(host, { type: 'start', gameId: crypto.randomUUID() })).timing
    expect(timing).toMatch(/auth;dur=[\d.]+, load;dur=[\d.]+, step;dur=[\d.]+, commit;dur=[\d.]+, attempts;desc=1/)
  })
})

describe('Last one standing through the real handler', () => {
  let gameId: string
  let game: ReturnType<typeof elimination>

  beforeAll(async () => {
    gameId = await world.game(host, party, 'elimination', 'Killer', { tasks: ['sing', 'dance', 'ribbit', 'wave'] })
    game = elimination(gameId)
  })

  it('deals once, even when the host starts it twice at once', async () => {
    const results = await Promise.all([game.start(false), game.start(false)])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    expect(results.find((r) => r.status === 409)?.body).toEqual({ error: 'This game is already running', code: 'already_running' })
    expect((await logOf(gameId)).filter((r) => r.kind === 'game.started')).toHaveLength(1)
    const row = await gameRow(gameId)
    expect(row).toMatchObject({ status: 'active', finished_at: null })
    expect(((row.public_state as EliminationPublicState).alive)).toEqual(guests.map((g) => g.playerId))
    // Started in the background: the stage stays as it was.
    expect(await spotlight()).toBeNull()
  })

  it('saves a tap once: a resend and a copy racing its original are replayed', async () => {
    const [ana, bo] = guests
    const tap = crypto.randomUUID()
    const first = await game.tag(ana, bo, tap)
    expect(first).toMatchObject({ status: 200, body: { view: { status: 'alive' } } })
    expect(await game.tag(ana, bo, tap)).toMatchObject({ status: 200, body: { replayed: true } })

    const feed = (await rows<{ message: string }>('session_feed', 'game_id', gameId)).filter((f) => f.message === 'Ana got Bo')
    expect(feed).toHaveLength(1)

    // A copy racing its original: one saves, the other is answered replayed.
    const [cy, dee] = guests.slice(2)
    const race = crypto.randomUUID()
    const both = await Promise.all([game.tag(cy, dee, race), game.tag(cy, dee, race)])
    expect(both.map((r) => r.status)).toEqual([200, 200])
    expect(both.filter((r) => r.body.replayed === true)).toHaveLength(1)
    const log = await logOf(gameId)
    expect(log.filter((r) => r.kind === 'game.action' && r.request_id === race)).toHaveLength(1)
  })

  it('refuses a broken rule with the game words, and logs every path', async () => {
    const [ana, bo] = guests
    expect(await game.tag(bo, ana)).toEqual({ status: 400, body: { error: "You're out", code: 'rule' }, timing: expect.any(String) })
    const log = await logOf(gameId)
    const claim = log.find((r) => r.kind === 'game.action')!
    expect(claim).toMatchObject({ actor: 'player', round: 1, data: { action: { type: 'tag', target: bo.playerId } } })
    const effects = log.find((r) => r.kind === 'game.effects' && r.cause_id === claim.id)!
    expect(effects.data).toMatchObject({ scores: { [ana.playerId]: 1 }, profiles: { [ana.playerId]: { tags: 1 } } })
    expect(log.map((r) => r.kind)).toEqual(expect.arrayContaining(['game.added', 'game.settings_changed', 'game.start', 'game.started']))
  })

  it('ends once: a second End and any move after it are refused', async () => {
    expect(await game.end()).toMatchObject({ status: 200 })
    expect(await game.end()).toMatchObject({ status: 409, body: { code: 'not_running' } })
    expect(await game.tag(guests[0], guests[2])).toMatchObject({ status: 409, body: { code: 'not_running' } })
    const overs = (await rows<{ message: string }>('session_feed', 'game_id', gameId)).filter((f) => f.message === 'Last one standing is over')
    expect(overs).toHaveLength(1)
    expect(await gameRow(gameId)).toMatchObject({ status: 'finished', finished_by: 'host' })
  })

  it('refuses to archive a live game', async () => {
    const live = await world.game(host, party, 'elimination', 'Live', { tasks: ['sing'] })
    await elimination(live).start(false)
    const { error } = await host.client.from('session_games').update({ archived_at: new Date().toISOString() }).eq('id', live)
    expect(error).toMatchObject({ code: 'PT409', message: 'End the game before archiving it' })
    await elimination(live).end()
  })
})

describe('races and restarts', () => {
  it('retries a different move that lost the race (40001), then saves it', async () => {
    const gameId = await world.game(host, party, 'elimination', 'Race', { tasks: ['a', 'b', 'c', 'd'] })
    const game = elimination(gameId)
    await game.start(false)
    const [ana, bo, cy, dee] = guests
    // Cy's tag lands while Ana's is between its load and its commit.
    const db = interleave('game_commit', 1, () => game.tag(cy, dee))
    const result = await viaEngine(db, ana, { type: 'action', gameId, action: { type: 'tag', target: bo.playerId } })
    expect(result).toMatchObject({ view: { status: 'alive' } })
    const state = (await gameRow(gameId)).public_state as EliminationPublicState
    expect(state.out.sort()).toEqual([bo.playerId, dee.playerId].sort())
    await game.end()
  })

  it('refuses a move held across a restart, in the commit or in the retry', async () => {
    const gameId = await world.game(host, party, 'elimination', 'Restart', { tasks: ['a', 'b', 'c', 'd'] })
    const game = elimination(gameId)
    await game.start(false)
    const [ana, bo, cy, dee] = guests
    const restart = async () => {
      await game.end()
      await game.start(false)
    }
    // A restart between the move's load and its commit: game_commit checks the round.
    const held = interleave('game_commit', 1, restart)
    await expect(viaEngine(held, ana, { type: 'action', gameId, action: { type: 'tag', target: bo.playerId } })).rejects.toMatchObject({
      code: 'PT409',
      details: 'restarted',
    })

    // A restart between two attempts of one request: the retry is refused before anything is saved.
    let attempts = 0
    const retried = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === 'game_load' && ++attempts === 2) await restart()
        if (name === 'game_commit' && attempts === 1) await game.tag(cy, dee)
        return admin.rpc(name, args)
      },
    } as unknown as SupabaseClient
    await expect(viaEngine(retried, ana, { type: 'action', gameId, action: { type: 'tag', target: bo.playerId } })).rejects.toMatchObject({
      status: 409,
      code: 'restarted',
    })
    const row = await gameRow(gameId)
    expect((row.public_state as EliminationPublicState).out).toEqual([])
    const round3 = (await logOf(gameId)).filter((r) => r.round === 3 && r.kind === 'game.action')
    expect(round3).toEqual([])
    await game.end()
  })

  it('saves a move whose target was removed mid-move, without a foreign key error', async () => {
    const extra = await world.guest(party, 'Eve')
    const gameId = await world.game(host, party, 'elimination', 'Removal', { tasks: ['a', 'b', 'c', 'd', 'e'] })
    const game = elimination(gameId)
    await game.start(false)
    const db = interleave('game_commit', 1, async () => {
      const { error } = await host.client.from('players').delete().eq('id', extra.playerId)
      if (error) throw error
    })
    expect(await viaEngine(db, guests[0], { type: 'action', gameId, action: { type: 'tag', target: extra.playerId } })).toMatchObject({
      view: { status: 'alive' },
    })
    await game.end()
  })
})

describe('several games, the stage and timers', () => {
  const probe = (gameId: string) => ({
    start: (stage?: boolean) => engine(host, { type: 'start', gameId, ...(stage === undefined ? {} : { stage }) }),
    move: (by: Guest) => engine(by, { type: 'action', gameId, action: { type: 'move' } }),
    ask: (step: number) => engine(host, { type: 'host-action', gameId, action: { type: 'ask', step } }),
    end: () => engine(host, { type: 'end', gameId }),
  })

  it('runs three live games at once: one on the stage, two in the background', async () => {
    const [a, b, c] = await Promise.all(['Stage', 'Side A', 'Side B'].map((t) => world.game(host, party, 'probe', t, { movesToWin: 50, seconds: 10 })))
    expect(await probe(a).start(true)).toMatchObject({ status: 200 })
    expect(await probe(b).start(false)).toMatchObject({ status: 200 })
    expect(await probe(c).start(false)).toMatchObject({ status: 200 })
    expect(await spotlight()).toBe(a)
    const live = (await admin.from('session_games').select('id').eq('session_id', party.id).eq('status', 'active')).data!
    expect(live.map((g) => g.id)).toEqual(expect.arrayContaining([a, b, c]))
    for (const id of [a, b, c]) await probe(id).end()
  })

  it('lets a finishing game take a free stage, but not a busy one; Back to standings clears it', async () => {
    const stage = await world.game(host, party, 'probe', 'On stage', { movesToWin: 50, seconds: 10 })
    const side = await world.game(host, party, 'probe', 'Background', { movesToWin: 1, seconds: 10 })
    await probe(stage).start(true)
    await probe(side).start(false)
    expect(await probe(side).move(guests[0])).toMatchObject({ status: 200 })
    expect(await gameRow(side)).toMatchObject({ status: 'finished', finished_by: 'game', winners: [guests[0].playerId] })
    expect(await spotlight()).toBe(stage)

    // Back to standings: the host clears the stage, which is then free.
    await probe(stage).end()
    const { error } = await host.client.from('sessions').update({ spotlight_game_id: null }).eq('id', party.id)
    expect(error).toBeNull()
    await probe(side).start(false)
    await probe(side).move(guests[1])
    expect(await spotlight()).toBe(side)
    const changes = (await admin.from('event_log').select('data, actor').eq('session_id', party.id).eq('kind', 'stage.changed').order('id')).data!
    expect(changes.slice(-2).map((c) => [c.actor, (c.data as { reason: string }).reason])).toEqual([
      ['host', 'host'],
      ['game', 'finish'],
    ])
  })

  it('sets wake_at, and a sync from the paired TV reveals on time', async () => {
    const tv = await world.screen(host, party)
    const gameId = await world.game(host, party, 'probe', 'Timer', { movesToWin: 50, seconds: 1 })
    await probe(gameId).start(false)
    await probe(gameId).ask(0)
    const row = await gameRow(gameId)
    expect(row.wake_at).not.toBeNull()
    // Early: nothing is due yet.
    expect(await engine(tv, { type: 'sync', gameId })).toEqual({ status: 200, body: { skipped: true } })
    const { error } = await guests[0].client.rpc('submit_answer', {
      p_game_id: gameId,
      p_key: 'q1',
      p_payload: { choice: 'yes' },
      p_request_id: crypto.randomUUID(),
    })
    expect(error).toBeNull()
    await sleep(1100)
    expect(await engine(tv, { type: 'sync', gameId })).toEqual({ status: 200, body: {} })
    const after = await gameRow(gameId)
    expect(after.wake_at).toBeNull()
    expect((after.public_state as ProbePublicState).results).toEqual([{ key: 'q1', yes: 1, no: 0 }])
    // The screen may only sync.
    expect(await engine(tv, { type: 'action', gameId, action: { type: 'move' } })).toMatchObject({ status: 403, body: { code: 'not_player' } })
    expect(await engine(tv, { type: 'host-action', gameId, action: { type: 'ask', step: 1 } })).toMatchObject({ status: 403, body: { code: 'not_host' } })
    expect(await engine(tv, { type: 'start', gameId })).toMatchObject({ status: 403, body: { code: 'not_host' } })
    await probe(gameId).end()
  })

  it("ignores a guest's close and refuses their host action", async () => {
    const gameId = await world.game(host, party, 'probe', 'Guest close', { movesToWin: 50, seconds: 30 })
    await probe(gameId).start(false)
    await probe(gameId).ask(0)
    expect(await engine(guests[0], { type: 'host-action', gameId, action: { type: 'reveal', step: 1 }, close: ['q1'] })).toMatchObject({
      status: 403,
      body: { code: 'not_host' },
    })
    expect((await rows<{ closed_at: string | null }>('game_prompts', 'game_id', gameId))[0].closed_at).toBeNull()
    await probe(gameId).end()
  })

  it('runs the member hooks at the next sync after a join and a removal', async () => {
    const gameId = await world.game(host, party, 'probe', 'Members', { movesToWin: 50, seconds: 30 })
    await probe(gameId).start(false)
    const late = await world.guest(party, 'Late')
    const gone = await world.guest(party, 'Gone')
    await probe(gameId).ask(0)
    await host.client.from('players').delete().eq('id', gone.playerId)
    await engine(host, { type: 'sync', gameId })
    const state = (await rows<{ state: ProbeState; members: string[] }>('game_states', 'game_id', gameId))[0]
    expect(state.state.joined).toEqual(expect.arrayContaining([late.playerId, gone.playerId]))
    expect(state.state.left).toEqual([gone.playerId])
    expect(state.members).not.toContain(gone.playerId)
    const members = (await logOf(gameId)).filter((r) => r.kind === 'game.effects' && r.data.members)
    expect(members.at(-1)!.data.members).toEqual({ left: [gone.playerId] })
    await probe(gameId).end()
  })

  it('clears a stuck wake_at and logs game.wake_stuck', async () => {
    const gameId = await world.game(host, party, 'stuck', 'Stuck', { movesToWin: 50, seconds: 30 })
    await engine(host, { type: 'start', gameId, stage: false })
    expect((await gameRow(gameId)).wake_at).not.toBeNull()
    expect(await engine(host, { type: 'sync', gameId })).toEqual({ status: 200, body: {} })
    expect((await gameRow(gameId)).wake_at).toBeNull()
    const stuck = (await logOf(gameId)).filter((r) => r.kind === 'game.wake_stuck')
    expect(stuck).toHaveLength(1)
    // Nothing is due any more: the screens stop asking.
    expect(await engine(host, { type: 'sync', gameId })).toEqual({ status: 200, body: { skipped: true } })
    await engine(host, { type: 'end', gameId })
  })

  it('ends a game whose onEnd throws, and crowns the top of the host awards by default', async () => {
    class BrokenEnd extends ProbeGame {
      readonly type: string = 'probe'
      onEnd(): ProbeState {
        throw new Error('onEnd broke')
      }
    }
    const broken = new BrokenEnd()
    const gameId = await world.game(host, party, 'probe', 'Broken end', { movesToWin: 50, seconds: 30 })
    await engine(host, { type: 'start', gameId, stage: false })
    await host.client.from('score_events').insert({ session_id: party.id, player_id: guests[2].playerId, game_id: gameId, points: 4 })
    await host.client.from('score_events').insert({ session_id: party.id, player_id: guests[1].playerId, game_id: gameId, points: 1 })
    const { data } = await admin.auth.getClaims(host.token)
    const error = console.error
    console.error = () => {}
    const result = await handleGameRequest(admin, data!.claims.sub, parseGameRequest({ type: 'end', gameId }), {
      logicFor: () => broken,
    }).finally(() => (console.error = error))
    expect(result).toEqual({})
    expect(await gameRow(gameId)).toMatchObject({ status: 'finished', finished_by: 'host', winners: [guests[2].playerId] })
  })
})

describe('in-person rounds', () => {
  it('crowns the top of the round awards after End, and nobody without awards', async () => {
    const round = await world.game(host, party, 'in-person', 'Beer pong')
    expect(await call(host, { type: 'start', gameId: round })).toMatchObject({ status: 200 })
    expect(await spotlight()).toBe(round)
    await host.client.from('score_events').insert({ session_id: party.id, player_id: guests[3].playerId, game_id: round, points: 3 })
    expect(await call(host, { type: 'end', gameId: round })).toMatchObject({ status: 200 })
    expect(await gameRow(round)).toMatchObject({ status: 'finished', winners: [guests[3].playerId] })
    // A restart starts its points over: the old round's awards don't count.
    await call(host, { type: 'start', gameId: round })
    await call(host, { type: 'end', gameId: round })
    expect((await gameRow(round)).winners).toEqual([])
  })
})

describe('the recap', () => {
  it("gives hosts the night's raw material, and nobody else", async () => {
    const { data, error } = await host.client.rpc('session_recap', { p_session_id: party.id })
    expect(error).toBeNull()
    expect(Object.keys(data).sort()).toEqual(['games', 'log', 'players', 'rounds', 'session', 'standings'])
    const round = data.rounds.find((r: { finished_by: string | null }) => r.finished_by === 'host')
    expect(round).toEqual(
      expect.objectContaining({
        game_id: expect.any(String),
        round: expect.any(Number),
        started_at: expect.any(Number),
        finished_at: expect.any(Number),
        config: expect.any(Object),
        scores: expect.any(Object),
        points: expect.any(Object),
        winners: expect.any(Array),
      }),
    )
    // The bulky start and finish rows come without their data.
    const started = data.log.find((r: { kind: string }) => r.kind === 'game.started')
    expect(started.data).toEqual({})
    const removed = data.players.find((p: { removed_at: number | null }) => p.removed_at !== null)
    expect(removed).toMatchObject({ name: expect.any(String), joined_at: expect.any(Number) })
    const refused = await guests[0].client.rpc('session_recap', { p_session_id: party.id })
    expect(refused.error).toMatchObject({ code: 'PT403', message: 'Only hosts can read this' })
  })
})

describe('conformance: the in-memory party matches the database', () => {
  it('ends a scripted round with the same status, winners, spotlight and views', async () => {
    // The same script through FakeParty and through the database: a probe on the
    // stage with a timer reveal, a second one in the background that finishes
    // by itself while the stage is busy, and a removal.
    const fake = simulateParty({ games: [new ProbeGame()], players: 4 })
    fake.addGame('stage', 'probe', 'Stage', { movesToWin: 50, seconds: 1 })
    fake.addGame('side', 'probe', 'Side', { movesToWin: 2, seconds: 10 })

    const realHost = await world.host()
    const realParty = await world.party(realHost, 'Conformance')
    const real: Guest[] = []
    for (const name of ['P1', 'P2', 'P3', 'P4']) real.push(await world.guest(realParty, name))
    const ids = {
      stage: await world.game(realHost, realParty, 'probe', 'Stage', { movesToWin: 50, seconds: 1 }),
      side: await world.game(realHost, realParty, 'probe', 'Side', { movesToWin: 2, seconds: 10 }),
    }
    const fakeIds = fake.players.map((p) => p.id)

    type Step =
      | { as: 'host'; body: Record<string, unknown> }
      | { as: number; body: Record<string, unknown> }
      | { answer: number; key: string; choice: string }
      | { remove: number }
      | { wait: number }
      | { sync: 'stage' | 'side' }
    const script: Step[] = [
      { as: 'host', body: { type: 'start', game: 'stage', stage: true } },
      { as: 'host', body: { type: 'start', game: 'side', stage: false } },
      { as: 'host', body: { type: 'host-action', game: 'stage', action: { type: 'ask', step: 0 } } },
      { answer: 1, key: 'q1', choice: 'yes' },
      { answer: 2, key: 'q1', choice: 'no' },
      { as: 0, body: { type: 'action', game: 'side', action: { type: 'move' } } },
      { remove: 3 },
      { as: 1, body: { type: 'action', game: 'side', action: { type: 'move' } } },
      { wait: 1200 },
      { sync: 'stage' },
      { as: 'host', body: { type: 'end', game: 'stage' } },
    ]

    for (const s of script) {
      if ('wait' in s) {
        fake.tick(s.wait)
        await sleep(s.wait)
      } else if ('remove' in s) {
        fake.removePlayer(fakeIds[s.remove])
        await realHost.client.from('players').delete().eq('id', real[s.remove].playerId)
      } else if ('answer' in s) {
        fake.submit('stage', s.key, fakeIds[s.answer], { choice: [s.choice] })
        const { error } = await real[s.answer].client.rpc('submit_answer', {
          p_game_id: ids.stage,
          p_key: s.key,
          p_payload: { choice: s.choice },
          p_request_id: crypto.randomUUID(),
        })
        expect(error).toBeNull()
      } else if ('sync' in s) {
        fake.sync(s.sync)
        expect((await engine(realHost, { type: 'sync', gameId: ids[s.sync] })).status).toBe(200)
      } else {
        const { game, ...body } = s.body as { game: 'stage' | 'side' } & Record<string, unknown>
        const fakeUser = s.as === 'host' ? fake.hostUser : fake.userOf(fakeIds[s.as])
        expect(fake.send(fakeUser, { ...body, gameId: game } as never).kind).not.toBe('refuse')
        const person = s.as === 'host' ? realHost : real[s.as]
        expect((await engine(person, { ...body, gameId: ids[game] })).status).toBe(200)
      }
    }

    const realSpotlight = (await rows<{ spotlight_game_id: string }>('sessions', 'id', realParty.id))[0].spotlight_game_id
    expect(realSpotlight === ids.stage ? 'stage' : realSpotlight === ids.side ? 'side' : null).toBe(fake.spotlight)
    for (const key of ['stage', 'side'] as const) {
      const fakeGame = fake.game(key)
      const realGame = await gameRow(ids[key])
      const realIndex = (id: string) => real.findIndex((g) => g.playerId === id)
      const fakeIndex = (id: string) => fakeIds.indexOf(id)
      expect(realGame.status, key).toBe(fakeGame.status)
      expect(realGame.finished_by, key).toBe(fakeGame.finishedBy)
      expect((realGame.winners as string[]).map(realIndex), key).toEqual(fakeGame.winners.map(fakeIndex))
      expect(realGame.public_state, key).toEqual(fakeGame.publicState)
      const realViews = await rows<{ player_id: string; view: ProbeView }>('game_player_views', 'game_id', ids[key])
      const byIndex = (entries: [number, unknown][]) => Object.fromEntries(entries.sort((a, b) => a[0] - b[0]))
      expect(byIndex(realViews.map((v) => [realIndex(v.player_id), v.view])), key).toEqual(
        byIndex(Object.entries(fakeGame.views).map(([id, view]) => [fakeIndex(id), view])),
      )
    }
  })
})
