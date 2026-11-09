import type {
  Actor,
  AnnouncementOptions,
  GameContext,
  GameInfo,
  PlayerId,
  PromptSpec,
} from './Game'

/** Effects recorded during one request, in the shape game_commit() takes (docs/engine-v2.md, 2.8). */
export type GameEffects = {
  points: { player_id: PlayerId; points: number; reason: string }[]
  profiles: Record<PlayerId, Record<string, unknown>>
  session_data?: Record<string, unknown>
  announcements: ({ message: string } & AnnouncementOptions)[]
  records: { type: string; data: Record<string, unknown>; about: PlayerId[] }[]
  prompts: { open: { key: string; spec: PromptSpec; closes_at?: number }[]; close: string[]; reveal: string[] }
}

export type ContextOptions = {
  /** Who caused the call. Default { kind: 'host' }. */
  actor?: Actor
  /** 'throw' (default, for tests) treats an effect for an unknown player as a bug; 'skip' (the engine) drops it and reports it. */
  unknownPlayers?: 'throw' | 'skip'
  /** Collect into these effects instead of new ones: step() runs the member hooks in a second context (actor system) that shares the request's effects. */
  effects?: GameEffects
}

/** Prompt keys as game_prompts.key allows them. */
export const PROMPT_KEY = /^[A-Za-z0-9_.:-]{1,64}$/

/** Cuts by code points, which is what Postgres char_length() counts, so an emoji is never split in half. */
const clip = (text: string, max: number) => Array.from(String(text)).slice(0, max).join('')

export function emptyEffects(): GameEffects {
  return { points: [], profiles: {}, announcements: [], records: [], prompts: { open: [], close: [], reveal: [] } }
}

export function hasEffects(effects: GameEffects): boolean {
  return (
    effects.points.length > 0 ||
    Object.keys(effects.profiles).length > 0 ||
    effects.session_data !== undefined ||
    effects.announcements.length > 0 ||
    effects.records.length > 0 ||
    effects.prompts.open.length > 0 ||
    effects.prompts.close.length > 0 ||
    effects.prompts.reveal.length > 0
  )
}

/**
 * A context that records effects instead of applying them. The engine saves
 * them with the new state; tests inspect them directly.
 */
export function createGameContext<Config>(
  info: GameInfo<Config>,
  random: () => number = Math.random,
  { actor = { kind: 'host' }, unknownPlayers = 'throw', effects = emptyEffects() }: ContextOptions = {},
): { ctx: GameContext<Config>; effects: GameEffects; skipped: string[] } {
  const skipped: string[] = []
  const present = new Set(info.players.map((p) => p.id))

  /** True for a present player. Otherwise a bug in 'throw' mode, or noted and skipped. */
  function known(playerId: PlayerId, what: string) {
    if (present.has(playerId)) return true
    if (unknownPlayers === 'throw') throw new Error(`Unknown player ${playerId}`)
    skipped.push(`${what} for ${playerId}`)
    return false
  }

  /** Opened earlier this round, or by this request (in either context). */
  const opened = (key: string) => key in info.prompts || effects.prompts.open.some((o) => o.key === key)

  const ctx: GameContext<Config> = {
    ...info,
    actor,
    random,
    awardPoints(playerId, points, reason) {
      if (!Number.isInteger(points)) throw new Error(`Points must be whole numbers, got ${points}`)
      if (known(playerId, 'points')) effects.points.push({ player_id: playerId, points, reason: clip(reason, 200) })
    },
    updateProfile(playerId, patch) {
      if (known(playerId, 'profile')) effects.profiles[playerId] = { ...effects.profiles[playerId], ...patch }
    },
    updateSessionData(patch) {
      effects.session_data = { ...effects.session_data, ...patch }
    },
    announce(message, { detail, to, ...options } = {}) {
      const audience = to?.filter((id) => known(id, 'announcement'))
      // Everyone it was for has left: drop it rather than tell the whole room.
      if (audience && audience.length === 0) return
      effects.announcements.push({
        message: clip(message, 280),
        ...(detail ? { detail: clip(detail, 280) } : {}),
        ...(audience ? { to: audience } : {}),
        ...options,
      })
    },
    openPrompt(key, spec, { closesAt } = {}) {
      if (!PROMPT_KEY.test(key)) throw new Error(`Prompt keys are 1 to 64 letters, digits or _.:- (got "${key}")`)
      if (opened(key)) throw new Error(`Prompt ${key} was already opened this round`)
      if (closesAt !== undefined && !Number.isFinite(closesAt)) throw new Error(`closesAt must be a time in ms, got ${closesAt}`)
      effects.prompts.open.push({ key, spec, ...(closesAt !== undefined ? { closes_at: Math.round(closesAt) } : {}) })
    },
    closePrompt(key) {
      if (!opened(key)) throw new Error(`Prompt ${key} was never opened this round`)
      if (!effects.prompts.close.includes(key)) effects.prompts.close.push(key)
    },
    revealPrompt(key) {
      if (!opened(key)) throw new Error(`Prompt ${key} was never opened this round`)
      if (!effects.prompts.reveal.includes(key)) effects.prompts.reveal.push(key)
    },
    record(type, data, { about = [] } = {}) {
      effects.records.push({ type, data, about: about.filter((id) => known(id, 'record')) })
    },
  }

  return { ctx, effects, skipped }
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
