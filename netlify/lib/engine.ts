// The game engine. It knows nothing about specific games: it loads the plugin
// for a game's type, gives it a context and saves what it produces through
// apply_game_state(). Runs with the secret key, so it checks permissions itself.
import type { SupabaseClient } from '@supabase/supabase-js'
import { createGameContext, type GameEffects } from '../../src/games/core/context'
import type { AnyGame, GameData, GameInfo, PlayerId } from '../../src/games/core/Game'
import { gameLogic } from '../../src/games/logic'

export type GameRequest =
  | { gameId: string; type: 'start' }
  | { gameId: string; type: 'end' }
  | { gameId: string; type: 'action'; action: unknown }

export class HttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type GameRow = {
  id: string
  session_id: string
  game_type: string
  status: string
  config: Record<string, unknown>
  archived_at: string | null
}

const MAX_ATTEMPTS = 4

export function parseGameRequest(input: unknown): GameRequest {
  const body = input as Partial<{ gameId: unknown; type: unknown; action: unknown }> | null
  if (typeof body?.gameId !== 'string') throw new HttpError(400, 'gameId is required')
  if (body.type === 'start') return { gameId: body.gameId, type: 'start' }
  if (body.type === 'end') return { gameId: body.gameId, type: 'end' }
  if (body.type === 'action') return { gameId: body.gameId, type: 'action', action: body.action }
  throw new HttpError(400, 'type must be "start", "end" or "action"')
}

/** Runs a start, end or action request for the signed-in user and returns what their phone needs. */
export async function handleGameRequest(
  db: SupabaseClient,
  userId: string,
  request: GameRequest,
  random: () => number = Math.random,
): Promise<{ view?: unknown }> {
  const game = await maybeOne<GameRow>(
    db.from('session_games').select('id, session_id, game_type, status, config, archived_at').eq('id', request.gameId),
  )
  if (!game) throw new HttpError(404, 'Game not found')
  const logic = gameLogic.get(game.game_type)
  if (!logic) throw new HttpError(400, `No logic for game type “${game.game_type}”`)

  if (request.type !== 'action' && !(await maybeOne(db.from('hosts').select('user_id').eq('user_id', userId)))) {
    throw new HttpError(403, `Only hosts can ${request.type} games`)
  }

  if (request.type === 'start') {
    if (game.archived_at) throw new HttpError(409, 'Unarchive this game before starting it')
    // A second tap (or a retried request) must not deal a running game again.
    if (game.status === 'active') throw new HttpError(409, 'This game is already running')
    const { info } = await loadInfo(db, game, logic)
    const { ctx, effects } = createGameContext(info, random)
    await save(db, logic, info, logic.setup(ctx), null, effects, 'active')
    return {}
  }

  if (game.status !== 'active') throw new HttpError(409, 'This game is not running')

  if (request.type === 'end') return endGame(db, logic, game, random)

  for (let attempt = 1; ; attempt++) {
    const { info, playerIdByUser } = await loadInfo(db, game, logic)
    const playerId = playerIdByUser.get(userId)
    if (!playerId) throw new HttpError(403, "You're not a player in this session")

    const current = await maybeOne<{ state: unknown; version: number }>(
      db.from('game_states').select('state, version').eq('game_id', game.id),
    )
    if (!current) throw new HttpError(409, 'This game has not started')

    const { ctx, effects } = createGameContext(info, random)
    const state = logic.handleAction(current.state, logic.parseAction(request.action), playerId, ctx)
    try {
      await save(db, logic, info, state, current.version, effects, null)
      return { view: logic.playerView(state, playerId, info) }
    } catch (error) {
      // Someone else's action landed first: rerun ours against the new state.
      if ((error as { code?: string }).code === '40001' && attempt < MAX_ATTEMPTS) continue
      throw error
    }
  }
}

/** Ends a game through its onEnd callback, so it can wrap up (e.g. announce the result). */
async function endGame(db: SupabaseClient, logic: AnyGame, game: GameRow, random: () => number) {
  for (let attempt = 1; ; attempt++) {
    const { info } = await loadInfo(db, game, logic)
    const current = await maybeOne<{ state: unknown; version: number }>(
      db.from('game_states').select('state, version').eq('game_id', game.id),
    )
    if (!current) throw new HttpError(409, 'This game has not started')
    const { ctx, effects } = createGameContext(info, random)
    const state = logic.onEnd ? logic.onEnd(current.state, ctx) : current.state
    try {
      await save(db, logic, info, state, current.version, effects, 'finished')
      return {}
    } catch (error) {
      if ((error as { code?: string }).code === '40001' && attempt < MAX_ATTEMPTS) continue
      throw error
    }
  }
}

/** Everything a game may read about the party, plus who each signed-in user is. */
async function loadInfo(db: SupabaseClient, game: GameRow, logic: AnyGame) {
  const [session, players, scoreboard] = await Promise.all([
    maybeOne<{ id: string; name: string; data: GameData }>(
      db.from('sessions').select('id, name, data').eq('id', game.session_id),
    ),
    many<{ id: PlayerId; name: string; profile: GameData; user_id: string }>(
      db.from('players').select('id, name, profile, user_id').eq('session_id', game.session_id).order('created_at'),
    ),
    many<{ player_id: PlayerId; points: number }>(
      db.from('scoreboard').select('player_id, points').eq('session_id', game.session_id),
    ),
  ])
  if (!session) throw new HttpError(404, 'Session not found')

  const info: GameInfo<unknown> = {
    gameId: game.id,
    session,
    players: players.map(({ id, name, profile }) => ({ id, name, profile })),
    scoreboard: Object.fromEntries(scoreboard.map((row) => [row.player_id, row.points])),
    config: { ...(logic.defaultConfig as object), ...game.config },
    now: Date.now(),
  }
  return { info, playerIdByUser: new Map(players.map((p) => [p.user_id, p.id])) }
}

/** What the database stores for a state: its projections for every audience. */
export function project(logic: AnyGame, info: GameInfo<unknown>, state: unknown) {
  const scores = Object.entries(logic.scores(state, info)).filter(([, points]) => points !== 0)
  for (const [playerId, points] of scores) {
    if (!Number.isInteger(points)) throw new Error(`${logic.type}: score for ${playerId} isn't a whole number`)
  }
  return {
    publicState: logic.publicState(state, info),
    playerViews: Object.fromEntries(info.players.map((p) => [p.id, logic.playerView(state, p.id, info)])),
    scores: Object.fromEntries(scores),
  }
}

async function save(
  db: SupabaseClient,
  logic: AnyGame,
  info: GameInfo<unknown>,
  state: unknown,
  expectedVersion: number | null,
  effects: GameEffects,
  status: 'active' | 'finished' | null,
) {
  const { publicState, playerViews, scores } = project(logic, info, state)
  const { error } = await db.rpc('apply_game_state', {
    p_game_id: info.gameId,
    p_expected_version: expectedVersion,
    p_state: state,
    p_public_state: publicState,
    p_player_views: playerViews,
    p_scores: scores,
    p_effects: effects,
    p_status: status,
  })
  if (error) throw error
}

type Query = PromiseLike<{ data: unknown; error: unknown }>

async function maybeOne<T>(query: { maybeSingle(): Query }) {
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data as T | null
}

async function many<T>(query: Query) {
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as T[]
}
