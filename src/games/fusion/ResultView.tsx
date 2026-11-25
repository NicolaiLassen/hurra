import { CrownIcon } from '@phosphor-icons/react'
import Avatar from '@/components/Avatar'
import AvatarBadge from '@/components/AvatarBadge'
import type { FusionGame } from '@/games/fusion/logic'
import { resultWords } from '@/games/fusion/phoneLines'
import { readPublic, readView, revealedCount } from '@/games/fusion/shapes'
import { nameOf } from '@/games/fusion/view'
import type { ResultViewProps } from '@/games/types'

/**
 * The phone's result once fusion is over: "You have the sharpest eye.", or
 * who did, with how you did on a raised card. Solid surfaces; gold only for
 * the crown.
 */
export default function ResultView({ game, player, players, publicState, view: rawView, gamePoints }: ResultViewProps<FusionGame>) {
  const pub = readPublic(publicState)
  const view = readView(rawView)
  const winners = game.winners
  const others = winners.filter((id) => id !== player.id)
  const points = view?.points ?? gamePoints[player.id] ?? 0
  // A save from the background version has no rank in the view: its place in the top five, if there.
  const rank = view?.rank ?? (pub?.top.find((row) => row.playerId === player.id)?.rank || null)
  const words = resultWords({
    title: game.title,
    winners: (winners.includes(player.id) ? others : winners).map((id) => nameOf(players, id)),
    meWon: winners.includes(player.id),
    points,
    both: Object.values(view?.hits ?? {}).filter((hits) => hits >= 2).length,
    revealed: pub ? revealedCount(pub) : 0,
    total: pub?.pictures.length ?? 0,
    rank: points > 0 ? rank : null,
  })

  if (words.kind === 'won') {
    return (
      <div className="grid grid-cols-1 justify-items-start gap-3 rounded-phone bg-raised p-5">
        <span className="relative">
          <Avatar name={player.name} playerId={player.id} className="size-16" />
          <AvatarBadge icon={CrownIcon} tone="gold" size="lg" />
        </span>
        <div className="grid grid-cols-1 gap-1">
          <p className="text-phone-head leading-tight font-extrabold text-balance">{words.head}</p>
          <p className="text-paper-2">{words.line}</p>
          {words.tie && <p className="text-sm font-semibold">{words.tie}</p>}
        </div>
      </div>
    )
  }

  if (words.kind === 'nobody') return <p className="text-lg text-paper-2">{words.head}</p>

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex items-center gap-4">
        <span className="flex shrink-0 gap-2">
          {winners.slice(0, 3).map((id) => (
            <span key={id} className="relative">
              <Avatar name={nameOf(players, id)} playerId={id} className="size-12" />
              <AvatarBadge icon={CrownIcon} tone="gold" size="md" />
            </span>
          ))}
        </span>
        <p className="min-w-0 text-xl leading-tight font-extrabold text-balance">{words.head}</p>
      </div>
      <div className="grid grid-cols-1 gap-1 rounded-phone bg-raised p-5">
        <p className="text-phone-head leading-tight font-extrabold">{words.scored}</p>
        <p className="text-paper-2">{words.detail}</p>
      </div>
    </div>
  )
}
