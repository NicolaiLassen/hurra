import { CrownIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import Avatar from '@/components/Avatar'
import AvatarBadge from '@/components/AvatarBadge'
import { clockTime } from '@/components/phone/text'
import { knockoutsText, type EliminationGame } from '@/games/elimination/logic'
import { nameFrom, roundRoster } from '@/games/elimination/roster'
import type { ResultViewProps } from '@/games/types'

/**
 * A finished round on a phone: "You're the last one standing.", or "You're
 * out. Mads got you with “hum a tune” at 22:41. Ana won.", or "Ana won" for
 * those who weren't dealt in. When the host ended it early, how it stood.
 * Solid surfaces; gold only for the winner, the hunt's pink for Out.
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
      <CrownIcon weight="fill" className="shrink-0 text-gold" />
      {nameOf(winnerId)} won.
    </span>
  ) : left !== null && left > 0 ? (
    `It ended with ${left} still standing.`
  ) : (
    `${game.title} is over.`
  )

  if (view?.status === 'winner' || (winnerId !== null && winnerId === player.id)) {
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
          You're the <span className="text-gold">last one standing</span>.
        </p>
        <p className="text-paper-2">{knockouts > 0 ? `You knocked out ${knockouts} and nobody got you.` : 'Nobody got you.'}</p>
      </Moment>
    )
  }

  if (view?.status === 'out') {
    const how = view.method === 'catch' ? `caught you trying “${view.task}”` : `got you with “${view.task}”`
    const mine = publicState?.feed?.find((k) => k.target === player.id)
    const at = mine ? ` at ${clockTime(mine.at)}` : ''
    return (
      <Moment icon={<Avatar name={player.name} playerId={player.id} out className="size-16" />} points={points}>
        <p className="text-phone-head leading-tight font-extrabold">
          You're <span className="text-pink">out</span>.
        </p>
        <p className="text-paper-2">
          {view.by ? `${nameOf(view.by)} ${how}${at}.` : 'You left this round early.'}
          {knockouts > 0 && ` You knocked out ${knockouts} before that.`}
        </p>
        <p className="font-semibold">{outcome}</p>
      </Moment>
    )
  }

  if (view?.status === 'alive') {
    return (
      <Moment icon={null} points={points}>
        <p className="text-phone-head leading-tight font-extrabold">You were still standing.</p>
        <p className="text-paper-2">
          {left !== null && left > 1 ? `The host ended it with ${left} still standing.` : 'The host ended it early.'}
          {knockouts > 0 && ` You knocked out ${knockouts}.`}
        </p>
      </Moment>
    )
  }

  // Not dealt in (joined later), or the view is still loading.
  return winnerId ? (
    <div className="flex items-center gap-4 rounded-phone bg-raised p-5">
      <span className="relative shrink-0">
        <Avatar name={nameOf(winnerId)} playerId={winnerId} className="size-14" />
        <AvatarBadge icon={CrownIcon} tone="gold" size="lg" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-xl leading-tight font-extrabold">{nameOf(winnerId)} won</p>
        <p className="mt-0.5 text-paper-2">The last one standing, with {knockoutsText(publicState?.knockoutCounts[winnerId] ?? 0)}.</p>
      </div>
    </div>
  ) : (
    <p className="text-lg text-paper-2">{outcome}</p>
  )
}

/**
 * One personal result on a solid raised panel: a token, the words, and the
 * points this round gave. Out in the hunt's pink (your token with the
 * stripe), never danger red.
 */
function Moment({ icon, points, children }: { icon: ReactNode; points: number; children: ReactNode }) {
  return (
    <div className="grid justify-items-start gap-3 rounded-phone bg-raised p-5">
      {icon}
      <div className="grid gap-1">{children}</div>
      {points > 0 && (
        <p className="w-fit rounded-chip bg-overlay px-2.5 py-1 text-sm font-bold tabular-nums">
          +{points} point{points === 1 ? '' : 's'}
        </p>
      )}
    </div>
  )
}
