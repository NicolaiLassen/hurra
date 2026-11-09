import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GameCallError } from './gameApi'
import {
  archiveSession,
  awardPoints,
  createSession,
  getPlayerByCode,
  issuePlayerTransfer,
  joinSession,
  loadMembership,
  publishRecap,
  removePlayer,
  renamePlayer,
  revokePlayerTransfer,
  setSpotlight,
  unpublishRecap,
} from './queries'
import type { RecapDoc } from './recap'

type Result = { data: unknown; error: { message: string; details?: string | null; code?: string | null } | null; status: number }
type Call = { table: string; ops: [string, unknown[]][] }
type Respond = (call: Call) => Result
type RespondRpc = (name: string, args: Record<string, unknown>) => Result

/** A chainable stand-in for supabase-js: every query is recorded, and `respond` answers it. */
const db = vi.hoisted(() => {
  const empty = (): Result => ({ data: null, error: null, status: 200 })
  const state = {
    calls: [] as Call[],
    rpcs: [] as { name: string; args: Record<string, unknown> }[],
    respond: empty as Respond,
    respondRpc: empty as RespondRpc,
  }
  const builder = (call: Call): unknown =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') {
            const result = state.respond(call)
            return (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
          }
          return (...args: unknown[]) => {
            call.ops.push([String(prop), args])
            return builder(call)
          }
        },
      },
    )
  const client = {
    from(table: string) {
      const call: Call = { table, ops: [] }
      state.calls.push(call)
      return builder(call)
    },
    rpc(name: string, args: Record<string, unknown>) {
      state.rpcs.push({ name, args })
      const result = state.respondRpc(name, args)
      return Object.assign(Promise.resolve(result), { abortSignal: () => Promise.resolve(result) })
    },
    auth: { getSession: async () => ({ data: { session: { user: { id: 'user-1' }, access_token: 'token' } }, error: null }) },
  }
  return { state, client }
})

vi.mock('@/lib/supabase', () => ({ supabase: db.client }))

const SESSION = '0b6a7c1e-5d2f-4b8a-9c3d-2e1f0a9b8c7d'
const PLAYER = '7d1e2f3a-4b5c-4d6e-8f70-81a2b3c4d5e6'
const op = (call: Call, name: string) => call.ops.find(([n]) => n === name)?.[1]
const ok = (data: unknown): Result => ({ data, error: null, status: 200 })

beforeEach(() => {
  db.state.calls = []
  db.state.rpcs = []
  db.state.respond = () => ok(null)
  db.state.respondRpc = () => ok(null)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the recap calls', () => {
  const doc = { version: 1, session: { id: SESSION, name: 'Party' } } as RecapDoc

  it('publishRecap always sends published_at, so an Update that changes only the data still counts', async () => {
    await publishRecap(SESSION, doc)
    await publishRecap(SESSION, doc)
    expect(db.state.calls).toHaveLength(2)
    for (const call of db.state.calls) {
      expect(call.table).toBe('session_recaps')
      const [row, options] = op(call, 'upsert') as [Record<string, unknown>, Record<string, unknown>]
      expect(row).toMatchObject({ session_id: SESSION, data: doc })
      expect(typeof row.published_at).toBe('string')
      expect(Number.isNaN(Date.parse(row.published_at as string))).toBe(false)
      expect(options).toEqual({ onConflict: 'session_id' })
    }
  })

  it('unpublishRecap clears published_at', async () => {
    await unpublishRecap(SESSION)
    const [call] = db.state.calls
    expect(op(call, 'update')).toEqual([{ published_at: null }])
    expect(op(call, 'eq')).toEqual(['session_id', SESSION])
  })
})

