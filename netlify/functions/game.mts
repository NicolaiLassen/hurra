// POST /api/game — the only way into the game engine. Phones send actions; the
// host starts games. Body: { gameId, type: 'start' } or { gameId, type: 'action', action }.
import { createClient } from '@supabase/supabase-js'
import { GameError } from '../../src/games/core/Game'
import { handleGameRequest, HttpError, parseGameRequest } from '../lib/engine'

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const url = process.env.VITE_SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!url || !secretKey) {
    console.error('VITE_SUPABASE_URL and SUPABASE_SECRET_KEY must be set')
    return json({ error: "The game server isn't configured" }, 500)
  }
  const db = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const { data } = token ? await db.auth.getUser(token) : { data: { user: null } }
  if (!data.user) return json({ error: 'Not signed in' }, 401)

  try {
    const request = parseGameRequest(await req.json().catch(() => null))
    return json(await handleGameRequest(db, data.user.id, request))
  } catch (error) {
    if (error instanceof GameError) return json({ error: error.message }, 400)
    if (error instanceof HttpError) return json({ error: error.message }, error.status)
    console.error(error)
    return json({ error: 'Something went wrong' }, 500)
  }
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

export const config = { path: '/api/game' }
