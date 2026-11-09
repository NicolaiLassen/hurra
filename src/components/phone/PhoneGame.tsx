import { ArrowClockwiseIcon } from '@phosphor-icons/react'
import { useMemo } from 'react'
import { gameIconOf, usePhoneCalls } from '@/components/phone/calls'
import { GenericPlayerCard, GenericResult } from '@/components/phone/GenericCards'
import { Button } from '@/components/ui/button'
import { getGameModule } from '@/games/registry'
import type { PlayerViewProps, ResultViewProps } from '@/games/types'
import { gameMediaUrl } from '@/lib/media'
import { gamePointsOf, myAnswersOf, promptsOf } from '@/lib/stage'
import type { Player, Session, SessionGame, Snapshot } from '@/lib/types'
import { useLive } from '@/lib/useLive'

// A game's screens on the phone, through the registry only (docs/engine-v2.md,
// 6 and 7.1): each one fed from the live snapshot, with the phone's calls.

type GameProps = {
  snapshot: Snapshot
  session: Session
  game: SessionGame
  player: Player
  /** Whether the TV shows this game now. */
  onStage: boolean
}

/** What a live game's PlayerView and PlayerCard get on this phone. */
function usePlayerViewProps({ snapshot, session, game, player, onStage }: GameProps): PlayerViewProps {
  const { serverNow } = useLive()
  const { act, submit } = usePhoneCalls(game.id)
  const prompts = useMemo(() => promptsOf(snapshot, game.id), [snapshot, game.id])
  return {
    session,
    game,
    players: snapshot.players,
    publicState: game.public_state,
    prompts,
    serverNow,
    mediaUrl: gameMediaUrl,
    player,
    // The snapshot is in, so a missing view means none: say, joined after the start.
    view: snapshot.me?.views[game.id] ?? null,
    myAnswers: myAnswersOf(snapshot, game.id),
    onStage,
    act,
    submit,
  }
}

/** The game's full PlayerView: the main card's content, or the sheet's. */
export function GameView(props: GameProps & { scannedCode?: string; onScanHandled?: () => void }) {
  const viewProps = usePlayerViewProps(props)
  const module = getGameModule(props.game.game_type)
  if (!module) return <UnknownGame game={props.game} />
  return <module.PlayerView {...viewProps} scannedCode={props.scannedCode} onScanHandled={props.onScanHandled} />
}

/** The compact card while another game holds the main card: the game's own PlayerCard, or the generic one. */
export function GameCompactCard(props: GameProps & { open: () => void }) {
  const viewProps = usePlayerViewProps(props)
  const module = getGameModule(props.game.game_type)
  if (module?.PlayerCard) return <module.PlayerCard {...viewProps} open={props.open} />
  return <GenericPlayerCard game={props.game} icon={gameIconOf(props.game.game_type)} open={props.open} />
}

/** A finished game's result for this phone: the game's own ResultView, or the generic one. */
export function GameResult({ snapshot, session, game, player }: Omit<GameProps, 'onStage'>) {
  const module = getGameModule(game.game_type)
  const props: ResultViewProps = {
    session,
    game,
    player,
    players: snapshot.players,
    publicState: game.public_state,
    view: snapshot.me?.views[game.id] ?? null,
    gamePoints: gamePointsOf(snapshot, game.id),
  }
  return module?.ResultView ? <module.ResultView {...props} /> : <GenericResult {...props} />
}

/** A game this phone's app doesn't know yet, e.g. one added by a newer version: a reload fixes it. */
function UnknownGame({ game }: { game: SessionGame }) {
  return (
    <div className="grid gap-3">
      <p className="text-muted-foreground">
        {game.title} needs a newer version of this page. Reload to join in.
      </p>
      <Button variant="secondary" size="lg" className="justify-self-start" onClick={() => window.location.reload()}>
        <ArrowClockwiseIcon />
        Reload
      </Button>
    </div>
  )
}
