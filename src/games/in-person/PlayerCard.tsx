import { UsersThreeIcon } from '@phosphor-icons/react'
import type { InPersonGame } from '@/games/in-person/logic'
import type { PlayerCardProps } from '@/games/types'

/**
 * The round as a compact card on a phone while another game holds the main
 * card: its title and what to do, in one line. There is nothing more to open,
 * so it has no Open button.
 */
export default function PlayerCard({ game }: PlayerCardProps<InPersonGame>) {
  return (
    // min-w-0: a long title truncates instead of widening the card.
    <div className="flex min-w-0 items-center gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-confetti-teal/15 text-confetti-teal">
        <UsersThreeIcon weight="duotone" className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{game.title}</p>
        <p className="text-sm text-muted-foreground">Played in person. Show the host your code when you score.</p>
      </div>
    </div>
  )
}
