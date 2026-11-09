import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGameApi, GameCallError, newRequestId, OFFLINE_MESSAGE } from './gameApi'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const GAME = '6f9c2a52-3c4b-4f43-9a52-1c8e7d6b5a40'

type RpcResult = { data: unknown; error: { message: string; details?: string; code?: string } | null; status: number }

/** A client with a session and an rpc whose answers the test queues (a function may hang until aborted). */
function fakeClient(rpcAnswers: (RpcResult | ((signal: AbortSignal) => Promise<RpcResult>))[] = []) {
  const rpc = vi.fn<(name: string, args: Record<string, unknown>) => { abortSignal(signal: AbortSignal): Promise<RpcResult> }>(() => ({
    abortSignal(signal: AbortSignal) {
      const next = rpcAnswers.shift()
      if (!next) throw new Error('No rpc answer queued')
      return typeof next === 'function' ? next(signal) : Promise.resolve(next)
    },
  }))
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: 'token-1' } } }) }, rpc }
  return { client: client as unknown as SupabaseClient, rpc }
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('newRequestId', () => {
  it('makes v4 UUIDs, also without crypto.randomUUID (plain-http LAN, old iOS)', () => {
    expect(newRequestId()).toMatch(UUID_V4)
    const real = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array<ArrayBuffer>) => real.getRandomValues(bytes) })
    try {
      const ids = new Set(Array.from({ length: 50 }, () => newRequestId()))
      expect(ids.size).toBe(50)
      for (const id of ids) expect(id).toMatch(UUID_V4)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('callGame', () => {
  it('posts to the injected endpoint with the session token and the request', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(200, { view: { status: 'alive' } }))
    const api = createGameApi(fakeClient().client, { endpoint: 'http://localhost:9999/api/game', fetch })
    await expect(api.callGame({ type: 'action', gameId: GAME, action: { type: 'tag', target: 'x' } })).resolves.toEqual({
      view: { status: 'alive' },
    })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('http://localhost:9999/api/game')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token-1')
    expect(bodyOf(fetch.mock.calls[0])).toMatchObject({ type: 'action', gameId: GAME, action: { type: 'tag', target: 'x' } })
  })

  it('makes one request id per call and reuses it only for that call’s retries', async () => {
    const answers = [() => Promise.reject(new TypeError('fetch failed')), () => Promise.resolve(json(503, {})), () => Promise.resolve(json(200, {}))]
    const fetch = vi.fn(async () => answers.shift()!())
    const api = createGameApi(fakeClient().client, { fetch })
    const first = api.callGame({ type: 'sync', gameId: GAME })
    await vi.runAllTimersAsync()
    await expect(first).resolves.toEqual({})
    expect(fetch).toHaveBeenCalledTimes(3)
    const ids = fetch.mock.calls.map((call) => bodyOf(call).requestId)
    expect(new Set(ids).size).toBe(1)
    expect(ids[0]).toMatch(UUID_V4)

    fetch.mockImplementation(async () => json(200, { replayed: true }))
    await expect(api.callGame({ type: 'sync', gameId: GAME })).resolves.toEqual({ replayed: true })
    expect(bodyOf(fetch.mock.calls[3]).requestId).not.toBe(ids[0])
  })

  it('retries after 0.5 s and 1.5 s more', async () => {
    const fetch = vi.fn(async () => json(502, {}))
    const api = createGameApi(fakeClient().client, { fetch })
    const call = api.callGame({ type: 'end', gameId: GAME }).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(499)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1499)
    expect(fetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetch).toHaveBeenCalledTimes(3)
    const error = (await call) as GameCallError
    expect(error).toBeInstanceOf(GameCallError)
    expect(error.status).toBe(502)
  })

  it('never retries a 4xx (an answer) or a 500 (a bug), and keeps the server’s words', async () => {
    for (const [status, body] of [
      [409, { error: 'Bo is already out', code: 'rule' }],
      [400, { error: 'Bo is already out', code: 'rule' }],
      [403, { error: 'Only hosts can do that', code: 'not_host' }],
      [500, { error: 'Something went wrong', code: 'internal' }],
    ] as const) {
      const fetch = vi.fn(async () => json(status, body))
      const api = createGameApi(fakeClient().client, { fetch })
      const error = (await api.callGame({ type: 'start', gameId: GAME }).catch((e: unknown) => e)) as GameCallError
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(error).toBeInstanceOf(GameCallError)
      expect([error.status, error.message, error.code]).toEqual([status, body.error, body.code])
    }
  })

  it('says it could not reach the game when no attempt got an answer (status 0)', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Load failed')
    })
    const api = createGameApi(fakeClient().client, { fetch })
    const call = api.callGame({ type: 'action', gameId: GAME, action: {} }).catch((e: unknown) => e)
    await vi.runAllTimersAsync()
    const error = (await call) as GameCallError
    expect(fetch).toHaveBeenCalledTimes(3)
    expect([error.status, error.message]).toEqual([0, OFFLINE_MESSAGE])
  })

  it('gives up an attempt after 8 s and retries it with the same id', async () => {
    let attempts = 0
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      attempts++
      if (attempts === 2) return Promise.resolve(json(200, { skipped: true }))
      // The first attempt never answers until it is aborted.
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    })
    const api = createGameApi(fakeClient().client, { fetch })
    const call = api.callGame({ type: 'sync', gameId: GAME })
    await vi.advanceTimersByTimeAsync(7999)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1 + 500)
    await expect(call).resolves.toEqual({ skipped: true })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(bodyOf(fetch.mock.calls[0]).requestId).toBe(bodyOf(fetch.mock.calls[1]).requestId)
  })
})

