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

/**
 * Where the TV draws a game's status (docs/identity.md, The TV's frame):
 * - `card`: a whole card, its chrome, icon and title included, for the strip
 *   beside the podium. Every TvStatus draws it; it is the default.
 * - `band`: the game's one line in the band along the bottom of the TV while
 *   it runs in the background: its tab (src/components/tv/onAir.tsx has the
 *   parts) and a short status, at most a band line high and never wrapping.
 *   Without it the TV draws a plain line: the title and "Running since" with
 *   the time the game started.
 * - `strap`: the words in the paper strap at the top while the game holds the
 *   stage, plain text such as "Question 3 of 10". Without it the TV says how
 *   long the game has run, or "Final result".
 */
export type TvStatusVariant = 'card' | 'band' | 'strap'

/** A game's status on the TV while it runs (the strip's card, a band line, the strap's words). */
export type TvStatusProps<G extends AnyGame = AnyGame> = {
  game: SessionGame
  players: Player[]
  publicState: Parts<G>['publicState']
  gamePoints: Readonly<Record<PlayerId, number>>
  tallies: Readonly<Record<string, number>>
  serverNow: () => number
  /** What to draw: only `card` (the default) or a variant the TvStatus lists in its `variants`. */
  variant?: TvStatusVariant
}

/**
 * The variants a TvStatus draws besides the card, set on the component
 * (`TvStatus.variants = ['band', 'strap']`): the TV asks only for those, so
 * a game opts in one variant at a time and the core never names a game.
 */
export type TvStatusVariants = { variants?: readonly Exclude<TvStatusVariant, 'card'>[] }

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

/** A screen made with lazyScreen: `preload()` loads its file now. */
type Preloadable = { preload?: () => void }

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
  /**
   * The TV stage while live: `lazyScreen(() => import('./TvView'))`, so guests'
   * phones never download it and the TV loads it as it opens. Default: the
   * standings with "Now playing".
   */
  TvView?: ComponentType<TvViewProps<G>> & Preloadable
  /** The TV's final screen (with lazyScreen too). Default: TvView with finished, else a generic winners screen. */
  FinalTvView?: ComponentType<TvViewProps<G>> & Preloadable
  /**
   * The game's status on the TV while it runs (TvStatusVariant). The card,
   * drawn in place of the default (title, live time, this game's leader): its
   * chrome, icon and title, stacked as it is in the strip beside the podium.
   * With `variants`, also its line in the bottom band and its strap words.
   */
  TvStatus?: ComponentType<TvStatusProps<G>> & TvStatusVariants
  /** The settings editor; saves to game_settings (hosts only). */
  ConfigEditor?: ComponentType<ConfigEditorProps<G>>
  /** The PlayerView takes player codes; camera scans of player QR codes land here. */
  acceptsScans?: boolean
  /**
   * The game's own colour where the frame draws its tab (docs/identity.md,
   * Colour jobs). 'hunt': the hunt's pink with the popper's stripes, on the
   * news strap for its news, on the programme strap while it holds the stage
   * (pink words on ink over its winner's colour), and on a phone's tab for it.
   * Left out: gold while on air, paper otherwise.
   */
  accent?: 'hunt'
  /** How this game's announcements show while it is live on the TV stage. 'sound-only' when its TvView shows the moment itself. Default 'banner'. */
  stageBanners?: 'banner' | 'sound-only'
  /** Turns this game's section of a profile into badges. */
  profileBadges?: (data: Record<string, unknown>) => ProfileBadge[]
  /**
   * The players this game has knocked out, read from its public state (Last
   * one standing's). Asked only while the game is live. The core marks them
   * where it lists the party: the pink stripe on their token and the word Out
   * by their name (the phone's standings; the TV board and the host list
   * next). Left out: this game knocks nobody out.
   */
  knockedOut?: (publicState: Parts<G>['publicState']) => readonly PlayerId[]
  /**
   * The words on the paper strap beside this game's tab on a phone, while it
   * is live and holds the phone's main card: "Question 3 of 10". Null or left
   * out: where the game is ("On the TV", or since when it runs).
   */
  phoneStrap?: (publicState: Parts<G>['publicState']) => string | null
}

/** Type-checks a module against its own game, then widens it for the registry. */
export function defineGameModule<G extends AnyGame>(module: GameModule<G>): GameModule {
  return module as unknown as GameModule
}

/**
 * A TV screen that loads on demand, for TvView and FinalTvView. The TV loads
 * them all as it opens, so a deploy later in the evening can't take their files
 * away; one gone all the same reloads the TV into the new app (src/lib/lazyPage.ts).
 */
export { lazyScreen } from '@/lib/lazyPage'