describe('joining', () => {
  it('joinSession calls join_session once, even when it is refused', async () => {
    db.state.respondRpc = () => ({
      data: null,
      error: { message: 'Someone already joined as "Ana". Try another name.', details: 'name_taken', code: 'PT409' },
      status: 409,
    })
    const error = (await joinSession('party', ' Ana ').catch((e: unknown) => e)) as GameCallError
    expect(db.state.rpcs).toEqual([{ name: 'join_session', args: { p_join_code: 'PARTY', p_name: 'Ana' } }])
    expect(error).toBeInstanceOf(GameCallError)
    expect([error.status, error.code, error.message]).toEqual([409, 'name_taken', 'Someone already joined as "Ana". Try another name.'])
  })

  it('joinSession does not retry when the network fails either', async () => {
    db.state.respondRpc = () => ({ data: null, error: { message: 'TypeError: fetch failed' }, status: 0 })
    const error = (await joinSession('PARTY', 'Ana').catch((e: unknown) => e)) as GameCallError
    expect(db.state.rpcs).toHaveLength(1)
    expect(error.status).toBe(0)
  })

  it('loadMembership finds the party by code and this browser’s player in it', async () => {
    const party = { id: SESSION, name: 'Party', join_code: 'PARTY', status: 'open', archived_at: null }
    db.state.respondRpc = () => ok(party)
    db.state.respond = () => ok({ id: PLAYER, session_id: SESSION, user_id: 'user-1', name: 'Ana', code: 'ABCDE', profile: {}, created_at: '2026-11-28T20:00:00Z' })
    const membership = await loadMembership('party')
    expect(membership?.session).toEqual(party)
    expect(membership?.player?.id).toBe(PLAYER)
    const [call] = db.state.calls
    expect(call.ops.filter(([n]) => n === 'eq')).toEqual([
      ['eq', ['session_id', SESSION]],
      ['eq', ['user_id', 'user-1']],
    ])
  })

  it('getPlayerByCode turns the party’s archived_at into epoch ms, and never queries a malformed code', async () => {
    expect(await getPlayerByCode('nope!')).toBeNull()
    expect(db.state.calls).toHaveLength(0)
    db.state.respond = () =>
      ok({
        id: PLAYER,
        session_id: SESSION,
        user_id: 'u',
        name: 'Ana',
        code: 'ABCDE',
        profile: {},
        created_at: '2026-11-28T20:00:00Z',
        session: { id: SESSION, name: 'Party', join_code: 'PARTY', status: 'closed', archived_at: '2026-11-28T23:00:00Z' },
      })
    const player = await getPlayerByCode('abcde')
    expect(player?.session.archived_at).toBe(Date.parse('2026-11-28T23:00:00Z'))
    expect(op(db.state.calls[0], 'eq')).toEqual(['code', 'ABCDE'])
  })
})