describe('submitAnswer', () => {
  const answer = { choice: ['2'] }

  it('calls submit_answer with a request id, retrying a lost reply with the same id', async () => {
    const { client, rpc } = fakeClient([
      { data: null, error: { message: 'TypeError: fetch failed' }, status: 0 },
      { data: { accepted: true, replayed: true, answer, at: 1, ms: 900 }, error: null, status: 200 },
    ])
    const api = createGameApi(client)
    const call = api.submitAnswer(GAME, 'q3', answer)
    await vi.runAllTimersAsync()
    await expect(call).resolves.toEqual({ accepted: true, replayed: true, answer, at: 1, ms: 900 })
    expect(rpc).toHaveBeenCalledTimes(2)
    const [name, args] = rpc.mock.calls[0]
    expect(name).toBe('submit_answer')
    expect(args).toMatchObject({ p_game_id: GAME, p_key: 'q3', p_payload: answer })
    expect(args.p_request_id).toMatch(UUID_V4)
    expect(rpc.mock.calls[1][1].p_request_id).toBe(args.p_request_id)
  })

  it('passes a refusal on at once, with the database’s words and DETAIL code', async () => {
    const { client, rpc } = fakeClient([
      { data: null, error: { message: 'Too late, answers are closed', details: 'closed', code: 'PT409' }, status: 409 },
    ])
    const error = (await createGameApi(client).submitAnswer(GAME, 'q3', answer).catch((e: unknown) => e)) as GameCallError
    expect(rpc).toHaveBeenCalledTimes(1)
    expect([error.status, error.message, error.code]).toEqual([409, 'Too late, answers are closed', 'closed'])
  })

  it('times out a hanging answer after 8 s and retries it', async () => {
    const { client, rpc } = fakeClient([
      (signal) =>
        new Promise((resolve) =>
          signal.addEventListener('abort', () => resolve({ data: null, error: { message: 'AbortError: aborted' }, status: 0 })),
        ),
      { data: { accepted: true, answer, at: 1, ms: 400 }, error: null, status: 200 },
    ])
    const call = createGameApi(client).submitAnswer(GAME, 'q1', answer)
    await vi.advanceTimersByTimeAsync(8000 + 500)
    await expect(call).resolves.toMatchObject({ accepted: true })
    expect(rpc).toHaveBeenCalledTimes(2)
  })
})
