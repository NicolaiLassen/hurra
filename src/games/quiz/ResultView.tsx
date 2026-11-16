import { CrownIcon, TrophyIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import Avatar from '@/components/Avatar'
import AvatarBadge from '@/components/AvatarBadge'
import { formatNumber, joinNames, type QuizGame } from '@/games/quiz/logic'
import { readView } from '@/games/quiz/read'
import type { ResultViewProps } from '@/games/types'
import { cn } from '@/lib/utils'

/** The finished quiz on a phone: "You won the quiz!", or "#4 of 45" with your points and who won. */
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
        <CrownIcon weight="fill" className="shrink-0 text-primary" />
        {joinNames(winners.map(nameOf))} won the quiz.
      </span>
    ) : (
      'Nobody scored this time.'
    )

  if (winners.includes(player.id)) {
    return (
      <Moment tone="gold" icon={<CrownIcon weight="duotone" className="mx-auto size-16 text-primary" />} points={points}>
        <p className="text-3xl font-black">You won the quiz!</p>
        {mine && <p className="text-muted-foreground">{mine}</p>}
        {others.length > 0 && <p className="text-sm font-semibold">A tie with {joinNames(others.map(nameOf))}.</p>}
      </Moment>
    )
  }

  if (view?.rank) {
    return (
      <Moment tone="plain" icon={<TrophyIcon weight="duotone" className="mx-auto size-14 text-primary" />} points={points}>
        <p className="text-4xl font-black tabular-nums">
          #{view.rank} <span className="text-2xl text-muted-foreground">of {players.length}</span>
        </p>
        <p className="text-muted-foreground">{mine}</p>
        <p className="font-semibold">{outcome}</p>
      </Moment>
    )
  }

  if (winners.length > 0) {
    const [first] = winners
    return (
      <div className="flex items-center gap-4 rounded-3xl bg-primary/10 p-5 ring-1 ring-primary/30">
        <span className="relative shrink-0">
          <Avatar name={nameOf(first)} className="size-14" />
          <AvatarBadge icon={CrownIcon} tone="gold" size="lg" />
        </span>
        <div className="min-w-0">
          <p className="text-2xl font-black text-balance">{joinNames(winners.map(nameOf))} won the quiz</p>
          <p className="text-muted-foreground">{view ? 'No quiz points for you this time.' : `${game.title} is over.`}</p>
        </div>
      </div>
    )
  }
  return <p className="text-lg text-muted-foreground">{game.title} is over. {outcome}</p>
}

/** One personal result: a tinted panel with a big icon, the words, and the points the quiz gave on the standings. */
function Moment({ tone, icon, points, children }: { tone: 'gold' | 'plain'; icon: ReactNode; points: number; children: ReactNode }) {
  return (
    <div
      className={cn(
        'space-y-3 rounded-3xl p-6 text-center ring-1',
        tone === 'gold' ? 'bg-primary/15 ring-primary/40' : 'bg-secondary/50 ring-white/10',
      )}
    >
      {icon}
      {children}
      {points > 0 && (
        <p className="mx-auto w-fit rounded-full bg-primary px-3 py-1 text-sm font-bold text-primary-foreground tabular-nums">
          +{points} point{points === 1 ? '' : 's'} on the standings
        </p>
      )}
    </div>
  )
}
