import { CrownIcon, SkullIcon, TrophyIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import Avatar from '@/components/Avatar'
import AvatarBadge from '@/components/AvatarBadge'
import { knockoutsText, type EliminationGame } from '@/games/elimination/logic'
import { nameFrom, roundRoster } from '@/games/elimination/roster'
import type { ResultViewProps } from '@/games/types'
import { cn } from '@/lib/utils'

/**
 * A finished round on a phone: "You're the last one standing!", or "You're
 * out: Mads got you with “hum a tune”. Ana won.", or "Ana won" for those who
 * weren't dealt in. When the host ended it early, how it stood.
 */
export default function ResultView({ game, player, players, publicState, view, gamePoints }: ResultViewProps<EliminationGame>) {
  const nameOf = nameFrom(players)
  const winnerId = game.winners[0] ?? publicState?.winner ?? null
  const left = publicState ? roundRoster(players, publicState).standing.length : null
  const points = gamePoints[player.id] ?? 0
  const knockouts = view && 'knockouts' in view ? view.knockouts : 0

  /** Who won, or how it stood when the host ended it. */
  const outcome = winnerId ? (
    <span className="inline-flex items-center gap-1.5">
      <CrownIcon weight="fill" className="shrink-0 text-primary" />
      {nameOf(winnerId)} won.
    </span>
  ) : left !== null && left > 0 ? (
    `It ended with ${left} still standing.`
  ) : (
    `${game.title} is over.`
  )

  if (view?.status === 'winner' || (winnerId !== null && winnerId === player.id)) {
    return (
      <Moment tone="gold" icon={<CrownIcon weight="duotone" className="mx-auto size-16 text-primary" />} points={points}>
        <p className="text-3xl font-black">You're the last one standing!</p>
        <p className="text-muted-foreground">
          {knockouts > 0 ? `You knocked out ${knockouts} and nobody got you.` : 'Nobody got you.'}
        </p>
      </Moment>
    )
  }

  if (view?.status === 'out') {
    const how = view.method === 'catch' ? `caught you trying “${view.task}”` : `got you with “${view.task}”`
    return (
      <Moment tone="red" icon={<SkullIcon weight="duotone" className="mx-auto size-14 text-destructive" />} points={points}>
        <p className="text-2xl font-black">You're out</p>
        <p className="text-muted-foreground">
          {view.by ? `${nameOf(view.by)} ${how}.` : 'You left this round early.'}
          {knockouts > 0 && ` You knocked out ${knockouts} before that.`}
        </p>
        <p className="font-semibold">{outcome}</p>
      </Moment>
    )
  }

  if (view?.status === 'alive') {
    return (
      <Moment tone="gold" icon={<TrophyIcon weight="duotone" className="mx-auto size-14 text-primary" />} points={points}>
        <p className="text-2xl font-black">You were still standing</p>
        <p className="text-muted-foreground">
          {left !== null && left > 1 ? `The host ended it with ${left} still standing.` : 'The host ended it early.'}
          {knockouts > 0 && ` You knocked out ${knockouts}.`}
        </p>
      </Moment>
    )
  }

  // Not dealt in (joined later), or the view is still loading.
  return winnerId ? (
    <div className="flex items-center gap-4 rounded-3xl bg-primary/10 p-5 ring-1 ring-primary/30">
      <span className="relative shrink-0">
        <Avatar name={nameOf(winnerId)} className="size-14 text-lg" />
        <AvatarBadge icon={CrownIcon} tone="gold" size="lg" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-2xl font-black">{nameOf(winnerId)} won</p>
        <p className="text-muted-foreground">
          The last one standing, with {knockoutsText(publicState?.knockoutCounts[winnerId] ?? 0)}.
        </p>
      </div>
    </div>
  ) : (
    <p className="text-lg text-muted-foreground">{outcome}</p>
  )
}

/** One personal result: a tinted panel with a big icon, the words, and the points this round gave. */
function Moment({
  tone,
  icon,
  points,
  children,
}: {
  tone: 'gold' | 'red'
  icon: ReactNode
  points: number
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'space-y-3 rounded-3xl p-6 text-center ring-1',
        tone === 'gold' ? 'bg-primary/15 ring-primary/40' : 'bg-destructive/10 ring-destructive/30',
      )}
    >
      {icon}
      {children}
      {points > 0 && (
        <p className="mx-auto w-fit rounded-full bg-primary px-3 py-1 text-sm font-bold text-primary-foreground tabular-nums">
          +{points} point{points === 1 ? '' : 's'}
        </p>
      )}
    </div>
  )
}
