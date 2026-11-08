import type { AnnouncementOptions, GameContext, GameInfo, PlayerId } from './Game'

/** Effects recorded during one call, in the shape apply_game_state() expects. */
export type GameEffects = {
  points: { player_id: PlayerId; points: number; reason: string }[]
  profiles: Record<PlayerId, Record<string, unknown>>
  session_data?: Record<string, unknown>
  announcements: ({ message: string } & AnnouncementOptions)[]
}

/** Cuts by code points, which is what Postgres char_length() counts, so an emoji is never split in half. */
const clip = (text: string, max: number) => Array.from(text).slice(0, max).join('')

/**
 * A context that records effects instead of applying them. The engine saves
 * them with the new state; tests inspect them directly.
 */
export function createGameContext<Config>(
  info: GameInfo<Config>,
  random: () => number = Math.random,
): { ctx: GameContext<Config>; effects: GameEffects } {
  const effects: GameEffects = { points: [], profiles: {}, announcements: [] }
  const playerIds = new Set(info.players.map((p) => p.id))

  function assertPlayer(playerId: PlayerId) {
    if (!playerIds.has(playerId)) throw new Error(`Unknown player ${playerId}`)
  }

  const ctx: GameContext<Config> = {
    ...info,
    random,
    awardPoints(playerId, points, reason) {
      assertPlayer(playerId)
      if (!Number.isInteger(points)) throw new Error(`Points must be whole numbers, got ${points}`)
      effects.points.push({ player_id: playerId, points, reason: clip(reason, 200) })
    },
    updateProfile(playerId, patch) {
      assertPlayer(playerId)
      effects.profiles[playerId] = { ...effects.profiles[playerId], ...patch }
    },
    updateSessionData(patch) {
      effects.session_data = { ...effects.session_data, ...patch }
    },
    announce(message, { detail, ...options } = {}) {
      options.to?.forEach(assertPlayer)
      effects.announcements.push({
        message: clip(message, 280),
        ...(detail ? { detail: clip(detail, 280) } : {}),
        ...options,
      })
    },
  }

  return { ctx, effects }
}

/** Fisher-Yates shuffle with an injectable random source, for deterministic tests. */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}
