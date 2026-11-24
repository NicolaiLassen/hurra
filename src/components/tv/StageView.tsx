import { DeviceMobileIcon } from '@phosphor-icons/react'
import { memo, Suspense, useMemo } from 'react'
import { LoadingPart } from '@/components/layout'
import Contained from '@/components/Contained'
import FinalScreen from '@/components/tv/FinalScreen'
import { Tab } from '@/components/tv/onAir'
import { getGameModule } from '@/games/registry'
import type { TvViewProps } from '@/games/types'
import { gameMediaUrl } from '@/lib/media'
import { gamePointsOf, promptsOf, talliesOf } from '@/lib/stage'
import type { SessionGame } from '@/lib/types'
import { useLive } from '@/lib/useLive'

/**
 * The game on the stage (docs/engine-v2.md, 7.2). Live: the module's TvView.
 * Finished, inside its 3 minutes: the module's FinalTvView, else its TvView
 * with `finished`, else the generic final screen. A screen that throws, or
 * whose lazy chunk doesn't load, gives way to a plain card, and the party
 * goes on.
 */
function StageView({ game, finished }: { game: SessionGame; finished: boolean }) {
  const { snapshot, tallies, serverNow } = useLive()
  const props = useMemo<TvViewProps | null>(() => {
    const session = snapshot?.session
    if (!snapshot || !session) return null
    return {
      session,
      game,
      players: snapshot.players,
      publicState: game.public_state,
      prompts: promptsOf(snapshot, game.id),
      serverNow,
      mediaUrl: gameMediaUrl,
      scores: snapshot.standings,
      gamePoints: gamePointsOf(snapshot, game.id),
      tallies: talliesOf(tallies, game.id),
      feed: snapshot.feed.filter((item) => item.game_id === game.id && item.audience === null),
      finished,
    }
  }, [snapshot, tallies, serverNow, game, finished])
  if (!props) return null

  const module = getGameModule(game.game_type)
  const View = finished ? (module?.FinalTvView ?? module?.TvView) : module?.TvView
  const fallback = finished ? <FinalScreen {...props} /> : <NowPlaying game={game} />
  if (!View) return fallback
  return (
    <Contained key={`${game.id}:${game.started_at}:${finished}`} fallback={fallback}>
      {/* While the game's screen downloads, the TV waits behind the loader. */}
      <Suspense fallback={<LoadingPart />}>
        <View {...props} />
      </Suspense>
    </Contained>
  )
}

export default memo(StageView)

/** A live game whose screen failed: what it is, and where to play it. */
function NowPlaying({ game }: { game: SessionGame }) {
  const module = getGameModule(game.game_type)
  return (
    <div className="m-auto flex max-w-[80rem] flex-col items-start gap-8 short:gap-6">
      <Tab size="strap">Now playing</Tab>
      <h2 className="wide text-tv-question text-paper short:text-tv-answer">{game.title}</h2>
      {module?.description && <p className="text-tv-name text-balance text-paper-2 short:text-tv-band">{module.description}</p>}
      <p className="flex items-center gap-4 text-tv-name font-semibold text-paper short:text-tv-band">
        <DeviceMobileIcon weight="fill" className="shrink-0 text-paper-2" />
        Play along on your phone
      </p>
    </div>
  )
}
