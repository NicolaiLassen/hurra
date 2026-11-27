// The contract every game plugin implements (docs/engine-v2.md, section 3).
// The engine knows nothing about specific games: it loads the plugin by type,
// runs it through the pure step() in runtime.ts and saves what it produces.
//
// Files in src/games/core and src/games/*/logic.ts are also bundled into the
// Netlify function, and src/games/*/bot.ts and src/games/bots.ts run in the
// rehearsal under Node, so they use relative imports (the "@/" alias is
// Vite-only) and must not import React or browser code.

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

/** A name on the party's guest list: a guest who joined, or one the host listed who hasn't yet. */
export type GameGuest = {
  readonly id: PlayerId
  readonly name: string
  /** True once they joined: then they are in info.players too. */
  readonly joined: boolean
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
  /** A second, quieter line under the message. */
  detail?: string
  /** Only these players (and hosts) can read it; their phones toast it. Everyone, and the TV, when left out. */
  to?: PlayerId[]
  sound?: SoundName
  icon?: AnnouncementIcon
  tone?: Tone
  /**
   * The TV shows it as a banner with its sound even while another game holds
   * the stage (a background game's announcements otherwise go to a quiet
   * ticker). Only for results the whole room should hear, such as a winner.
   */
  interrupt?: boolean
}

/** Where a game shows by default when the host starts it. */
export type Presentation = 'stage' | 'background'

/** Who caused the call. */
export type Actor =
  | { readonly kind: 'player'; readonly playerId: PlayerId }
  | { readonly kind: 'host' }
  /** A time from wakeAt() has passed. */
  | { readonly kind: 'timer' }
  /** Someone joined the party or left it: onPlayerJoin and onPlayerLeave always run with this actor. */
  | { readonly kind: 'system' }

/** What an answer to a prompt may be. The database checks every answer against it. */
export type PromptSpec =
  | {
      readonly kind: 'choice'
      /**
       * The allowed values; 'players' for the ids of the party's joined players at
       * the moment of answering; or 'guests' for every name on the guest list,
       * joined or not, so the room can name a guest who never came.
       */
      readonly options: readonly string[] | 'players' | 'guests'
      readonly min?: number // default 1
      readonly max?: number // default 1
      /** The first answer counts (a quiz). Otherwise it may change until the prompt closes (a vote). */
      readonly final?: boolean
      /** With 'players' or 'guests': a player can't pick themselves. */
      readonly exclude_self?: boolean
    }
  | { readonly kind: 'number'; readonly min: number; readonly max: number; readonly integer?: boolean; readonly final?: boolean }
  | { readonly kind: 'text'; readonly max_length?: number; readonly final?: boolean }

/** An answer as the database normalised it: choices sorted, text trimmed. */
export type AnswerPayload =
  | { readonly choice: readonly string[] }
  | { readonly value: number }
  | { readonly text: string }

/** A prompt of this round. Times are ms since epoch, database clock. */
export type Prompt = {
  readonly key: string
  readonly spec: PromptSpec
  readonly openedAt: number
  readonly closesAt: number | null
  readonly closedAt: number | null
  readonly revealedAt: number | null
}

/** One player's answer to a closed prompt. `ms` is how long after the prompt opened it first arrived. */
export type Answer = {
  readonly playerId: PlayerId
  readonly answer: AnswerPayload
  readonly firstAt: number
  readonly at: number
  readonly ms: number
  readonly changes: number
}

