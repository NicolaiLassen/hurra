import { CrownIcon, DetectiveIcon } from '@phosphor-icons/react'
import Avatar from '@/components/Avatar'
import AvatarBadge from '@/components/AvatarBadge'
import { listNames, plural, type FusionGame } from '@/games/fusion/logic'
import { nameOf, publicOf } from '@/games/fusion/view'
import type { ResultViewProps } from '@/games/types'

/** The phone's result once fusion is over: "You have the sharpest eye!", or who did and how you did. */
export default function ResultView({ game, player, players, publicState, view, gamePoints }: ResultViewProps<FusionGame>) {
  const pub = publicOf(publicState)
  const winners = game.winners
  const won = winners.includes(player.id)
  const points = view?.points ?? gamePoints[player.id] ?? 0
  const hits = Object.values(view?.hits ?? {})
  const both = hits.filter((h) => h >= 2).length
  const revealed = pub?.pictures.filter((p) => p.revealed).length ?? 0
  const rank = pub?.top.findIndex((row) => row.playerId === player.id) ?? -1

  if (won) {
    return (
      <div className="space-y-3 rounded-3xl bg-primary/15 p-6 text-center ring-1 ring-primary/40">
        <CrownIcon weight="duotone" className="mx-auto size-16 text-primary" />
        <p className="text-3xl font-black">{winners.length > 1 ? 'You share the sharpest eye!' : 'You have the sharpest eye!'}</p>
        <p className="text-muted-foreground">
          {plural(points, 'point')}
          {both > 0 ? `, both people right on ${plural(both, 'picture')}` : ''}. Face detective!
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {winners.length > 0 ? (
        <div className="flex items-center gap-3">
          <span className="flex shrink-0 -space-x-2">
            {winners.slice(0, 3).map((id) => (
              <span key={id} className="relative">
                <Avatar name={nameOf(players, id)} className="size-10 text-sm ring-2 ring-card" />
                <AvatarBadge icon={CrownIcon} tone="gold" size="sm" />
              </span>
            ))}
          </span>
          <p className="min-w-0 text-lg font-bold">
            {listNames(winners.map((id) => nameOf(players, id)))} {winners.length > 1 ? 'had the sharpest eyes' : 'had the sharpest eye'}
          </p>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-lg font-bold">
          <DetectiveIcon weight="duotone" className="size-6 text-confetti-violet" />
          Nobody scored this time
        </p>
      )}
      <div className="rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
        <p className="text-2xl font-black tabular-nums">You scored {plural(points, 'point')}</p>
        <p className="text-sm text-muted-foreground">
          {revealed > 0
            ? `Both people right on ${both} of ${plural(revealed, 'revealed picture')}${rank > 0 ? `. You're number ${rank + 1} of the face detectives.` : '.'}`
            : 'No pictures were revealed.'}
        </p>
      </div>
    </div>
  )
}
