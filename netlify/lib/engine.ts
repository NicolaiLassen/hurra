// The game engine (docs/engine-v2.md, section 4). It knows nothing about
// specific games: the decisions are the pure step() in src/games/core/runtime.ts,
// and this file only does the I/O around it, two database round trips per
// request: game_load, then game_commit. Runs with the secret key, so it never
// trusts the client: step() checks who may do what.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnyGame } from '../../src/games/core/Game'
import { step, type EngineRequest, type ErrorCode, type Loaded } from '../../src/games/core/runtime'
import { gameLogic } from '../../src/games/logic'

export class HttpError extends Error {
  status: number
  code: ErrorCode

  constructor(status: number, code: ErrorCode, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

export type GameResponse = { view?: unknown; replayed?: true; skipped?: true }

/** Durations in ms for the Server-Timing header (the rehearsal records them). */
export type Timing = { load: number; step: number; commit: number; attempts: number }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TYPES = ['start', 'end', 'action', 'host-action', 'sync'] as const
/** A move's JSON beyond this is refused before it reaches the log. */
const MAX_ACTION_BYTES = 16_384
const MAX_CLOSE = 50

/** At most this many attempts within BUDGET_MS when saves race (a stale version, or a deadlock). */
const MAX_ATTEMPTS = 6
const BUDGET_MS = 4000

export function parseGameRequest(input: unknown): EngineRequest {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'bad_request', 'The request body must be a JSON object')
  }
  const body = input as Record<string, unknown>
  if (!TYPES.includes(body.type as (typeof TYPES)[number])) {
    throw new HttpError(400, 'bad_request', 'type must be "start", "end", "action", "host-action" or "sync"')
  }
  if (body.gameId === undefined || body.gameId === null || body.gameId === '') {
    throw new HttpError(400, 'bad_request', 'gameId is required')
  }
  if (typeof body.gameId !== 'string' || !UUID.test(body.gameId)) throw new HttpError(400, 'bad_request', 'gameId must be a UUID')
  if (body.requestId !== undefined && (typeof body.requestId !== 'string' || !UUID.test(body.requestId))) {
    throw new HttpError(400, 'bad_request', 'requestId must be a UUID')
  }
  const gameId = body.gameId.toLowerCase()
  // Every app call sends one; a request without (a test, a script) gets one made here,
  // which still protects this request's own retries.
  const requestId = ((body.requestId as string | undefined) ?? crypto.randomUUID()).toLowerCase()

  switch (body.type as (typeof TYPES)[number]) {
    case 'start':
      if (body.stage !== undefined && typeof body.stage !== 'boolean') {
        throw new HttpError(400, 'bad_request', 'stage must be true or false')
      }
      return { type: 'start', gameId, requestId, ...(typeof body.stage === 'boolean' ? { stage: body.stage } : {}) }
    case 'end':
      return { type: 'end', gameId, requestId }
    case 'sync':
      return { type: 'sync', gameId, requestId }
    case 'action':
      return { type: 'action', gameId, requestId, action: checkedAction(body.action) }
    case 'host-action': {
      if (body.close !== undefined && !(Array.isArray(body.close) && body.close.every((k) => typeof k === 'string'))) {
        throw new HttpError(400, 'bad_request', 'close must be a list of prompt keys')
      }
      const close = (body.close as string[] | undefined) ?? []
      if (close.length > MAX_CLOSE) throw new HttpError(400, 'bad_request', `close holds at most ${MAX_CLOSE} prompt keys`)
      return { type: 'host-action', gameId, requestId, action: checkedAction(body.action), close }
    }
  }
}

function checkedAction(action: unknown): unknown {
  const json = JSON.stringify(action ?? null)
  if (json.length > MAX_ACTION_BYTES) throw new HttpError(400, 'bad_request', 'That action is too big')
  return action ?? null
}

/**
 * Runs one request for the signed-in user: game_load, step(), game_commit,
 * with retries when another save of the same game landed first. Resolves with
 * what the caller's screen needs; throws HttpError for refusals.
 */
