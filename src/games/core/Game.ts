// The contract every game plugin implements. The engine (netlify/lib/engine.ts)
// knows nothing about specific games: it loads the plugin by type, hands it a
// context and saves the state and effects the plugin produces.
//
// Files in src/games/core and src/games/*/logic.ts are also bundled into the
// Netlify function, so they use relative imports (the "@/" alias is Vite-only)
// and must not import React or browser code.

import type { SoundName } from './sounds'

export type PlayerId = string

export type Scores = Record<PlayerId, number>

/** Public per-game data on a player or the session, keyed by game type. */
export type GameData = Record<string, Record<string, unknown>>

export type GamePlayer = {
  id: PlayerId
  name: string
  /** Every game's public profile data for this player, keyed by game type. */
  profile: GameData
}

export type GameSession = {
  id: string
  name: string
  /** Shared data any game can read; each game writes its own section. */
  data: GameData
}

/** Icons a game can put on an announcement; the app draws them from its own icon set. */
export const ANNOUNCEMENT_ICONS = [
  'megaphone',
  'sword',
  'detective',
  'skull',
  'crown',
  'confetti',
  'trophy',
  'star',
  'lightning',
  'target',
] as const
export type AnnouncementIcon = (typeof ANNOUNCEMENT_ICONS)[number]

export type Tone = 'gold' | 'pink' | 'teal' | 'violet' | 'red'

/** How an announcement looks and sounds, and who it's for. */
export type AnnouncementOptions = {
  /**
   * A second, quieter line under the message, e.g. the task that was used or
   * "2 players, one life each". Keep the message itself short: it's the headline.
   */
  detail?: string
  /** The players it's for: their phones show it and play its sound. Everyone (and the TV) when left out. */
  to?: PlayerId[]
  sound?: SoundName
  icon?: AnnouncementIcon
  tone?: Tone
}

/** Read-only facts about the party, available to every method. */
export type GameInfo<Config> = {
  readonly gameId: string
  readonly session: GameSession
  readonly players: readonly GamePlayer[]
  /** The day's scoreboard: each player's total across all games. */
  readonly scoreboard: Readonly<Record<PlayerId, number>>
  readonly config: Config
  /** Milliseconds since epoch, fixed for the whole call. */
  readonly now: number
}

/**
 * What setup() and handleAction() can do beyond returning new state. Effects
 * are saved in the same transaction as the state, so they happen exactly once.
 */
export type GameContext<Config> = GameInfo<Config> & {
  random(): number
  /** A bonus or penalty on the day's scoreboard, outside the game's own scores(). */
  awardPoints(playerId: PlayerId, points: number, reason: string): void
  /** Shallow-merges into this game's section of the player's public profile. */
  updateProfile(playerId: PlayerId, patch: Record<string, unknown>): void
  /** Shallow-merges into this game's section of the session's shared data. */
  updateSessionData(patch: Record<string, unknown>): void
  /**
   * The event channel to the app: a banner (and sound) on the TV and a callout
   * on phones, or only on the given players' phones with `to`. Announcements
   * are public data; secrets belong in playerView().
   */
  announce(message: string, options?: AnnouncementOptions): void
}

/** A rule the player broke, e.g. "You're already out". Shown to them as is. */
export class GameError extends Error {
  name = 'GameError'
}

/**
 * A game plugin. Methods are pure functions of their arguments: state goes in,
 * new state comes out, and everything else happens through the context.
 */
export abstract class Game<State, Action, PublicState, PlayerView, Config> {
  /** Stored in session_games.game_type; also the key for profile and session data. */
  abstract readonly type: string
  /** Merged with the host's settings (session_games.config) into info.config. */
  abstract readonly defaultConfig: Config

  /** Deals the initial state when the host starts (or restarts) the game. */
  abstract setup(ctx: GameContext<Config>): State

  /** Checks untrusted input from a phone. Throw GameError if it's malformed. */
  abstract parseAction(input: unknown): Action

  /** Applies a player's action. Throw GameError to reject it. */
  abstract handleAction(state: State, action: Action, playerId: PlayerId, ctx: GameContext<Config>): State

  /** Points each player has earned in this game. Added to the day's scoreboard. */
  abstract scores(state: State, info: GameInfo<Config>): Scores

  /** What everyone may see. Never put secrets here. */
  abstract publicState(state: State, info: GameInfo<Config>): PublicState

  /** What one player may see, e.g. their own secret task. Called for every player in the session. */
  abstract playerView(state: State, playerId: PlayerId, info: GameInfo<Config>): PlayerView

  /** Optional: called when the host ends the game, to wrap up (e.g. announce the result). */
  onEnd?(state: State, ctx: GameContext<Config>): State
}

/** Any game plugin, as the engine and registries see them. */
export type AnyGame = Game<unknown, unknown, unknown, unknown, unknown>
