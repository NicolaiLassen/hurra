// The calls that change a game (docs/engine-v2.md, 5.3): moves, host actions,
// start, end and timer syncs go to the game engine (/api/game); answers and
// votes go straight to the database (submit_answer), never through the engine.
//
// Every call makes one new request id, so a genuine new tap is never taken for
// a copy of an earlier one. The id is reused only for that call's own automatic
// retries (no answer, a timeout, a gateway error), which the server then saves
// once: the claim in event_log is unique on (user, request id).
//
// Relative imports and npm packages only, and no DOM, Vite or import.meta: the
// rehearsal's bots run this file under Node, each with its own client (5.1).
// The app's own calls, bound to its shared client, are in queries.ts.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnswerPayload, SubmitResult } from './types'

export type EngineRequest =
  | { type: 'start'; gameId: string; stage?: boolean }
  | { type: 'end'; gameId: string }
  | { type: 'action'; gameId: string; action: unknown }
  | { type: 'host-action'; gameId: string; action: unknown; close?: string[] }
  | { type: 'sync'; gameId: string }

export type EngineResponse = { view?: unknown; replayed?: true; skipped?: true }

/** A refusal or a failure, with the server's own words. */
export class GameCallError extends Error {
  /** The HTTP status; 0 when the server never answered. */
  status: number
  /** The engine's ErrorCode ('rule', 'busy', ...), or the database's DETAIL code ('closed', 'name_taken', ...). */
  code: string

  constructor(message: string, status: number, code: string) {
    super(message)
    this.name = 'GameCallError'
    this.status = status
    this.code = code
  }
}

export const OFFLINE_MESSAGE = "Couldn't reach the game. Check your connection and try again."

/** Waits before the second and the third attempt. */
const RETRY_DELAYS_MS = [500, 1500]
/** An attempt with no answer by then is given up and retried with the same id. */
const ATTEMPT_TIMEOUT_MS = 8000
/** Gateways that gave up: the request may or may not have run, so a retry with the same id is safe. */
const RETRY_STATUSES = new Set([502, 503, 504])

/**
 * A new request id: a v4 UUID. crypto.randomUUID needs a secure context, so the
 * plain-http LAN dev URL (and iOS before 15.4) builds one from getRandomValues.
 */
export function newRequestId(): string {
  // Typed by hand: the rehearsal type-checks this file with Node's libs, which have no DOM `Crypto`.
  const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string; getRandomValues?: (bytes: Uint8Array<ArrayBuffer>) => unknown } })
    .crypto
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID()
  const bytes = new Uint8Array(16)
  if (typeof webCrypto?.getRandomValues === 'function') webCrypto.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export type GameApi = {
  callGame(request: EngineRequest): Promise<EngineResponse>
  submitAnswer(gameId: string, key: string, answer: AnswerPayload): Promise<SubmitResult>
}

/** An attempt that may be tried again with the same request id. */
class Retryable extends Error {
  failure: GameCallError

  constructor(failure: GameCallError) {
    super(failure.message)
    this.failure = failure
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Runs `attempt` up to three times (now, after 0.5 s, after 1.5 s more) while
 * it throws Retryable, each with an 8 s timeout. An AbortController with
 * setTimeout, not AbortSignal.timeout, which needs iOS 16.
 */
async function withRetries<T>(attempt: (signal: AbortSignal) => Promise<T>): Promise<T> {
  let last: GameCallError | undefined
  for (let i = 0; i <= RETRY_DELAYS_MS.length; i++) {
    if (i > 0) await sleep(RETRY_DELAYS_MS[i - 1])
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS)
    try {
      return await attempt(controller.signal)
    } catch (error) {
      if (!(error instanceof Retryable)) throw error
      last = error.failure
    } finally {
      clearTimeout(timer)
    }
  }
  throw last ?? new GameCallError(OFFLINE_MESSAGE, 0, 'unavailable')
}

/** The engine's words when its body is JSON; ours when a gateway answered instead. */
function fallbackMessage(status: number): string {
  if (status >= 500) return "The game server didn't answer. Try again."
  return `The game refused that (${status})`
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json()
    return body !== null && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * The calls for one signed-in client. The app makes one for its shared client
 * (queries.ts); each rehearsal bot makes its own with an absolute endpoint.
 */
export function createGameApi(
  client: SupabaseClient,
  options: { endpoint?: string; fetch?: typeof fetch } = {},
): GameApi {
  const endpoint = options.endpoint ?? '/api/game'
  // Called as a plain function: window.fetch throws "Illegal invocation" when called as a method of another object.
  const send: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init))

  async function callGame(request: EngineRequest): Promise<EngineResponse> {
    const requestId = newRequestId()
    const body = JSON.stringify({ ...request, requestId })
    return withRetries(async (signal) => {
      // Read per attempt: a retry after a token refresh carries the new token.
      const { data } = await client.auth.getSession()
      const token = data.session?.access_token
      let response: Response
      try {
        response = await send(endpoint, {
          method: 'POST',
          signal,
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body,
        })
      } catch {
        // No answer at all, or the 8 s timeout.
        throw new Retryable(new GameCallError(OFFLINE_MESSAGE, 0, 'unavailable'))
      }
      const answer = await readJson(response)
      if (response.ok) {
        const result: EngineResponse = {}
        if ('view' in answer) result.view = answer.view
        if (answer.replayed === true) result.replayed = true
        if (answer.skipped === true) result.skipped = true
        return result
      }
      const failure = new GameCallError(
        typeof answer.error === 'string' && answer.error !== '' ? answer.error : fallbackMessage(response.status),
        response.status,
        typeof answer.code === 'string' ? answer.code : response.status >= 500 ? 'unavailable' : '',
      )
      // A 4xx is an answer (a rule, a busy game) and a 500 is a bug: neither is retried.
      if (RETRY_STATUSES.has(response.status)) throw new Retryable(failure)
      throw failure
    })
  }

  async function submitAnswer(gameId: string, key: string, answer: AnswerPayload): Promise<SubmitResult> {
    const requestId = newRequestId()
    return withRetries(async (signal) => {
      const { data, error, status } = await client
        .rpc('submit_answer', { p_game_id: gameId, p_key: key, p_payload: answer, p_request_id: requestId })
        .abortSignal(signal)
      if (!error) return data as SubmitResult
      // postgrest-js answers status 0 when the request never got a reply (or was aborted).
      if (status === 0) throw new Retryable(new GameCallError(OFFLINE_MESSAGE, 0, 'unavailable'))
      const failure = new GameCallError(
        error.message || fallbackMessage(status),
        status,
        error.details || error.code || (status >= 500 ? 'unavailable' : ''),
      )
      if (RETRY_STATUSES.has(status)) throw new Retryable(failure)
      throw failure
    })
  }

  return { callGame, submitAnswer }
}
