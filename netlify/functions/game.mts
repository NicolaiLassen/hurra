// POST /api/game: the only way into the game engine (docs/engine-v2.md, 4.1).
// Body: { type: 'start' | 'end' | 'action' | 'host-action' | 'sync', gameId,
// requestId, ... }. Answers and votes never come here: phones send them
// straight to the database with submit_answer.
import { errorResponse, handleGameRequest, parseGameRequest, type Timing } from '../lib/engine'
import { serviceClient, verify } from '../lib/signIn'

export default async (req: Request): Promise<Response> => {
  const timing: Timing = { load: 0, step: 0, commit: 0, attempts: 0 }
  let auth = 0
  const respond = (body: unknown, status: number) =>
    Response.json(body, {
      status,
      headers: {
        'Server-Timing': [
          `auth;dur=${auth.toFixed(1)}`,
          `load;dur=${timing.load.toFixed(1)}`,
          `step;dur=${timing.step.toFixed(1)}`,
          `commit;dur=${timing.commit.toFixed(1)}`,
          `attempts;desc=${timing.attempts}`,
        ].join(', '),
      },
    })

  if (req.method !== 'POST') return respond({ error: 'Method not allowed' }, 405)

  const url = process.env.VITE_SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!url || !secretKey) {
    console.error('VITE_SUPABASE_URL and SUPABASE_SECRET_KEY must be set')
    return respond({ error: "The game server isn't configured", code: 'internal' }, 500)
  }
  const db = serviceClient(url, secretKey)

  const started = performance.now()
  const userId = await verify(db, req)
  auth = performance.now() - started
  if (userId === undefined) return respond({ error: "Couldn't check your sign-in. Try again.", code: 'unavailable' }, 503)
  if (userId === null) return respond({ error: 'Not signed in', code: 'not_signed_in' }, 401)

  let requestId: string | undefined
  try {
    const request = parseGameRequest(await req.json().catch(() => null))
    requestId = request.requestId
    return respond(await handleGameRequest(db, userId, request, { timing }), 200)
  } catch (error) {
    const { status, body } = errorResponse(error)
    if (status >= 500) console.error(`Game request ${requestId ?? '(unparsed)'} failed`, error)
    return respond(body, status)
  }
}

export const config = { path: '/api/game' }
