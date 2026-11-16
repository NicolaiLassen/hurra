import { GameControllerIcon } from '@phosphor-icons/react'
import { Suspense } from 'react'
import Avatar from '@/components/Avatar'
import Contained from '@/components/Contained'
import { CARD } from '@/components/tv/look'
import { runningFor, topOfGame } from '@/components/tv/scene'
import { getGameModule } from '@/games/registry'
import type { TvStatusProps } from '@/games/types'
import { listNames } from '@/lib/recap'
import { gamePointsOf, talliesOf } from '@/lib/stage'
import type { SessionGame } from '@/lib/types'
import { useLive, useServerNow } from '@/lib/useLive'
import { cn } from '@/lib/utils'

/**
 * A game running beside the stage: its own card (the module's TvStatus), or the
 * generic one. A whole card either way, stacked as it is in the rail or the
 * strip (docs/engine-v2.md, 6 and 7.2). A card that throws gives way to the
 * generic one, so one game can't take the TV down.
 */
export default function StatusCard({ game }: { game: SessionGame }) {
  const { snapshot, tallies, serverNow } = useLive()
  const props: TvStatusProps = {
    game,
    players: snapshot?.players ?? [],
    publicState: game.public_state,
    gamePoints: snapshot ? gamePointsOf(snapshot, game.id) : {},
    tallies: talliesOf(tallies, game.id),
    serverNow,
  }
  const generic = <GenericStatus {...props} />
  const Own = getGameModule(game.game_type)?.TvStatus
  if (!Own) return generic
  return (
    <Contained key={game.id} fallback={generic}>
      <Suspense fallback={generic}>
        <Own {...props} />
      </Suspense>
    </Contained>
  )
}

/** The default card: the title, how long it has run, and this game's leader. */
function GenericStatus({ game, players, gamePoints }: TvStatusProps) {
  const now = useServerNow(30_000)
  const Icon = getGameModule(game.game_type)?.icon ?? GameControllerIcon
  const top = topOfGame(gamePoints, players)
  const leaders = top.filter((row) => row.points === top[0]?.points)

  return (
    <section className={cn(CARD, 'grid min-w-0 grid-cols-1 gap-3 p-5 short:gap-2 short:p-4')}>
      <header className="flex min-w-0 items-center gap-2.5">
        <Icon weight="duotone" className="size-7 shrink-0 text-primary short:size-6" />
        <h3 className="min-w-0 flex-1 truncate text-xl font-bold short:text-lg">{game.title}</h3>
        {game.started_at !== null && (
          <span className="shrink-0 text-lg text-muted-foreground tabular-nums short:text-base">
            {runningFor(now - game.started_at)}
          </span>
        )}
      </header>
      {leaders.length > 0 ? (
        <p className="flex min-w-0 items-center gap-2.5">
          <Avatar name={leaders[0].player.name} className="size-8" />
          <span className="min-w-0 flex-1 truncate text-lg font-semibold">
            {listNames(leaders.map((row) => row.player.name))} {leaders.length > 1 ? 'lead' : 'leads'}
          </span>
          <span className="shrink-0 text-xl font-black text-primary tabular-nums">{leaders[0].points}</span>
        </p>
      ) : (
        <p className="text-lg text-muted-foreground">No points yet</p>
      )}
    </section>
  )
}