export async function handleGameRequest(
  db: SupabaseClient,
  userId: string,
  request: EngineRequest,
  options: {
    random?: () => number
    now?: number
    /** Tests only (the conformance test's probe game). Default: the registry in src/games/logic.ts. */
    logicFor?: (gameType: string) => AnyGame | undefined
    /** Filled in with this request's durations, for the Server-Timing header. */
    timing?: Timing
  } = {},
): Promise<GameResponse> {
  const random = options.random ?? Math.random
  const logicFor = options.logicFor ?? ((type: string) => gameLogic.get(type))
  const timing = options.timing ?? { load: 0, step: 0, commit: 0, attempts: 0 }
  const started = Date.now()
  let firstNow: number | undefined
  let firstRound: number | null = null

  for (let attempt = 1; ; attempt++) {
    timing.attempts = attempt
    let t = performance.now()
    const loaded = await rpc<Loaded | null>(db, 'game_load', {
      p_game_id: request.gameId,
      p_user_id: userId,
      p_close: request.type === 'host-action' ? (request.close ?? []) : [],
      p_request_id: request.requestId,
    })
    timing.load += performance.now() - t
    if (!loaded) throw new HttpError(404, 'not_found', 'Game not found')
    // A resent copy of a tap that was saved: never run the game again, which
    // would refuse it ("Bo is already out").
    if (loaded.claimed) return { replayed: true }

    const logic = logicFor(loaded.game.game_type)
    if (!logic) {
      throw new HttpError(409, 'unknown_game_type', `This app doesn't know the game type ${loaded.game.game_type}`)
    }
    // The first attempt's clock and round, kept for every retry.
    firstNow ??= options.now ?? loaded.now
    if (attempt === 1 && request.type !== 'start') firstRound = loaded.current?.round ?? null

    t = performance.now()
    const result = step(logic, loaded, request, {
      userId,
      now: firstNow,
      random,
      round: attempt === 1 ? null : firstRound,
    })
    timing.step += performance.now() - t
    if (result.kind === 'refuse') throw new HttpError(result.status, result.code, result.message)
    if (result.kind === 'skip') return { skipped: true, ...(result.view !== undefined ? { view: result.view } : {}) }

    t = performance.now()
    try {
      const saved = await rpc<{ replayed: boolean }>(db, 'game_commit', { p: result.commit })
      timing.commit += performance.now() - t
      // A copy that raced its original: the original's ping updates the screen.
      if (saved.replayed) return { replayed: true }
      return result.view !== undefined ? { view: result.view } : {}
    } catch (error) {
      timing.commit += performance.now() - t
      if (!lostRace(error as RpcError)) throw error
      if (attempt >= MAX_ATTEMPTS || Date.now() - started > BUDGET_MS) {
        throw new HttpError(409, 'busy', 'The game is busy. Try again.')
      }
      // Another save of this game landed first: load and step again.
      await sleep(10 + random() * Math.min(160, 20 * 2 ** attempt))
    }
  }
}

/**
 * Another save of this game landed first. game_commit raises PT409 'stale'
 * for a version conflict (never 40001, which PostgREST would retry forever);
 * Postgres raises 40P01 for a deadlock, e.g. two games updating the same
 * players' profiles at once. A 40001 that ever reaches the engine counts as a
 * lost race too, so it is retried like one.
 */
export function lostRace(error: RpcError): boolean {
  return (error.code === 'PT409' && error.details === 'stale') || error.code === '40P01' || error.code === '40001'
}

/** An error from PostgREST, or from the network on the way there. */
export type RpcError = Error & { code?: string; details?: string; status?: number }

/** One RPC with the service client. PostgREST RPCs are POSTs, which postgrest-js never retries. */
async function rpc<T>(db: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error, status } = await db.rpc(name, args)
  if (error) {
    throw Object.assign(new Error(error.message), {
      code: error.code,
      details: error.details,
      status,
    }) as RpcError
  }
  return data as T
}

const CODES: readonly string[] = [
  'bad_request', 'rule', 'not_signed_in', 'not_host', 'not_player', 'not_found', 'already_running',
  'not_running', 'archived', 'restarted', 'busy', 'unknown_game_type', 'unavailable', 'internal',
]

/** The error mapping of section 4.4: what the phone gets for any failure. */
export function errorResponse(error: unknown): { status: number; body: { error: string; code: string } } {
  if (error instanceof HttpError) return { status: error.status, body: { error: error.message, code: error.code } }
  const { code, details, message, status } = (error ?? {}) as RpcError
  if (lostRace((error ?? {}) as RpcError)) return { status: 409, body: { error: 'The game is busy. Try again.', code: 'busy' } }
  // game_commit's own refusals: PT409 "This game is not running" with the code in DETAIL.
  const custom = /^PT(\d{3})$/.exec(code ?? '')
  if (custom) {
    const httpStatus = Number(custom[1])
    const errorCode = details && CODES.includes(details) ? details : defaultCode(httpStatus)
    return { status: httpStatus, body: { error: message, code: errorCode } }
  }
  // The database couldn't be reached: no answer at all, or a gateway in between gave up.
  if (status === 0 || status === 502 || status === 503 || status === 504 || /fetch failed|ECONNREFUSED|network/i.test(message ?? '')) {
    return { status: 503, body: { error: "The party database didn't answer. Try again.", code: 'unavailable' } }
  }
  return { status: 500, body: { error: 'Something went wrong', code: 'internal' } }
}

function defaultCode(status: number): ErrorCode {
  if (status === 400) return 'bad_request'
  if (status === 401) return 'not_signed_in'
  if (status === 403) return 'not_host'
  if (status === 404) return 'not_found'
  if (status === 409) return 'not_running'
  return 'internal'
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
