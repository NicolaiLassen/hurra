import { CrownIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import Avatar from '@/components/Avatar'
import AvatarBadge from '@/components/AvatarBadge'
import { ordinal } from '@/components/phone/text'
import { formatNumber, joinNames, type QuizGame } from '@/games/quiz/logic'
import { KeyChips } from '@/games/quiz/phoneParts'
import { readView } from '@/games/quiz/read'
import type { ResultViewProps } from '@/games/types'

/**
 * The finished quiz on a phone: "You won the quiz.", or "4th of 45" with your
 * points and who won. Solid surfaces; gold only for the winner.
 */
export default function ResultView({ game, player, players, view: rawView, gamePoints }: ResultViewProps<QuizGame>) {
  const view = readView(rawView)
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? 'A guest'
  const winners = game.winners
  const others = winners.filter((id) => id !== player.id)
  const points = gamePoints[player.id] ?? 0
  const mine = view ? `${formatNumber(view.quizPoints)} quiz points, ${view.right} right` : null
  const outcome =
    winners.length > 0 ? (
      <span className="inline-flex items-center gap-1.5">
        <CrownIcon weight="fill" className="shrink-0 text-gold" />
        {joinNames(winners.map(nameOf))} won the quiz.
      </span>
    ) : (
      'Nobody scored this time.'
    )

  if (winners.includes(player.id)) {
    return (
      <Moment
        icon={
          <span className="relative">
            <Avatar name={player.name} playerId={player.id} className="size-16" />
            <AvatarBadge icon={CrownIcon} tone="gold" size="lg" />
          </span>
        }
        points={points}
      >
        <p className="text-phone-head leading-tight font-extrabold">
          You <span className="text-gold">won</span> the quiz.
        </p>
        {mine && <p className="text-paper-2">{mine}</p>}
        {others.length > 0 && <p className="text-sm font-semibold">A tie with {joinNames(others.map(nameOf))}.</p>}
      </Moment>
    )
  }

  if (view?.rank) {
    return (
      <Moment icon={<KeyChips />} points={points}>
        <p className="flex items-baseline gap-2.5">
          <span className="text-phone-place leading-none wide">{ordinal(view.rank)}</span>
          <span className="text-lg font-semibold text-paper-2">of {players.length}</span>
        </p>
        <p className="text-paper-2">{mine}</p>
        <p className="font-semibold">{outcome}</p>
      </Moment>
    )
  }

  if (winners.length > 0) {
    const [first] = winners
    return (
      <div className="flex items-center gap-4 rounded-phone bg-raised p-5">
        <span className="relative shrink-0">
          <Avatar name={nameOf(first)} playerId={first} className="size-14" />
          <AvatarBadge icon={CrownIcon} tone="gold" size="lg" />
        </span>
        <div className="min-w-0">
          <p className="text-xl leading-tight font-extrabold text-balance">{joinNames(winners.map(nameOf))} won the quiz</p>
          <p className="mt-0.5 text-paper-2">{view ? 'No quiz points for you this time.' : `${game.title} is over.`}</p>
        </div>
      </div>
    )
  }
  return (
    <p className="text-lg text-paper-2">
      {game.title} is over. {outcome}
    </p>
  )
}

/** One personal result on a solid raised panel: a mark, the words, and the points the quiz gave on the standings. */
function Moment({ icon, points, children }: { icon: ReactNode; points: number; children: ReactNode }) {
  return (
    <div className="grid justify-items-start gap-3 rounded-phone bg-raised p-5">
      {icon}
      <div className="grid gap-1">{children}</div>
      {points > 0 && (
        <p className="w-fit rounded-chip bg-overlay px-2.5 py-1 text-sm font-bold">
          +{points} point{points === 1 ? '' : 's'} on the standings
        </p>
      )}
    </div>
  )
}
