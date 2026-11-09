import { DeviceMobileIcon, GameControllerIcon } from '@phosphor-icons/react'
import { memo, Suspense, useMemo } from 'react'
import { LoadingPart } from '@/components/layout'
import Contained from '@/components/tv/Contained'
import FinalScreen from '@/components/tv/FinalScreen'
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
  const Icon = module?.icon ?? GameControllerIcon
  return (
    <div className="m-auto flex max-w-4xl flex-col items-center gap-6 text-center">
      <span className="grid size-32 place-items-center rounded-[2.25rem] bg-primary/15 ring-2 ring-primary/40 short:size-24">
        <Icon weight="duotone" className="size-16 text-primary short:size-12" />
      </span>
      <div>
        <p className="text-2xl font-semibold tracking-widest text-muted-foreground uppercase short:text-xl">Now playing</p>
        <h2 className="mt-2 text-7xl font-black tracking-tight short:text-6xl">{game.title}</h2>
        {module?.description && <p className="mt-4 text-3xl text-balance text-muted-foreground short:text-2xl">{module.description}</p>}
      </div>
      <p className="flex items-center gap-3 text-3xl font-semibold short:text-2xl">
        <DeviceMobileIcon weight="duotone" className="text-primary" />
        Play along on your phone
      </p>
    </div>
  )
}
