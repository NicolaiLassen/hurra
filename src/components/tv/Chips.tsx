import { CheckIcon, GameControllerIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { clockTime } from '@/components/tv/clock'
import { winnerNames } from '@/components/tv/scene'
import { getGameModule } from '@/games/registry'
import { listNames } from '@/lib/recap'
import type { Player, SessionGame } from '@/lib/types'
import { cn } from '@/lib/utils'

/** A chip on the TV: a solid raised square chip, its words at the TV's floor (docs/identity.md). */
const CHIP = 'flex h-12 min-w-0 items-center gap-3 rounded-chip bg-raised px-4 text-tv-floor short:h-11 short:gap-2.5 short:px-3.5'
/** Beside a label, in the rail: a line of text high. */
const SMALL_CHIP = 'flex h-8 min-w-0 items-center gap-1.5 rounded-chip bg-raised px-3 text-base short:h-7 short:text-sm'

/**
 * A live game that didn't fit as a card: its icon, title and the word Live.
 * The word says it, in paper: a guest colour is identity only, never a
 * status, and the gold is the screen's leader.
 */
export function LiveChip({ game, small = false }: { game: SessionGame; small?: boolean }) {
  const Icon = getGameModule(game.game_type)?.icon ?? GameControllerIcon
  return (
    <li className={small ? SMALL_CHIP : CHIP}>
      <Icon weight="duotone" className={cn('shrink-0 text-paper-2', small ? 'size-5' : 'size-7 short:size-6')} />
      <span className="min-w-0 truncate font-semibold">{game.title}</span>
      <span className="shrink-0 text-paper-2">Live</span>
    </li>
  )
}

/** A game that finished lately: "Beer pong, Freja won at 21:40", by the time it finished. */
export function FinishedChip({ game, players }: { game: SessionGame; players: readonly Player[] }) {
  const names = winnerNames(game, players)
  const at = game.finished_at !== null ? ` at ${clockTime(game.finished_at)}` : ''
  return (
    <li className={CHIP}>
      <CheckIcon weight="bold" className="size-6 shrink-0 text-paper-3 short:size-5" />
      <span className="min-w-0 truncate">
        <span className="font-semibold">{game.title}</span>
        <span className="text-paper-2">
          , {names.length > 0 ? `${listNames(names)} won` : 'over'}
          {at}
        </span>
      </span>
    </li>
  )
}

/** A wrapping row of chips. */
export function ChipRow({ className, children }: { className?: string; children: ReactNode }) {
  return <ul className={cn('flex min-w-0 flex-wrap gap-2.5', className)}>{children}</ul>
}
