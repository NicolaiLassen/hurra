import { CaretRightIcon, CrownIcon, FlagCheckeredIcon } from '@phosphor-icons/react'
import Avatar from '@/components/Avatar'
import AvatarBadge from '@/components/AvatarBadge'
import { SectionHead } from '@/components/phone/Strap'
import { nameIn, pointsText, runningSince, winnersText } from '@/components/phone/text'
import type { ResultViewProps } from '@/games/types'
import type { SessionGame } from '@/lib/types'

/**
 * The section of a game without a PlayerCard of its own, while another game
 * holds the main card: its name on a paper tab, and a row that opens the full
 * view, with the time it went live. The same shape as the games' own sections.
 */
export function GenericPlayerCard({ game, open }: { game: SessionGame; open: () => void }) {
  const since = runningSince(game)
  return (
    <section aria-label={game.title} className="grid grid-cols-1 gap-3">
      <SectionHead tab={game.title} tone="plain" />
      <button
        type="button"
        onClick={open}
        className="flex min-h-14 w-full items-center gap-3 rounded-phone bg-overlay px-4 py-2.5 text-left transition-colors hover:bg-rule focus-visible:ring-3 focus-visible:ring-gold/50 focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] font-bold">Open to play</span>
          <span className="block text-sm text-paper-2">{since ? `Live ${since.toLowerCase()}` : 'Live'}</span>
        </span>
        <CaretRightIcon className="size-5 shrink-0 text-paper-2" />
      </button>
    </section>
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
              <Avatar name={nameIn(players, id)} playerId={id} className="size-12 ring-2 ring-ground" />
              {i === 0 && <AvatarBadge icon={CrownIcon} tone="gold" />}
            </span>
          ))}
        </span>
      ) : (
        <span className="grid size-12 shrink-0 place-items-center rounded-token bg-overlay text-paper-2">
          <FlagCheckeredIcon weight="duotone" className="size-6" />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-xl leading-tight font-extrabold text-balance">{who ? `${who} won` : `${game.title} is over`}</p>
        <p className="mt-0.5 text-paper-2">{mine === 0 ? "You didn't score in this one." : `You scored ${pointsText(mine)}.`}</p>
      </div>
    </div>
  )
}
