import { useCallback } from 'react'
import { ensureSignedIn } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import type { FeedItem, Player, ScoreEvent, ScoreRow, Session, SessionGame } from '@/lib/types'
import { isJoinCode, isPlayerCode, isUuid } from '@/lib/urls'
import { useLiveQuery, type Watch } from '@/lib/useLiveQuery'

function unwrap<T>({ data, error }: { data: unknown; error: { message: string } | null }): T {
  if (error) throw new Error(error.message)
  return data as T
}

/** Watches for a session-scoped query; none for an id that isn't valid (it isn't queried either). */
const sessionWatches = (sessionId: string, watches: Watch[]) => (isUuid(sessionId) ? watches : [])

export async function getSessionByCode(joinCode: string) {
  if (!isJoinCode(joinCode)) return null
  return unwrap<Session | null>(await supabase.from('sessions').select('*').eq('join_code', joinCode).maybeSingle())
}

/** The player a signed-in user is in a session, if any. */
export async function getOwnPlayer(sessionId: string, userId: string) {
  return unwrap<Player | null>(
    await supabase.from('players').select('*').eq('session_id', sessionId).eq('user_id', userId).maybeSingle(),
  )
}

/** Signs this device in (anonymously if needed) and finds its player in the session; null if there's no such session. */
export async function loadMembership(joinCode: string): Promise<{ session: Session; player: Player | null } | null> {
  const user = await ensureSignedIn()
  const session = await getSessionByCode(joinCode)
  if (!session) return null
  return { session, player: await getOwnPlayer(session.id, user.id) }
}

export async function getPlayerByCode(code: string) {
  if (!isPlayerCode(code)) return null
  return unwrap<(Player & { session: Session }) | null>(
    await supabase.from('players').select('*, session:sessions(*)').eq('code', code).maybeSingle(),
  )
}

export function useSessions() {
  const fetcher = useCallback(
    async () =>
      unwrap<Session[]>(await supabase.from('sessions').select('*').order('created_at', { ascending: false })),
    [],
  )
  return useLiveQuery(fetcher, [{ table: 'sessions' }])
}

/** One session, live; null if there's no such session (or the id isn't valid). */
export function useSession(sessionId: string) {
  const fetcher = useCallback(async () => {
    if (!isUuid(sessionId)) return null
    return unwrap<Session | null>(await supabase.from('sessions').select('*').eq('id', sessionId).maybeSingle())
  }, [sessionId])
  return useLiveQuery(fetcher, sessionWatches(sessionId, [{ table: 'sessions', filter: `id=eq.${sessionId}` }]))
}

/** Whether the session still exists, read fresh rather than from a live query. */
export async function sessionExists(sessionId: string) {
  if (!isUuid(sessionId)) return false
  return unwrap<{ id: string } | null>(await supabase.from('sessions').select('id').eq('id', sessionId).maybeSingle()) !== null
}

export function useSessionGames(sessionId: string) {
  const fetcher = useCallback(async () => {
    if (!isUuid(sessionId)) return []
    return unwrap<SessionGame[]>(
      await supabase.from('session_games').select('*').eq('session_id', sessionId).order('position').order('created_at'),
    )
  }, [sessionId])
  return useLiveQuery(fetcher, sessionWatches(sessionId, [{ table: 'session_games', filter: `session_id=eq.${sessionId}` }]))
}

export function useScoreboard(sessionId: string) {
  const fetcher = useCallback(async () => {
    if (!isUuid(sessionId)) return []
    return unwrap<ScoreRow[]>(
      await supabase
        .from('scoreboard')
        .select('*')
        .eq('session_id', sessionId)
        .order('points', { ascending: false })
        .order('name'),
    )
  }, [sessionId])
  return useLiveQuery(
    fetcher,
    sessionWatches(sessionId, [
      { table: 'players', filter: `session_id=eq.${sessionId}` },
      { table: 'score_events', filter: `session_id=eq.${sessionId}` },
      { table: 'game_scores', filter: `session_id=eq.${sessionId}` },
    ]),
  )
}

export function usePlayerPoints(playerId: string) {
  const fetcher = useCallback(async () => {
    const row = unwrap<ScoreRow | null>(
      await supabase.from('scoreboard').select('*').eq('player_id', playerId).maybeSingle(),
    )
    return row?.points ?? 0
  }, [playerId])
  return useLiveQuery(fetcher, [
    { table: 'score_events', filter: `player_id=eq.${playerId}` },
    { table: 'game_scores', filter: `player_id=eq.${playerId}` },
  ])
}

export function usePlayerEvents(playerId: string) {
  const fetcher = useCallback(
    async () =>
      unwrap<ScoreEvent[]>(
        await supabase
          .from('score_events')
          .select('*')
          .eq('player_id', playerId)
          .order('created_at', { ascending: false })
          .limit(20),
      ),
    [playerId],
  )
  return useLiveQuery(fetcher, [{ table: 'score_events', filter: `player_id=eq.${playerId}` }])
}

export function usePlayers(sessionId: string) {
  const fetcher = useCallback(async () => {
    if (!isUuid(sessionId)) return []
    return unwrap<Player[]>(await supabase.from('players').select('*').eq('session_id', sessionId).order('created_at'))
  }, [sessionId])
  return useLiveQuery(fetcher, sessionWatches(sessionId, [{ table: 'players', filter: `session_id=eq.${sessionId}` }]))
}

/** The signed-in player's private view of a game (row level security hides everyone else's). */
export function usePlayerGameView(gameId: string, playerId: string) {
  const fetcher = useCallback(async () => {
    const row = unwrap<{ view: unknown } | null>(
      await supabase
        .from('game_player_views')
        .select('view')
        .eq('game_id', gameId)
        .eq('player_id', playerId)
        .maybeSingle(),
    )
    return row ? row.view : null
  }, [gameId, playerId])
  return useLiveQuery(fetcher, [{ table: 'game_player_views', filter: `player_id=eq.${playerId}` }])
}

/** A game's full state. Only hosts can read it. */
export function useGameState(gameId: string) {
  const fetcher = useCallback(async () => {
    const row = unwrap<{ state: unknown } | null>(
      await supabase.from('game_states').select('state').eq('game_id', gameId).maybeSingle(),
    )
    return row ? row.state : null
  }, [gameId])
  return useLiveQuery(fetcher, [{ table: 'game_states', filter: `game_id=eq.${gameId}` }])
}

/** The latest announcements, newest first; `everyoneOnly` skips ones aimed at specific players. */
export function useFeed(sessionId: string, { limit = 5, everyoneOnly = false } = {}) {
  const fetcher = useCallback(async () => {
    if (!isUuid(sessionId)) return []
    let query = supabase.from('session_feed').select('*').eq('session_id', sessionId)
    if (everyoneOnly) query = query.is('audience', null)
    // Announcements from one game move share created_at (one transaction), so
    // the id breaks the tie: the newest row is the one announced last.
    query = query.order('created_at', { ascending: false }).order('id', { ascending: false })
    return unwrap<FeedItem[]>(await query.limit(limit))
  }, [sessionId, limit, everyoneOnly])
  return useLiveQuery(fetcher, sessionWatches(sessionId, [{ table: 'session_feed', filter: `session_id=eq.${sessionId}` }]))
}
