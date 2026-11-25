import { CassetteTapeIcon, CrownIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import Avatar from '@/components/Avatar'
import AvatarBadge from '@/components/AvatarBadge'
import { nameIn, ordinal } from '@/components/phone/text'
import { joinNames, type SoundtrackGame } from '@/games/soundtrack/logic'
import { readView } from '@/games/soundtrack/read'
import type { ResultViewProps } from '@/games/types'

/**
 * Lydspor once crowned, on a phone (spec 4.12): "You won Lydspor.", or "You
 * placed 4th in Lydspor with 21 Lydspor points.", each with what it paid on
 * the night board; "You sat this one out."; or who won, for a guest with no
 * answers. Solid surfaces; gold only for the winner.
 */
export default function ResultView({ game, player, players, view: rawView, gamePoints }: ResultViewProps<SoundtrackGame>) {
  const view = readView(rawView)
  const final = view?.final ?? null
  const paid = final?.paid ?? gamePoints[player.id] ?? 0
  const points = (count: number) => `${count} Lydspor ${count === 1 ? 'point' : 'points'}`
  const credit = final && final.credit > 0 ? `Your own photo counted as ${final.credit} of them.` : null

  if (view?.sittingOut) return <p className="text-lg text-paper-2">You sat this one out.</p>

  if (final && game.winners.includes(player.id)) {
    const others = game.winners.filter((id) => id !== player.id)
    return (
      <Moment
        mark={
          <span className="relative">
            <Avatar name={player.name} playerId={player.id} className="size-16" />
            <AvatarBadge icon={CrownIcon} tone="gold" size="lg" />
          </span>
        }
        paid={paid}
      >
        <p className="text-phone-head leading-tight font-extrabold">
          You <span className="text-gold">won</span> Lydspor.
        </p>
        <p className="text-paper-2">
          {points(final.points)}.{credit && ` ${credit}`}
        </p>
        {others.length > 0 && <p className="text-sm font-semibold">A tie with {joinNames(others.map((id) => nameIn(players, id)))}.</p>}
      </Moment>
    )
  }

  if (final) {
    return (
      <Moment mark={<CassetteTapeIcon weight="duotone" className="size-10 text-paper-2" />} paid={paid}>
        <p className="text-xl leading-tight font-extrabold text-balance">
          You placed {ordinal(final.place)} in Lydspor with {points(final.points)}.
        </p>
        {credit && <p className="text-paper-2">{credit}</p>}
      </Moment>
    )
  }

  const winners = game.winners.map((id) => nameIn(players, id))
  return (
    <p className="text-lg text-paper-2">
      {game.title} is over. {winners.length > 0 ? `${joinNames(winners)} won.` : 'Nobody scored this time.'}
    </p>
  )
}

/** One personal result on a solid raised panel: a mark, the words, and what Lydspor paid on the night board. */
function Moment({ mark, paid, children }: { mark: ReactNode; paid: number; children: ReactNode }) {
  return (
    <div className="grid justify-items-start gap-3 rounded-phone bg-raised p-5">
      {mark}
      <div className="grid gap-1">{children}</div>
      {paid > 0 && <p className="w-fit rounded-chip bg-overlay px-2.5 py-1 text-sm font-bold">+{paid} on the night board</p>}
    </div>
  )
}
