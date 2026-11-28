// Lydspor's AI check, server side (src/games/soundtrack/ai.ts has the pure
// parts): for a host, after the lock, ask an AI through OpenRouter about every
// typed answer the rule didn't count, in one batched call, and send its yeses
// back through the engine as the host action `ai`, so the game applies them
// deterministically and they show in the host's review. Any failure (no key,
// no answer, a timeout, an answer of the wrong shape) changes nothing: the
// game works as without the AI, and the host page offers a retry.
//
// Typed answers are secrets: they go to OpenRouter and to nobody else, and
// are never logged here.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Loaded } from '../../src/games/core/runtime'
import { AI_MODEL, aiAction, aiQuestions, buildAiPrompt, parseAiVerdicts, type AiMessages } from '../../src/games/soundtrack/ai'
import type { SoundtrackConfig, SoundtrackState } from '../../src/games/soundtrack/types'
import { handleGameRequest, HttpError } from './engine'

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
/** Under Netlify's 10 s limit for a function, so a slow model ends as a clean "didn't run" with Try again, never a cut-off request. */
export const AI_TIMEOUT_MS = 8_500

export type AiCheckResult =
  /** The verdicts are in the game: `asked` answers, `accepted` of them yes. `already` when an earlier check had put them there. */
  | { ran: true; asked: number; accepted: number; already?: true }
  /** Nothing changed: the game works as without the AI. */
  | { ran: false; reason: 'no_key' | 'failed' | 'timeout' | 'junk'; message: string }

type Options = {
  /** OPENROUTER_API_KEY, server side only. */
  apiKey?: string
  /** Tests stub it: no network in tests. */
  fetch?: typeof fetch
  timeoutMs?: number
}

class AiCallError extends Error {
  reason: 'failed' | 'timeout' | 'junk'
  constructor(reason: 'failed' | 'timeout' | 'junk', message: string) {
    super(message)
    this.reason = reason
  }
}

/** One chat completion: the reply's text. Throws AiCallError on a failure, a timeout or a reply without text. */
export async function askAi(messages: AiMessages, apiKey: string, options: Pick<Options, 'fetch' | 'timeoutMs'> = {}): Promise<string> {
  const send = options.fetch ?? ((input, init) => fetch(input, init))
  let response: Response
  try {
    response = await send(OPENROUTER_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(options.timeoutMs ?? AI_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Hurra' },
      body: JSON.stringify({
        model: AI_MODEL,
        temperature: 0,
        max_tokens: 8000,
        messages: [
          { role: 'system', content: messages.system },
          { role: 'user', content: messages.user },
        ],
      }),
    })
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') throw new AiCallError('timeout', "The AI didn't answer in time")
    throw new AiCallError('failed', "Couldn't reach the AI")
  }
  if (!response.ok) throw new AiCallError('failed', `The AI refused (${response.status})`)
  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') throw new AiCallError('timeout', "The AI didn't answer in time")
    throw new AiCallError('junk', "The AI's answer wasn't readable")
  }
  const content = (body as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new AiCallError('junk', "The AI's answer wasn't readable")
  return content
}

/**
 * The AI check of one Lydspor game for a signed-in user, who must be a host.
 * Throws HttpError for a refusal (not a host, not Lydspor, not locked, the
 * check off); resolves with what happened otherwise.
 */
export async function runAiCheck(db: SupabaseClient, userId: string, gameId: string, options: Options = {}): Promise<AiCheckResult> {
  const { data, error } = await db.rpc('game_load', { p_game_id: gameId, p_user_id: userId })
  if (error) throw Object.assign(new Error(error.message), { code: error.code, details: error.details })
  const loaded = data as Loaded | null
  if (!loaded) throw new HttpError(404, 'not_found', 'Game not found')
  if (!loaded.caller.is_host) throw new HttpError(403, 'not_host', 'Only hosts can do that')
  if (loaded.game.game_type !== 'soundtrack') throw new HttpError(400, 'bad_request', 'The AI check is for Lydspor')
  if (loaded.game.status !== 'active' || !loaded.current) throw new HttpError(409, 'not_running', "Lydspor isn't running")
  const config = loaded.current.config as SoundtrackConfig
  const state = loaded.current.state as SoundtrackState
  if (config?.aiCheck !== true) throw new HttpError(409, 'rule', 'The AI check is off for this game')
  if (!state || !state.review || !['locked', 'reveal', 'standings'].includes(state.phase)) {
    throw new HttpError(409, 'rule', 'Lock the answers first')
  }
  if (state.ai) return { ran: true, asked: state.ai.asked, accepted: state.ai.accepted, already: true }

  const questions = aiQuestions(state)
  let verdicts = new Map<string, boolean>()
  if (questions.length > 0) {
    if (!options.apiKey) return { ran: false, reason: 'no_key', message: 'The AI check has no key on the server' }
    try {
      const content = await askAi(buildAiPrompt(questions, config), options.apiKey, options)
      const parsed = parseAiVerdicts(content, questions)
      if (!parsed) throw new AiCallError('junk', "The AI's answer wasn't in the right shape")
      verdicts = parsed
    } catch (failure) {
      if (!(failure instanceof AiCallError)) throw failure
      // The reason only: never the answers.
      console.error(`Lydspor AI check for game ${gameId}: ${failure.reason}: ${failure.message}`)
      return { ran: false, reason: failure.reason, message: failure.message }
    }
  }
  const action = aiAction(questions, verdicts)
  const result = await handleGameRequest(db, userId, { type: 'host-action', gameId, requestId: crypto.randomUUID(), action, close: [] })
  return { ran: true, asked: questions.length, accepted: action.yes.length, ...(result.skipped ? { already: true as const } : {}) }
}
