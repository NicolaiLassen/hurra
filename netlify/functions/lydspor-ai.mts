// POST /api/lydspor-ai: Lydspor's AI check (netlify/lib/lydsporAi.ts), for
// hosts only, after the lock. Body: { gameId }. Answers 200 with
// { ran: true, asked, accepted } once the verdicts are in the game, or
// { ran: false, reason, message } when the AI couldn't help (no key, a
// failure, a timeout, a reply of the wrong shape), which changes nothing.
// Reads OPENROUTER_API_KEY from the server's env; it never reaches a browser.
import { errorResponse } from '../lib/engine'
import { runAiCheck } from '../lib/lydsporAi'
import { serviceClient, verify } from '../lib/signIn'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 })

  const url = process.env.VITE_SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!url || !secretKey) {
    console.error('VITE_SUPABASE_URL and SUPABASE_SECRET_KEY must be set')
    return Response.json({ error: "The game server isn't configured", code: 'internal' }, { status: 500 })
  }
  const db = serviceClient(url, secretKey)
  const userId = await verify(db, req)
  if (userId === undefined) return Response.json({ error: "Couldn't check your sign-in. Try again.", code: 'unavailable' }, { status: 503 })
  if (userId === null) return Response.json({ error: 'Not signed in', code: 'not_signed_in' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { gameId?: unknown } | null
  const gameId = body?.gameId
  if (typeof gameId !== 'string' || !UUID.test(gameId)) {
    return Response.json({ error: 'gameId must be a UUID', code: 'bad_request' }, { status: 400 })
  }
  try {
    return Response.json(await runAiCheck(db, userId, gameId.toLowerCase(), { apiKey: process.env.OPENROUTER_API_KEY }))
  } catch (error) {
    const { status, body: failure } = errorResponse(error)
    if (status >= 500) console.error(`Lydspor AI check for game ${gameId} failed`, error)
    return Response.json(failure, { status })
  }
}

export const config = { path: '/api/lydspor-ai' }
