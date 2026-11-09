import { CheckCircleIcon, GameControllerIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { winnerNames } from '@/components/tv/scene'
import { getGameModule } from '@/games/registry'
import { listNames } from '@/lib/recap'
import type { Player, SessionGame } from '@/lib/types'
import { cn } from '@/lib/utils'

const CHIP = 'flex h-10 min-w-0 items-center gap-2 rounded-full bg-card/80 px-4 text-lg ring-1 ring-foreground/10 backdrop-blur short:h-9 short:text-base'
/** Beside a label, in the rail: a line of text high. */
const SMALL_CHIP = 'flex h-8 min-w-0 items-center gap-1.5 rounded-full bg-card/80 px-3 text-base ring-1 ring-foreground/10 backdrop-blur short:h-7 short:text-sm'

/** A live game that didn't fit as a card: its icon, title and Live. */
export function LiveChip({ game, small = false }: { game: SessionGame; small?: boolean }) {
  const Icon = getGameModule(game.game_type)?.icon ?? GameControllerIcon
  return (
    <li className={small ? SMALL_CHIP : CHIP}>
      <Icon weight="duotone" className="size-5 shrink-0 text-primary" />
      <span className="min-w-0 truncate font-semibold">{game.title}</span>
      <span className="flex shrink-0 items-center gap-1.5 text-confetti-teal">
        <span aria-hidden className="size-2 rounded-full bg-confetti-teal" />
        Live
      </span>
    </li>
  )
}

/** A game that finished lately: "Beer pong · Freja won". */
export function FinishedChip({ game, players }: { game: SessionGame; players: readonly Player[] }) {
  const names = winnerNames(game, players)
  return (
    <li className={CHIP}>
      <CheckCircleIcon weight="fill" className="size-5 shrink-0 text-confetti-teal" />
      <span className="min-w-0 truncate">
        <span className="font-semibold">{game.title}</span>
        <span className="text-muted-foreground"> · {names.length > 0 ? `${listNames(names)} won` : 'over'}</span>
      </span>
    </li>
  )
}

/** A wrapping row of chips. */
export function ChipRow({ className, children }: { className?: string; children: ReactNode }) {
  return <ul className={cn('flex min-w-0 flex-wrap gap-2', className)}>{children}</ul>
}