/** Read-only facts, available to every method. */
export type GameInfo<Config> = {
  readonly gameId: string
  /** 1 for the first start, 2 after a restart, and so on. */
  readonly round: number
  readonly session: GameSession
  /** The party's players right now (guests who joined). Effects aimed at anyone else are dropped. */
  readonly players: readonly GamePlayer[]
  /**
   * Everyone on the guest list, joined or still expected, for names and
   * settings only. Only `players` play: effects, scores and views for anyone
   * else are dropped. A game's settings may name an expected guest; see
   * docs/guest-list.md, section 9.
   */
  readonly guests: readonly GameGuest[]
  /** The day's scoreboard: each player's total across all games. */
  readonly scoreboard: Readonly<Record<PlayerId, number>>
  /** The settings this round started with (checked by parseConfig). Never changes during a round. */
  readonly config: Config
  /** Ms since epoch by the database clock, fixed for the whole request, retries included. */
  readonly now: number
  /**
   * Whether this round is played in teams (session_games.team_play): one
   * answer from any member counts for the whole team, so every member has the
   * same answer. Fixed for the round (the host switches it only while the game
   * isn't live). Missing means no.
   */
  readonly teamPlay?: boolean
  /** This round's prompts, by key. */
  readonly prompts: Readonly<Record<string, Prompt>>
  /** Answers to prompts that are closed but not revealed yet, by key, in arrival order. */
  readonly answers: Readonly<Record<string, readonly Answer[]>>
}

export type RecordOptions = {
  /** The players it is about, for "Your night" in the recap. */
  about?: PlayerId[]
}

/**
 * What the hooks can do beyond returning new state. Effects are saved in the
 * same transaction as the state, once per tap even when the phone resends it.
 */
export type GameContext<Config> = GameInfo<Config> & {
  readonly actor: Actor
  /** Use this, never Math.random: a hook may run again when a save is retried. */
  random(): number
  /** A bonus or penalty on the day's scoreboard. Skipped for players who left. */
  awardPoints(playerId: PlayerId, points: number, reason: string): void
  /** Shallow-merges into this game's section of the player's public profile. Skipped for players who left. */
  updateProfile(playerId: PlayerId, patch: Record<string, unknown>): void
  /** Shallow-merges into this game's section of the session's shared data. */
  updateSessionData(patch: Record<string, unknown>): void
  /** A banner on the TV and a toast on phones; with `to`, only those players. `to` is filtered to present players; when none is left, the announcement is dropped, never made public. */
  announce(message: string, options?: AnnouncementOptions): void
  /** Opens a prompt everyone answers from their phone, straight to the database. `closesAt` (ms) is a deadline. */
  openPrompt(key: string, spec: PromptSpec, options?: { closesAt?: number }): void
  /** Stops accepting answers. The game sees them in info.answers on its next request. */
  closePrompt(key: string): void
  /** Closes it and marks it revealed: its answers leave info.answers. Call it when you score them. */
  revealPrompt(key: string): void
  /** A fact for the event log and the recap (hosts only until the recap is published). */
  record(type: string, data: Record<string, unknown>, options?: RecordOptions): void
}

/** A rule the player broke, e.g. "You're already out". Shown to them as is. */
export class GameError extends Error {
  name = 'GameError'
}

/** One event_log row, as recap() sees it. */
export type LogEntry = {
  readonly id: number
  readonly at: number
  readonly kind: string
  readonly round: number | null
  readonly actor: 'player' | 'host' | 'game' | 'timer' | 'system'
  readonly playerId: PlayerId | null
  readonly about: readonly PlayerId[]
  readonly data: Readonly<Record<string, unknown>>
}

/** One round of a game, as recap() gets it. */
export type RecapRound<State, Config> = {
  readonly gameId: string
  readonly title: string
  readonly round: number
  /** The recap builder passes only finished rounds to recap(); a hook must still return [] when this is false. */
  readonly finished: boolean
  readonly startedAt: number
  readonly finishedAt: number | null
  readonly finishedBy: 'game' | 'host' | null
  readonly config: Config
  /** The final state, or the latest for a round still running. */
  readonly state: State
  readonly winners: readonly PlayerId[]
  /** Everyone who was ever in the party, with the name they had. */
  readonly players: readonly { readonly id: PlayerId; readonly name: string }[]
  /** This round's points per player: its scores plus its bonus points. */
  readonly points: Readonly<Record<PlayerId, number>>
  /** This game's log rows for this round, in order. */
  readonly log: readonly LogEntry[]
}

/** One line of the recap, drawn by the app. */
export type Highlight = {
  title: string
  detail?: string
  players?: PlayerId[]
  at?: number
  icon?: AnnouncementIcon
  tone?: Tone
  weight?: 'headline' | 'highlight' | 'line'
}

