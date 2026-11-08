import { supabase } from '@/lib/supabase'

export type GameRequest =
  | { gameId: string; type: 'start' }
  | { gameId: string; type: 'end' }
  | { gameId: string; type: 'action'; action: unknown }

/**
 * Calls the game engine (netlify/functions/game.mts). Rejects with the
 * engine's message, e.g. the rule the player just broke.
 */
export async function callGame(request: GameRequest): Promise<{ view?: unknown }> {
  const { data } = await supabase.auth.getSession()
  const response = await fetch('/api/game', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
    body: JSON.stringify(request),
  })
  const body = (await response.json().catch(() => ({}))) as { error?: string; view?: unknown }
  if (!response.ok) throw new Error(body.error ?? `The game server answered ${response.status}`)
  return body
}
