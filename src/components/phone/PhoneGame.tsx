import { ArrowClockwiseIcon } from '@phosphor-icons/react'
import { useMemo } from 'react'
import Contained from '@/components/Contained'
import { usePhoneCalls } from '@/components/phone/calls'
import { GenericPlayerCard, GenericResult } from '@/components/phone/GenericCards'
import { teamLine } from '@/components/phone/team'
import TeamLine from '@/components/phone/TeamLine'
import { Button } from '@/components/ui/button'
import { getGameModule } from '@/games/registry'
import type { PlayerViewProps, ResultViewProps } from '@/games/types'
import { gameMediaUrl } from '@/lib/media'
import { gamePointsOf, myAnswersOf, promptsOf } from '@/lib/stage'
import type { Player, Session, SessionGame, Snapshot } from '@/lib/types'
import { useLive } from '@/lib/useLive'

// A game's screens on the phone, through the registry only (docs/engine-v2.md,
// 6 and 7.1): each one fed from the live snapshot, with the phone's calls, and
// each in its own error boundary, so one game's screen can't take the phone
// home down (the other games, Standings and Show my code keep working).

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

/**
 * The game's full PlayerView: the main card's content, or the sheet's. In a
 * game played in teams, the team line stands over it (the core's, never the
 * game's). One wrapper either way, so the line coming or going never remounts
 * the game's screen.
 */
export function GameView(props: GameProps & { scannedCode?: string; onScanHandled?: () => void }) {
  const viewProps = usePlayerViewProps(props)
  const module = getGameModule(props.game.game_type)
  const team = teamLine(props.snapshot, props.game, props.player.id)
  if (!module) return <UnknownGame game={props.game} />
  return (
    <div className="grid grid-cols-1 gap-4">
      {team && <TeamLine team={team.team} words={team.words} />}
      <Contained key={roundOf(props.game)} fallback={<ScreenFailed game={props.game} />}>
        <module.PlayerView {...viewProps} scannedCode={props.scannedCode} onScanHandled={props.onScanHandled} />
      </Contained>
    </div>
  )
}

/** The compact card while another game holds the main card: the game's own PlayerCard, or the generic one (also if its own fails). */
export function GameCompactCard(props: GameProps & { open: () => void }) {
  const viewProps = usePlayerViewProps(props)
  const module = getGameModule(props.game.game_type)
  const generic = <GenericPlayerCard game={props.game} open={props.open} />
  if (!module?.PlayerCard) return generic
  return (
    <Contained key={roundOf(props.game)} fallback={generic}>
      <module.PlayerCard {...viewProps} open={props.open} />
    </Contained>
  )
}

/** A finished game's result for this phone: the game's own ResultView, or the generic one (also if its own fails). */
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
  const generic = <GenericResult {...props} />
  if (!module?.ResultView) return generic
  // Keyed here: the phone home's result cards aren't, so a failed one never sticks to the next game's result.
  return (
    <Contained key={roundOf(game)} fallback={generic}>
      <module.ResultView {...props} />
    </Contained>
  )
}

/** One round of one game: a new round tries a screen that failed again. */
const roundOf = (game: SessionGame) => `${game.id}:${game.started_at ?? ''}`

/** A game's own screen threw: the rest of the phone keeps working, and a reload tries it again. */
function ScreenFailed({ game }: { game: SessionGame }) {
  return (
    <div className="grid gap-3">
      <p className="text-paper-2">{game.title} didn't load on this phone. Reload to try again.</p>
      <Button variant="secondary" size="lg" className="justify-self-start" onClick={() => window.location.reload()}>
        <ArrowClockwiseIcon />
        Reload
      </Button>
    </div>
  )
}

/** A game this phone's app doesn't know yet, e.g. one added by a newer version: a reload fixes it. */
function UnknownGame({ game }: { game: SessionGame }) {
  return (
    <div className="grid gap-3">
      <p className="text-paper-2">{game.title} needs a newer version of this page. Reload to join in.</p>
      <Button variant="secondary" size="lg" className="justify-self-start" onClick={() => window.location.reload()}>
        <ArrowClockwiseIcon />
        Reload
      </Button>
    </div>
  )
}
