import { GameControllerIcon } from '@phosphor-icons/react'
import { Suspense, type ReactNode } from 'react'
import Avatar from '@/components/Avatar'
import Contained from '@/components/Contained'
import { CARD } from '@/components/tv/look'
import { clockTime } from '@/components/tv/clock'
import { topOfGame } from '@/components/tv/scene'
import { drawsOwn, useStatusProps } from '@/components/tv/status'
import { getGameModule } from '@/games/registry'
import type { TvStatusProps, TvStatusVariant } from '@/games/types'
import { listNames } from '@/lib/recap'
import type { SessionGame } from '@/lib/types'
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

/**
 * The default card: the title, the time it started (a time the database
 * holds, never "12 min"), and this game's leader. Its words at the TV's floor.
 */
function GenericStatus({ game, players, gamePoints }: TvStatusProps) {
  const Icon = getGameModule(game.game_type)?.icon ?? GameControllerIcon
  const top = topOfGame(gamePoints, players)
  const leaders = top.filter((row) => row.points === top[0]?.points)

  return (
    <section className={cn(CARD, 'grid min-w-0 grid-cols-1 gap-3 p-5 short:gap-2 short:p-4')}>
      <header className="flex min-w-0 items-center gap-3">
        <Icon weight="duotone" className="size-8 shrink-0 text-paper-2 short:size-7" />
        <h3 className="min-w-0 flex-1 truncate text-tv-tab font-bold short:text-tv-floor">{game.title}</h3>
      </header>
      {game.started_at !== null && (
        <p className="flex items-baseline gap-2.5 text-tv-floor text-paper-2">
          Running since <span className="tv-num text-paper">{clockTime(game.started_at)}</span>
        </p>
      )}
      {leaders.length > 0 ? (
        <p className="flex min-w-0 items-center gap-3">
          <Avatar name={leaders[0].player.name} playerId={leaders[0].player.id} className="size-10" />
          <span className="min-w-0 flex-1 truncate text-tv-floor font-semibold">
            {listNames(leaders.map((row) => row.player.name))} {leaders.length > 1 ? 'lead' : 'leads'}
          </span>
          <span className="shrink-0 tv-num text-tv-field text-paper">{leaders[0].points}</span>
        </p>
      ) : (
        <p className="text-tv-floor text-paper-2">No points yet</p>
      )}
    </section>
  )
}
