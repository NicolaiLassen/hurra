// The engine's I/O around step(), with a fake database: request parsing,
// retries, the replay and skip paths and the error mapping. The real database
// is in engine.integration.test.ts.
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { ProbeGame } from '../../src/games/core/probe'
import type { CommitPayload, Loaded } from '../../src/games/core/runtime'
import { errorResponse, handleGameRequest, HttpError, parseGameRequest } from './engine'

const GAME = '11111111-1111-4111-8111-111111111111'
const REQUEST = '22222222-2222-4222-8222-222222222222'
const probe = new ProbeGame()
const logicFor = (type: string) => (type === 'probe' ? probe : undefined)

function loaded(overrides: Partial<Loaded> = {}): Loaded {
  return {
    now: 1_000_000,
    claimed: false,
    game: { id: GAME, session_id: 's', game_type: 'probe', title: 'Probe', status: 'active', archived_at: null, wake_at: null },
    settings: {},
    current: {
      state: { step: 0, moves: [], joined: [], left: [], question: null, results: [], ended: null },
      version: 3,
      round: 1,
      config: { movesToWin: 5, seconds: 10 },
      members: ['ana'],
    },
    session: { id: 's', name: 'Party', data: {}, spotlight_game_id: null },
    players: [{ id: 'ana', name: 'Ana', profile: {}, joined_at: 1 }],
    guests: [{ id: 'ana', name: 'Ana', joined: true }],
    caller: { player_id: 'ana', is_host: false, is_screen: false },
    scoreboard: {},
    awards: {},
    prompts: {},
    ...overrides,
  }
}

type Reply = { data?: unknown; error?: { message: string; code?: string; details?: string } | null; status?: number }

/** A client whose rpc() answers from the queues, recording every call. */
function fakeDb(replies: { game_load?: Reply[]; game_commit?: Reply[] }) {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const db = {
    rpc: async (name: 'game_load' | 'game_commit', args: Record<string, unknown>) => {
      calls.push({ name, args })
      const reply = replies[name]?.shift()
      if (!reply) throw new Error(`No reply queued for ${name}`)
      return { data: reply.data ?? null, error: reply.error ?? null, status: reply.status ?? (reply.error ? 400 : 200) }
    },
  }
  return { db: db as unknown as SupabaseClient, calls }
}

const move = { type: 'action' as const, gameId: GAME, requestId: REQUEST, action: { type: 'move' } }

