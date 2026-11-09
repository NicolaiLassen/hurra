// Row and snapshot shapes (docs/engine-v2.md, 5.2). Snapshot times are numbers:
// ms since epoch, database clock, so phones never parse timestamps.
//
// Relative imports only: the rehearsal type-checks and runs this file under Node (5.1).
import type { AnswerPayload, PromptSpec } from '../games/core/Game'

export type GameData = Record<string, Record<string, unknown>>
export type GameStatus = 'pending' | 'active' | 'finished'

/** Snapshot times are numbers: ms since epoch, database clock. */
export type Session = {
  id: string
  name: string
  join_code: string
  status: 'open' | 'closed'
  data: GameData
  spotlight_game_id: string | null
  spotlight_at: number | null
  tv_scene: 'live' | 'recap'
  archived_at: number | null
  created_at: number
}
/** What session_by_code returns to someone who isn't in the party yet. */
export type PublicSession = Pick<Session, 'id' | 'name' | 'join_code' | 'status' | 'archived_at'>

export type Player = { id: string; name: string; code: string; profile: GameData; created_at: number }
/** A players row read directly (PlayerCard, joining): ISO times, with its session and user. */
export type PlayerRow = {
  id: string
  session_id: string
  user_id: string
  name: string
  code: string
  profile: GameData
  created_at: string
}

export type SessionGame = {
  id: string
  game_type: string
  title: string
  position: number
  status: GameStatus
  /** Null outside the snapshot's shown games (2.7): pending games, and older finished ones. */
  public_state: unknown
  started_at: number | null
  finished_at: number | null
  finished_by: 'game' | 'host' | null
  winners: string[]
  wake_at: number | null
  archived_at: number | null
  created_at: number
}

/** A row of the host's party list (useSessions): read directly, so its times are ISO strings. */
export type HostSessionRow = {
  id: string
  name: string
  join_code: string
  status: 'open' | 'closed'
  archived_at: string | null
  created_at: string
}

export type ScoreRow = { player_id: string; name: string; code: string; points: number; profile: GameData }
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
export type FeedItem = {
  id: number
  game_id: string | null
  message: string
  detail: string | null
  audience: string[] | null
  sound: string | null
  icon: string | null
  tone: string | null
  interrupt: boolean
  created_at: number
}

// Relative, not '@/': the rehearsal type-checks and runs this file under Node (5.1).
export type { AnswerPayload, PromptSpec } from '../games/core/Game'
export type PromptState = {
  game_id: string
  key: string
  spec: PromptSpec
  opened_at: number
  closes_at: number | null
  closed_at: number | null
  revealed_at: number | null
}
/** What submit_answer returns (section 2.7). */
export type SubmitResult = { accepted: true; replayed?: true; answer: AnswerPayload; at: number; ms: number }
/** Answer counts of unrevealed prompts: game id, then prompt key. */
export type Tallies = Record<string, Record<string, number>>

export type Snapshot = {
  now: number
  member: boolean
  exists: boolean
  session: Session | null
  games: SessionGame[]
  prompts: PromptState[]
  tallies: Tallies
  game_points: Record<string, Record<string, number>>
  players: Player[]
  standings: ScoreRow[]
  feed: FeedItem[]
  me: {
    player_id: string
    views: Record<string, unknown>
    answers: Record<string, Record<string, AnswerPayload>>
  } | null
  states: Record<string, { state: unknown; config: unknown; round: number; members: string[] }> | null
  /** Paired screens of this party: the host screen only, else null. */
  screens: number | null
  recap: { published_at: number } | null
  /** A phone that is no longer a member because its player moved to another phone (claim_player). */
  moved?: boolean
}
