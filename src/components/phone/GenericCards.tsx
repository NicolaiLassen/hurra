import { CaretRightIcon, CrownIcon, FlagCheckeredIcon, type Icon } from '@phosphor-icons/react'
import Avatar from '@/components/Avatar'
import AvatarBadge from '@/components/AvatarBadge'
import { GameIcon } from '@/components/phone/GameCard'
import { nameIn, pointsText, winnersText } from '@/components/phone/text'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import type { ResultViewProps } from '@/games/types'
import type { SessionGame } from '@/lib/types'

/**
 * The compact card of a game without a PlayerCard of its own, while another
 * game holds the main card: its title, Live, and Open for the full view. The
 * same shape as the games' own cards.
 */
export function GenericPlayerCard({ game, icon, open }: { game: SessionGame; icon: Icon; open: () => void }) {
  return (
    <Card>
      <CardContent className="grid grid-cols-1">
        <button
          type="button"
          onClick={open}
          className="-m-2 flex items-center gap-3 rounded-2xl p-2 text-left transition-colors hover:bg-overlay/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <GameIcon icon={icon} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-lg leading-tight font-bold">{game.title}</span>
              <Badge className="shrink-0">Live</Badge>
            </span>
            <span className="block text-sm text-muted-foreground">Open to play</span>
          </span>
          <CaretRightIcon className="size-5 shrink-0 text-muted-foreground" />
        </button>
      </CardContent>
    </Card>
  )
}

/**
 * The result of a game without a ResultView of its own: who won (or "Quiz is
 * over" when nobody did) and what this phone's player scored in it.
 */
export function GenericResult({ game, player, players, gamePoints }: ResultViewProps) {
  const who = winnersText(game.winners, players, player.id)
  const faces = game.winners.slice(0, 3)
  const mine = gamePoints[player.id] ?? 0

  return (
    <div className="flex min-w-0 items-center gap-4">
      {faces.length > 0 ? (
        <span className="flex shrink-0 -space-x-3">
          {faces.map((id, i) => (
            <span key={id} className="relative">
              <Avatar name={nameIn(players, id)} className="size-12 ring-2 ring-card" />
              {i === 0 && <AvatarBadge icon={CrownIcon} tone="gold" />}
            </span>
          ))}
        </span>
      ) : (
        <span className="grid size-12 shrink-0 place-items-center rounded-token bg-secondary text-muted-foreground">
          <FlagCheckeredIcon weight="duotone" className="size-6" />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-xl leading-tight font-black text-balance">{who ? `${who} won` : `${game.title} is over`}</p>
        <p className="mt-0.5 text-muted-foreground">
          {mine === 0 ? "You didn't score in this one." : `You scored ${pointsText(mine)}.`}
        </p>
      </div>
    </div>
  )
}