describe('host writes', () => {
  it('createSession says a taken join code under its own code, and remakes a clashing random one', async () => {
    db.state.respond = () => ({ data: null, error: { message: 'duplicate key', code: '23505' }, status: 409 })
    const error = (await createSession('Party', 'taken').catch((e: unknown) => e)) as GameCallError
    expect([error.code, error.message]).toEqual(['join_code_taken', 'TAKEN is already taken. Try another code, or leave it empty.'])

    let attempts = 0
    db.state.calls = []
    db.state.respond = () => (++attempts < 2 ? { data: null, error: { message: 'duplicate key', code: '23505' }, status: 409 } : ok({ id: SESSION }))
    await expect(createSession('Party')).resolves.toEqual({ id: SESSION })
    expect(db.state.calls).toHaveLength(2)
    expect(op(db.state.calls[0], 'insert')).toEqual([{ name: 'Party' }])
  })

  it('archiving a party also closes joining', async () => {
    db.state.respond = () => ok([{ id: SESSION }])
    await archiveSession(SESSION, true)
    const [patch] = op(db.state.calls[0], 'update') as [Record<string, unknown>]
    expect(patch.status).toBe('closed')
    expect(typeof patch.archived_at).toBe('string')
    await archiveSession(SESSION, false)
    expect(op(db.state.calls[1], 'update')).toEqual([{ archived_at: null }])
  })

  it('putting a game on the TV leaves the recap scene; Back to standings only clears the spotlight', async () => {
    db.state.respond = () => ok([{ id: SESSION }])
    await setSpotlight(SESSION, 'game-1')
    await setSpotlight(SESSION, null)
    expect(op(db.state.calls[0], 'update')).toEqual([{ spotlight_game_id: 'game-1', tv_scene: 'live' }])
    expect(op(db.state.calls[1], 'update')).toEqual([{ spotlight_game_id: null }])
  })

  it('an update that changes no row says the thing is gone', async () => {
    db.state.respond = () => ok([])
    await expect(setSpotlight(SESSION, null)).rejects.toThrow('That party is gone')
    await expect(renamePlayer(PLAYER, 'Bo')).rejects.toThrow('That player is gone')
  })

  it('renamePlayer refuses a taken name with its own code', async () => {
    db.state.respond = () => ({ data: null, error: { message: 'duplicate key value', code: '23505' }, status: 409 })
    const error = (await renamePlayer(PLAYER, 'Bo').catch((e: unknown) => e)) as GameCallError
    expect([error.code, error.message]).toEqual(['name_taken', 'Someone is already called "Bo"'])
    await expect(renamePlayer(PLAYER, '   ')).rejects.toThrow('Names are 1 to 40 characters')
  })

  it('renamePlayer turns a name with nothing to see (the check) into bad_name', async () => {
    db.state.respond = () => ({ data: null, error: { message: 'violates check constraint', code: '23514' }, status: 400 })
    const error = (await renamePlayer(PLAYER, '\u200b\u2060').catch((e: unknown) => e)) as GameCallError
    expect([error.code, error.message]).toEqual(['bad_name', 'Names are 1 to 40 characters you can see'])
  })

  it('awardPoints takes whole numbers other than 0 only', async () => {
    await expect(awardPoints({ sessionId: SESSION, playerId: PLAYER, gameId: null, points: 0, reason: null })).rejects.toThrow()
    await expect(awardPoints({ sessionId: SESSION, playerId: PLAYER, gameId: null, points: 1.5, reason: null })).rejects.toThrow()
    expect(db.state.calls).toHaveLength(0)
    await awardPoints({ sessionId: SESSION, playerId: PLAYER, gameId: null, points: 3, reason: '  Best costume ' })
    expect(op(db.state.calls[0], 'insert')).toEqual([
      { session_id: SESSION, player_id: PLAYER, game_id: null, points: 3, reason: 'Best costume' },
    ])
  })

  it('removePlayer deletes the player, then syncs every live game of the party', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    db.state.respond = (call) => (call.ops[0]?.[0] === 'select' ? ok([{ id: 'live-1' }, { id: 'live-2' }]) : ok(null))
    await removePlayer(SESSION, PLAYER)
    expect(db.state.calls[0].table).toBe('players')
    expect(op(db.state.calls[0], 'delete')).toEqual([])
    expect(op(db.state.calls[0], 'eq')).toEqual(['id', PLAYER])
    const live = db.state.calls[1]
    expect(live.table).toBe('session_games')
    expect(live.ops.filter(([n]) => n === 'eq')).toEqual([
      ['eq', ['session_id', SESSION]],
      ['eq', ['status', 'active']],
    ])
    expect(op(live, 'is')).toEqual(['archived_at', null])
    const synced = fetch.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string))
    expect(synced.map((b) => [b.type, b.gameId])).toEqual([
      ['sync', 'live-1'],
      ['sync', 'live-2'],
    ])
  })

  it('a failed sync after a removal is not an error: the removal stands', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"Game not found","code":"not_found"}', { status: 404 })))
    db.state.respond = (call) => (call.ops[0]?.[0] === 'select' ? ok([{ id: 'live-1' }]) : ok(null))
    await expect(removePlayer(SESSION, PLAYER)).resolves.toBeUndefined()
  })

  it('issuePlayerTransfer gives the code and when it expires, 5 minutes from the call', async () => {
    vi.useFakeTimers({ now: 1_795_900_000_000 })
    db.state.respondRpc = () => ok('K7Q2MX')
    await expect(issuePlayerTransfer(PLAYER)).resolves.toEqual({ code: 'K7Q2MX', expiresAt: 1_795_900_000_000 + 5 * 60_000 })
    expect(db.state.rpcs).toEqual([{ name: 'host_issue_transfer', args: { p_player_id: PLAYER } }])
  })

  it('revokePlayerTransfer cancels the code by its text', async () => {
    db.state.respondRpc = () => ok(null)
    await expect(revokePlayerTransfer(' k7q2mx ')).resolves.toBeUndefined()
    expect(db.state.rpcs).toEqual([{ name: 'host_revoke_transfer', args: { p_code: 'K7Q2MX' } }])
  })
})
