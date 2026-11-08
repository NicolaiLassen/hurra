import type { Icon } from '@phosphor-icons/react'
import type { ComponentType } from 'react'
import type { AnyGame, Game } from '@/games/core/Game'
import type { Player, ScoreRow, Session, SessionGame } from '@/lib/types'

/** The types a game plugin declares: its state, actions, views and config. */
type Parts<G> =
  G extends Game<infer State, infer Action, infer PublicState, infer PlayerView, infer Config>
    ? { state: State; action: Action; publicState: PublicState; playerView: PlayerView; config: Config }
    : never

export type PlayerViewProps<G extends AnyGame = AnyGame> = {
  session: Session
  game: SessionGame
  /** The player holding this phone. */
  player: Player
  players: Player[]
  publicState: Parts<G>['publicState']
  /** This player's private view: undefined while loading, null if they have none (e.g. joined later). */
  view: Parts<G>['playerView'] | null | undefined
  /** Sends an action to the game's server logic; rejects with the game's message if it breaks a rule. */
  act: (action: Parts<G>['action']) => Promise<void>
  /**
   * For games with `acceptsScans`: a player code this phone scanned with its
   * camera app (the QR opened /p/<code>). Treat it like a scan inside the game,
   * then call `onScanHandled` so it's only used once.
   */
  scannedCode?: string
  onScanHandled?: () => void
}

export type HostViewProps<G extends AnyGame = AnyGame> = {
  session: Session
  game: SessionGame
  players: Player[]
  /** The game's full state (hosts only): undefined while loading, null before the game starts. */
  state: Parts<G>['state'] | null | undefined
}

export type ConfigEditorProps<G extends AnyGame = AnyGame> = {
  config: Parts<G>['config']
  onChange: (config: Parts<G>['config']) => void
}

export type TvViewProps<G extends AnyGame = AnyGame> = {
  session: Session
  game: SessionGame
  players: Player[]
  /** Public data only: the TV is in the room for everyone to see. */
  publicState: Parts<G>['publicState']
  /** The day's scoreboard. */
  scores: ScoreRow[]
}

/** A badge on a player's profile, shown on phones, the host page and the TV. */
export type ProfileBadge = { icon: Icon; label: string; tone?: 'gold' | 'pink' | 'teal' | 'violet' }

/** A game plugin's screens, paired with its server logic (see src/games/core/Game.ts). */
export type GameModule<G extends AnyGame = AnyGame> = {
  logic: G
  name: string
  description: string
  /** Shown on each player's phone while the game is live. */
  PlayerView: ComponentType<PlayerViewProps<G>>
  /** Shown on the host's session page while the game is live. */
  HostView?: ComponentType<HostViewProps<G>>
  /** Takes over the TV scoreboard while the game is live; the header, join card and announcements stay. */
  TvView?: ComponentType<TvViewProps<G>>
  /** Lets the host edit the game's settings (session_games.config) before starting it. */
  ConfigEditor?: ComponentType<ConfigEditorProps<G>>
  /**
   * The PlayerView takes player codes (e.g. to knock someone out). Then a guest
   * who scans another player's QR with the phone's camera app lands in the
   * live game with that code (`scannedCode`), instead of on the player card.
   */
  acceptsScans?: boolean
  /** Turns this game's section of a player's profile into badges. */
  profileBadges?: (data: Record<string, unknown>) => ProfileBadge[]
}

/** Type-checks a module against its own game, then widens it for the registry. */
export function defineGameModule<G extends AnyGame>(module: GameModule<G>): GameModule {
  return module as unknown as GameModule
}