/**
 * A game plugin. Methods are pure functions of their arguments: state goes in,
 * new state comes out, and everything else happens through the context.
 */
export abstract class Game<State, Action, PublicState, PlayerView, Config, HostAction = never> {
  /** Stored in session_games.game_type; also the key for profile and session data. */
  abstract readonly type: string
  /** Merged under the saved settings. Ships in the browser bundle, so it is public. */
  abstract readonly defaultConfig: Config
  /** 'stage' (default) takes the TV when started; 'background' runs beside the stage game. */
  readonly presentation?: Presentation

  /** Checks defaultConfig merged with the saved settings, once, at start. Throw GameError to refuse. */
  parseConfig?(input: Record<string, unknown>): Config
  /** Deals the initial state when the host starts (or restarts) the game. */
  abstract setup(ctx: GameContext<Config>): State
  /** Checks untrusted input from a phone. Throw GameError if it's malformed. */
  abstract parseAction(input: unknown): Action
  /** Applies a player's move. Throw GameError to refuse it. Not called once finished. */
  abstract handleAction(state: State, action: Action, playerId: PlayerId, ctx: GameContext<Config>): State

  /**
   * Host controls (Next, Reveal). A separate path: a guest can never send one.
   * Each action names the step it was made for; one whose step has passed
   * returns the state unchanged, which the engine answers as skipped (3.5).
   */
  parseHostAction?(input: unknown): HostAction
  handleHostAction?(state: State, action: HostAction, ctx: GameContext<Config>): State

  /** When this state wants a sync (ms), or null. Public as session_games.wake_at. */
  wakeAt?(state: State, info: GameInfo<Config>): number | null
  /**
   * Runs once wakeAt has passed. Must move wakeAt later or to null: a sync
   * that leaves it at or before now clears wake_at and logs game.wake_stuck.
   */
  onWake?(state: State, ctx: GameContext<Config>): State

  /** Someone joined the party while this round runs. */
  onPlayerJoin?(state: State, player: GamePlayer, ctx: GameContext<Config>): State
  /**
   * The host removed someone (or they moved away). They are already gone from
   * ctx.players. Also for an id the host freed and someone took again: it
   * leaves (as the old person) and joins (as the new one) in the same save.
   * Drop everything you hold for it.
   */
  onPlayerLeave?(state: State, playerId: PlayerId, ctx: GameContext<Config>): State

  /** True once the game has its result. The same save finishes it (finished_by 'game'). */
  isFinished?(state: State, info: GameInfo<Config>): boolean
  /**
   * Who won, for the TV, phones, the log and the recap. Default: the top of
   * this round's points (scores() plus this game's awards and bonuses), all
   * tied ones. Return [] when nobody scored; the default does too.
   */
  winners?(state: State, info: GameInfo<Config>): PlayerId[]
  /**
   * Runs exactly once per finish: right after the deciding change ('game') or
   * when the host ends it ('host'). The deciding change already announced the
   * result, so stay quiet for 'game'.
   */
  onEnd?(state: State, ctx: GameContext<Config>, by: 'game' | 'host'): State

  /** Points each player has earned in this game. Added to the day's scoreboard. */
  abstract scores(state: State, info: GameInfo<Config>): Scores
  /** What everyone may see. Never put secrets here. */
  abstract publicState(state: State, info: GameInfo<Config>): PublicState
  /** What one player may see. Called for every player in the party, including ones the game doesn't know. */
  abstract playerView(state: State, playerId: PlayerId, info: GameInfo<Config>): PlayerView

  /**
   * This game's highlights for the recap. Pure; runs in the host's browser.
   * Called only for finished rounds, and reveals only what the finished round
   * showed the room (3.5). Returns [] for a round that isn't finished.
   */
  recap?(round: RecapRound<State, Config>): Highlight[]
}

/** Any game plugin, as the engine and registries see them. */
export type AnyGame = Game<unknown, unknown, unknown, unknown, unknown, unknown>
