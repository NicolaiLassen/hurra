// The game module API (docs/engine-v2.md, section 6): a game's screens, paired
// with its logic (src/games/core/Game.ts). Game views import only React,
// Phosphor, motion, @/components/*, @/games/core/*, @/games/types, their own
// folder, @/lib/types (types only) and the UI-only helpers in src/lib.
// Everything else comes through props.
import type { Icon } from '@phosphor-icons/react'
import type { ComponentType } from 'react'
import type { AnswerPayload, AnyGame, Game, PlayerId } from '@/games/core/Game'
import type { FeedItem, Player, PromptState, ScoreRow, Session, SessionGame, SubmitResult } from '@/lib/types'

/** The types a game declares. */
type Parts<G> =
  G extends Game<infer State, infer Action, infer PublicState, infer PlayerView, infer Config, infer HostAction>
    ? { state: State; action: Action; publicState: PublicState; playerView: PlayerView; config: Config; hostAction: HostAction }
    : never

/** What every screen of a game gets. */
export type GameScreenProps<G extends AnyGame = AnyGame> = {
  session: Session
  game: SessionGame
  players: Player[]
  publicState: Parts<G>['publicState']
  /** This game's prompts (this round). */
  prompts: PromptState[]
  /** Now by the database clock: use it for every countdown. */
  serverNow: () => number
  /** The public URL of a game-media path. Phones use 'thumb' (with loading="lazy"); the TV uses 'full'. */
  mediaUrl: (path: string, size?: 'full' | 'thumb') => string
}

export type PlayerViewProps<G extends AnyGame = AnyGame> = GameScreenProps<G> & {
  /** The player holding this phone. */
  player: Player
  /** Their private view: undefined while loading, null if they have none (e.g. joined later). */
  view: Parts<G>['playerView'] | null | undefined
  /** Their own answers this round, by prompt key, read back after a reload. */
  myAnswers: Readonly<Record<string, AnswerPayload>>
  /** Whether this game is on the TV. */
  onStage: boolean
  /**
   * Sends a move to the engine; rejects with the game's message. The view
   * shows a refusal as a toast: the phone's wrapper doesn't.
   */
  act: (action: Parts<G>['action']) => Promise<void>
  /**
   * Answers a prompt straight to the database; rejects with the reason ("Too
   * late, answers are closed"), which the view shows as a toast.
   */
  submit: (key: string, answer: AnswerPayload) => Promise<SubmitResult>
  /** For games with acceptsScans: a player code scanned with the camera app. Call onScanHandled once used. */
  scannedCode?: string
  onScanHandled?: () => void
}

/** A compact card for a game that runs while another holds the main card. `open` shows the full PlayerView. */
export type PlayerCardProps<G extends AnyGame = AnyGame> = PlayerViewProps<G> & { open: () => void }

/** A finished game's result on a phone: "You won", "Mads won. Sofie caught you". */
export type ResultViewProps<G extends AnyGame = AnyGame> = {
  session: Session
  game: SessionGame
  player: Player
  players: Player[]
  publicState: Parts<G>['publicState']
  view: Parts<G>['playerView'] | null | undefined
  gamePoints: Readonly<Record<PlayerId, number>>
}

export type HostViewProps<G extends AnyGame = AnyGame> = GameScreenProps<G> & {
  /** The full state (hosts only): undefined while loading, null before the first start. */
  state: Parts<G>['state'] | null | undefined
  /** The settings this round started with (hosts only), e.g. the quiz's right answers. */
  config: Parts<G>['config'] | null | undefined
  /** Answers in so far, by unrevealed prompt key. */
  tallies: Readonly<Record<string, number>>
  gamePoints: Readonly<Record<PlayerId, number>>
  /**
   * Sends a host action. `close` names prompts to close first, so the action
   * sees their final answers. Resolves on success and on a skip (a stale
   * action); disable the button while it is pending.
   */
  act: (action: Parts<G>['hostAction'], options?: { close?: string[] }) => Promise<void>
}

export type TvViewProps<G extends AnyGame = AnyGame> = GameScreenProps<G> & {
  /** The day's standings. */
  scores: ScoreRow[]
  gamePoints: Readonly<Record<PlayerId, number>>
  tallies: Readonly<Record<string, number>>
  /** This game's newest room-wide announcements. */
  feed: FeedItem[]
  /** True while the TV shows this game's final screen. */
  finished: boolean
}

/** A small card in the TV rail for a game running in the background. */
export type TvStatusProps<G extends AnyGame = AnyGame> = {
  game: SessionGame
  players: Player[]
  publicState: Parts<G>['publicState']
  gamePoints: Readonly<Record<PlayerId, number>>
  tallies: Readonly<Record<string, number>>
  serverNow: () => number
}

export type ConfigEditorProps<G extends AnyGame = AnyGame> = {
  config: Parts<G>['config']
  onChange: (config: Parts<G>['config']) => void
  session: Session
  game: SessionGame
  /** The party's players, e.g. to pick who is in a picture. */
  players: Player[]
  /** Re-encodes and uploads to the public game-media bucket (hosts only, 5.8). */
  media: { upload: (file: File) => Promise<string>; url: (path: string, size?: 'full' | 'thumb') => string }
}

/** A badge on a player's profile, shown on phones, the host page and the TV. */
export type ProfileBadge = { icon: Icon; label: string; tone?: 'gold' | 'pink' | 'teal' | 'violet' }

export type GameModule<G extends AnyGame = AnyGame> = {
  logic: G
  name: string
  description: string
  /** A Phosphor icon for lists, title cards and recap chapters. Default: GameControllerIcon. */
  icon?: Icon
  /** The full game on a phone. Draws its content only: the phone draws the card and its header. */
  PlayerView: ComponentType<PlayerViewProps<G>>
  /**
   * The compact card while another game holds the main card. Default: title,
   * Live and Open. A whole card, drawn in place of the default: its chrome
   * (`Card`), icon, title and Live badge, and a header that calls `open` when
   * there is more to see. The phone stacks it as it is.
   */
  PlayerCard?: ComponentType<PlayerCardProps<G>>
  /** The phone's result card once finished. Default: "Mads won X" and my points. */
  ResultView?: ComponentType<ResultViewProps<G>>
  /** The game's panel in the host control room. */
  HostView?: ComponentType<HostViewProps<G>>
  /** The TV stage while live (load it lazily). Default: the standings with "Now playing". */
  TvView?: ComponentType<TvViewProps<G>>
  /** The TV's final screen (lazily). Default: TvView with finished, else a generic winners screen. */
  FinalTvView?: ComponentType<TvViewProps<G>>
  /**
   * The TV rail card while in the background. Default: title, live time, this
   * game's leader. A whole card, drawn in place of the default: its chrome, icon
   * and title. The TV stacks it as it is, in the rail or the strip.
   */
  TvStatus?: ComponentType<TvStatusProps<G>>
  /** The settings editor; saves to game_settings (hosts only). */
  ConfigEditor?: ComponentType<ConfigEditorProps<G>>
  /** The PlayerView takes player codes; camera scans of player QR codes land here. */
  acceptsScans?: boolean
  /** How this game's announcements show while it is live on the TV stage. 'sound-only' when its TvView shows the moment itself. Default 'banner'. */
  stageBanners?: 'banner' | 'sound-only'
  /** Turns this game's section of a profile into badges. */
  profileBadges?: (data: Record<string, unknown>) => ProfileBadge[]
}

/** Type-checks a module against its own game, then widens it for the registry. */
export function defineGameModule<G extends AnyGame>(module: GameModule<G>): GameModule {
  return module as unknown as GameModule
}
