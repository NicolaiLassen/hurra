import { UsersThreeIcon } from '@phosphor-icons/react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import type { InPersonGame } from '@/games/in-person/logic'
import type { PlayerCardProps } from '@/games/types'

/**
 * The round as a compact card on a phone while another game holds the main
 * card: its title and what to do, in one line. A whole card, title and Live
 * badge included, like the phone's generic one. There is nothing more to
 * open, so it has no Open control.
 */
export default function PlayerCard({ game }: PlayerCardProps<InPersonGame>) {
  return (
    <Card>
      {/* grid-cols-1 and min-w-0: a long title truncates instead of widening the card. */}
      <CardContent className="grid grid-cols-1">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-confetti-teal/15 text-confetti-teal">
            <UsersThreeIcon weight="duotone" className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2">
              <span className="truncate text-lg leading-tight font-bold">{game.title}</span>
              <Badge className="shrink-0">Live</Badge>
            </p>
            <p className="text-sm text-muted-foreground">Played in person. Show the host your code when you score.</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