describe('parseGameRequest', () => {
  it('accepts every request type and keeps the request id', () => {
    expect(parseGameRequest({ type: 'start', gameId: GAME, requestId: REQUEST, stage: false })).toEqual({
      type: 'start',
      gameId: GAME,
      requestId: REQUEST,
      stage: false,
    })
    expect(parseGameRequest({ type: 'host-action', gameId: GAME, requestId: REQUEST, action: { n: 1 }, close: ['q1'] })).toEqual({
      type: 'host-action',
      gameId: GAME,
      requestId: REQUEST,
      action: { n: 1 },
      close: ['q1'],
    })
    expect(parseGameRequest({ type: 'sync', gameId: GAME, requestId: REQUEST })).toEqual({ type: 'sync', gameId: GAME, requestId: REQUEST })
  })

  it('makes a request id when one is left out', () => {
    const request = parseGameRequest({ type: 'end', gameId: GAME })
    expect(request.requestId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('refuses malformed bodies with bad_request', () => {
    const refusals: [unknown, string][] = [
      [null, 'The request body must be a JSON object'],
      [{ type: 'dance', gameId: GAME }, 'type must be'],
      [{ type: 'end' }, 'gameId is required'],
      [{ type: 'end', gameId: 'game-1' }, 'gameId must be a UUID'],
      [{ type: 'end', gameId: GAME, requestId: 'tap-1' }, 'requestId must be a UUID'],
      [{ type: 'start', gameId: GAME, stage: 'yes' }, 'stage must be true or false'],
      [{ type: 'host-action', gameId: GAME, close: 'q1' }, 'close must be a list'],
      [{ type: 'host-action', gameId: GAME, close: Array.from({ length: 51 }, (_, i) => `q${i}`) }, 'at most 50'],
      [{ type: 'action', gameId: GAME, action: { blob: 'x'.repeat(20_000) } }, 'too big'],
    ]
    for (const [body, message] of refusals) {
      const error = (() => {
        try {
          parseGameRequest(body)
        } catch (e) {
          return e
        }
      })()
      expect(error, message).toBeInstanceOf(HttpError)
      expect((error as HttpError).message, message).toContain(message)
      expect((error as HttpError).code).toBe('bad_request')
    }
  })
})

describe('handleGameRequest', () => {
  it('answers a claimed copy as replayed without running the game', async () => {
    const { db, calls } = fakeDb({ game_load: [{ data: loaded({ claimed: true }) }] })
    expect(await handleGameRequest(db, 'user-ana', move, { logicFor })).toEqual({ replayed: true })
    expect(calls.map((c) => c.name)).toEqual(['game_load'])
    expect(calls[0].args).toEqual({ p_game_id: GAME, p_user_id: 'user-ana', p_close: [], p_request_id: REQUEST })
  })

  it("saves a move and returns the caller's view", async () => {
    const { db, calls } = fakeDb({ game_load: [{ data: loaded() }], game_commit: [{ data: { replayed: false, version: 4 } }] })
    expect(await handleGameRequest(db, 'user-ana', move, { logicFor })).toEqual({ view: { moves: 1, lastAnswer: null } })
    const commit = (calls[1].args as { p: CommitPayload }).p
    expect(commit).toMatchObject({ expected_version: 3, expected_round: 1, request: { id: REQUEST, user_id: 'user-ana' } })
  })

  it('answers a skip without saving', async () => {
    const sync = { type: 'sync' as const, gameId: GAME, requestId: REQUEST }
    const { db, calls } = fakeDb({ game_load: [{ data: loaded() }] })
    expect(await handleGameRequest(db, 'user-ana', sync, { logicFor })).toEqual({ skipped: true, view: { moves: 0, lastAnswer: null } })
    expect(calls).toHaveLength(1)
  })

  it('passes the close list for host actions', async () => {
    const reveal = { type: 'host-action' as const, gameId: GAME, requestId: REQUEST, action: { type: 'reveal', step: 0 }, close: ['q1'] }
    const { db, calls } = fakeDb({ game_load: [{ data: loaded({ caller: { player_id: null, is_host: true, is_screen: false } }) }] })
    expect(await handleGameRequest(db, 'host', reveal, { logicFor })).toEqual({ skipped: true })
    expect(calls[0].args.p_close).toEqual(['q1'])
  })

  it('retries a lost race with the first clock and round, and refuses a restart in between', async () => {
    const lost = { error: { message: 'Game state changed concurrently', code: 'PT409', details: 'stale' }, status: 409 }
    const { db, calls } = fakeDb({
      game_load: [{ data: loaded() }, { data: loaded({ now: 1_000_500, current: { ...loaded().current!, version: 4 } }) }],
      game_commit: [lost, { data: { replayed: false } }],
    })
    const random = vi.fn(() => 0)
    expect(await handleGameRequest(db, 'user-ana', move, { logicFor, random })).toEqual({ view: { moves: 1, lastAnswer: null } })
    const second = (calls[3].args as { p: CommitPayload }).p
    expect(second.expected_version).toBe(4)
    // The first attempt's clock is kept.
    expect((second.state as { moves: { at: number }[] }).moves[0].at).toBe(1_000_000)

    const restarted = fakeDb({
      game_load: [{ data: loaded() }, { data: loaded({ current: { ...loaded().current!, round: 2, version: 1 } }) }],
      game_commit: [lost],
    })
    await expect(handleGameRequest(restarted.db, 'user-ana', move, { logicFor, random })).rejects.toMatchObject({
      status: 409,
      code: 'restarted',
    })
  })

  it('gives up after six lost races', async () => {
    const lost = { error: { message: 'deadlock detected', code: '40P01' }, status: 500 }
    const { db } = fakeDb({ game_load: Array.from({ length: 6 }, () => ({ data: loaded() })), game_commit: Array.from({ length: 6 }, () => lost) })
    await expect(handleGameRequest(db, 'user-ana', move, { logicFor, random: () => 0 })).rejects.toMatchObject({
      status: 409,
      code: 'busy',
      message: 'The game is busy. Try again.',
    })
  })

  it("refuses a missing game and a type this bundle doesn't know", async () => {
    await expect(handleGameRequest(fakeDb({ game_load: [{ data: null }] }).db, 'u', move, { logicFor })).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    })
    const unknown = loaded({ game: { ...loaded().game, game_type: 'karaoke' } })
    await expect(handleGameRequest(fakeDb({ game_load: [{ data: unknown }] }).db, 'u', move, { logicFor })).rejects.toMatchObject({
      status: 409,
      code: 'unknown_game_type',
      message: "This app doesn't know the game type karaoke",
    })
  })
})

describe('errorResponse', () => {
  it('maps every failure to a status, a code and words for the phone', () => {
    expect(errorResponse(new HttpError(403, 'not_host', 'Only hosts can do that'))).toEqual({
      status: 403,
      body: { error: 'Only hosts can do that', code: 'not_host' },
    })
    const notRunning = Object.assign(new Error('This game is not running'), { code: 'PT409', details: 'not_running' })
    expect(errorResponse(notRunning)).toEqual({ status: 409, body: { error: 'This game is not running', code: 'not_running' } })
    const gone = Object.assign(new Error('Game not found'), { code: 'PT404', details: 'not_found' })
    expect(errorResponse(gone).status).toBe(404)
    expect(errorResponse(Object.assign(new Error('x'), { code: 'PT409', details: 'stale' }))).toMatchObject({ status: 409, body: { code: 'busy' } })
    expect(errorResponse(Object.assign(new Error('x'), { code: '40P01' }))).toMatchObject({ status: 409, body: { code: 'busy' } })
    expect(errorResponse(Object.assign(new Error('x'), { code: '40001' }))).toMatchObject({ status: 409, body: { code: 'busy' } })
    expect(errorResponse(Object.assign(new Error('TypeError: fetch failed'), { status: 0 }))).toEqual({
      status: 503,
      body: { error: "The party database didn't answer. Try again.", code: 'unavailable' },
    })
    expect(errorResponse(new Error('a bug'))).toEqual({ status: 500, body: { error: 'Something went wrong', code: 'internal' } })
  })
})
