// Row shapes of the tables in supabase/migrations.

/** Public per-game data on a player or session, keyed by game type. */
export type GameData = Record<string, Record<string, unknown>>

export type Session = {
  id: string
  name: string
  join_code: string
  status: 'open' | 'closed'
  data: GameData
  /** Set when the host has put the party away; everything is kept. */
  archived_at: string | null
  created_at: string
}

export type Player = {
  id: string
  session_id: string
  user_id: string
  name: string
  code: string
  profile: GameData
  created_at: string
}

export type GameStatus = 'pending' | 'active' | 'finished'

export type SessionGame = {
  id: string
  session_id: string
  game_type: string
  title: string
  position: number
  status: GameStatus
  config: Record<string, unknown>
  /** What the game shows everyone; the full state is in game_states. */
  public_state: unknown
  /** Set when the host has tidied the game away; its points still count. */
  archived_at: string | null
  created_at: string
}

export type ScoreEvent = {
  id: number
  session_id: string
  player_id: string
  game_id: string | null
  points: number
  reason: string | null
  awarded_by: string | null
  created_at: string
}

export type ScoreRow = {
  session_id: string
  player_id: string
  name: string
  code: string
  points: number
  profile: GameData
}

export type FeedItem = {
  id: number
  session_id: string
  game_id: string | null
  message: string
  /** A second, quieter line under the message; null when the game gave none (and on older rows). */
  detail: string | null
  /** The players it's for; null means everyone (and the TV). */
  audience: string[] | null
  sound: string | null
  icon: string | null
  tone: string | null
  created_at: string
}
