import { GameControllerIcon } from '@phosphor-icons/react'
import { Suspense, type ReactNode } from 'react'
import Avatar from '@/components/Avatar'
import Contained from '@/components/Contained'
import { CARD } from '@/components/tv/look'
import { runningFor, topOfGame } from '@/components/tv/scene'
import { drawsOwn, useStatusProps } from '@/components/tv/status'
import { getGameModule } from '@/games/registry'
import type { TvStatusProps, TvStatusVariant } from '@/games/types'
import { listNames } from '@/lib/recap'
import type { SessionGame } from '@/lib/types'
import { useServerNow } from '@/lib/useLive'
import { cn } from '@/lib/utils'

/**
 * A game running beside the stage, as a card in the strip beside the podium:
 * its own (the module's TvStatus), or the generic one. A whole card either
 * way (docs/engine-v2.md, 6 and 7.2).
 */
export default function StatusCard({ game }: { game: SessionGame }) {
  const props = useStatusProps(game, 'card')
  return <GameStatus game={game} variant="card" fallback={<GenericStatus {...props} />} />
}

/**
 * A game's own TvStatus in `variant`, or `fallback` when the game doesn't draw
 * that variant. One that throws gives way to the fallback too, so one game
 * can't take the TV down.
 */
export function GameStatus({ game, variant, fallback }: { game: SessionGame; variant: TvStatusVariant; fallback: ReactNode }) {
  const props = useStatusProps(game, variant)
  const Own = getGameModule(game.game_type)?.TvStatus
  if (!Own || !drawsOwn(game.game_type, variant)) return fallback
  return (
    <Contained key={`${game.id}:${game.started_at}:${variant}`} fallback={fallback}>
      <Suspense fallback={fallback}>
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
        <Icon weight="duotone" className="size-7 shrink-0 text-paper-2 short:size-6" />
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
