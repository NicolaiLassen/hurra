// The host page's side of Lydspor's AI check (aiCheck): after the lock it
// asks the server (POST /api/lydspor-ai) once, which asks the AI and puts its
// verdicts into the game; the host page shows how it went, and a retry when
// the AI couldn't help. The typed answers never pass through here.
import type { SoundtrackPhase, SoundtrackState } from '../types'

export type AiReply =
  | { ran: true; asked: number; accepted: number; already?: boolean }
  | { ran: false; reason: string; message: string }

/** What the host page shows about the AI check. */
export type AiStatus =
  | { kind: 'off' }
  /** Waiting for the lock. */
  | { kind: 'waiting' }
  | { kind: 'running' }
  | { kind: 'failed'; message: string }
  | { kind: 'done'; asked: number; accepted: number }

/** The phases after the lock in which the check runs. */
const AFTER_LOCK: readonly SoundtrackPhase[] = ['locked', 'reveal', 'standings']

/** Whether the host page should ask for the check now: on, locked, not done yet. */
export function aiDue(on: boolean, state: Pick<SoundtrackState, 'phase' | 'review' | 'ai'> | null | undefined): boolean {
  return on && !!state && AFTER_LOCK.includes(state.phase) && Array.isArray(state.review) && !state.ai
}

/** The AI check's status from the state and this page's own request. */
export function aiStatus(
  on: boolean,
  state: Pick<SoundtrackState, 'phase' | 'review' | 'ai'> | null | undefined,
  request: { kind: 'idle' } | { kind: 'running' } | { kind: 'failed'; message: string },
): AiStatus {
  if (!on || !state) return { kind: 'off' }
  if (state.ai) return { kind: 'done', asked: state.ai.asked, accepted: state.ai.accepted }
  if (state.phase === 'done') return { kind: 'off' }
  if (!AFTER_LOCK.includes(state.phase)) return { kind: 'waiting' }
  if (request.kind === 'failed') return request
  return { kind: 'running' }
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)

/** The status in the host's words. */
export function aiLine(status: AiStatus): string | null {
  switch (status.kind) {
    case 'off':
    case 'waiting':
      return null
    case 'running':
      return 'The AI is checking the typed answers the rule didn’t count…'
    case 'failed':
      return `The AI check didn’t run: ${lowerFirst(status.message.replace(/\.$/, ''))}. The rule’s verdicts stand, and you can accept answers yourself.`
    case 'done':
      if (status.asked === 0) return 'The AI check had nothing to look at: the rule counted every typed answer.'
      return `The AI accepted ${status.accepted} of ${status.asked} typed ${status.asked === 1 ? 'answer' : 'answers'} the rule didn’t count. Undo any in the review.`
  }
}

/** Asks the server for the check. Resolves with its reply; a refusal or no connection is a failed reply, never a throw. */
export async function requestAiCheck(gameId: string, options: { fetch?: typeof fetch; token?: string | null } = {}): Promise<AiReply> {
  try {
    let token = options.token
    if (token === undefined) {
      // Loaded here, so a test of the host page never needs the app's env.
      const { supabase } = await import('@/lib/supabase')
      token = (await supabase.auth.getSession()).data.session?.access_token ?? null
    }
    const send = options.fetch ?? ((input, init) => fetch(input, init))
    const response = await send('/api/lydspor-ai', {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ gameId }),
    })
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
    if (response.ok && body?.ran === true) {
      return { ran: true, asked: Number(body.asked) || 0, accepted: Number(body.accepted) || 0, already: body.already === true }
    }
    if (response.ok && body?.ran === false && typeof body.message === 'string') {
      return { ran: false, reason: String(body.reason ?? 'failed'), message: body.message }
    }
    const message = typeof body?.error === 'string' ? body.error : `the server answered ${response.status}`
    return { ran: false, reason: 'failed', message }
  } catch {
    return { ran: false, reason: 'failed', message: 'no answer from the server' }
  }
}
