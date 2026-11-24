import { Fragment } from 'react'
import Avatar from '@/components/Avatar'
import { ordinal } from '@/components/phone/text'
import RankBadge from '@/components/RankBadge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { withRanks } from '@/lib/format'
import type { ScoreRow } from '@/lib/types'
import { cn } from '@/lib/utils'

const NONE: ReadonlySet<string> = new Set()

/**
 * The night's standings as one guest's phone shows them: the top three, then
 * the guest with their neighbours, so a big party still fits on one card. The
 * guest's own row stands on the overlay step; the leader's points are gold.
 * `out`: guests a live game has knocked out (knockedOutIds in
 * src/games/registry.ts), with the pink stripe on their token and the word Out
 * by a name that stays at full strength.
 */
export default function Standings({
  rows,
  playerId,
  out = NONE,
  className,
}: {
  rows: ScoreRow[]
  playerId: string
  out?: ReadonlySet<string>
  className?: string
}) {
  const ranked = withRanks(rows)
  const me = ranked.findIndex((row) => row.player_id === playerId)
  const shown =
    ranked.length <= 6
      ? ranked.map((_, i) => i)
      : [...new Set([0, 1, 2, me - 1, me, me + 1])].filter((i) => i >= 0 && i < ranked.length).sort((a, b) => a - b)

  return (
    <Card size="sm" className={className}>
      <CardHeader className="flex items-baseline justify-between">
        <CardTitle role="heading" aria-level={2} className="text-lg font-extrabold">
          Standings
        </CardTitle>
        {me >= 0 && (
          <p className="text-sm text-paper-2">
            You're <span className="font-bold text-paper">{ordinal(ranked[me].rank)}</span> of {ranked.length}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <ol className="grid grid-cols-1 gap-0.5">
          {shown.map((i, k) => {
            const row = ranked[i]
            const isMe = i === me
            const isOut = out.has(row.player_id)
            return (
              <Fragment key={row.player_id}>
                {k > 0 && i - shown[k - 1] > 1 && (
                  <li aria-hidden className="text-center leading-none tracking-widest text-paper-3">
                    ···
                  </li>
                )}
                <li className={cn('flex items-center gap-3 rounded-lg px-2.5 py-1.5', isMe && 'bg-overlay')}>
                  <RankBadge rank={row.rank} />
                  <Avatar name={row.name} playerId={row.player_id} out={isOut} className="size-8" />
                  <span className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className={cn('truncate', isMe ? 'font-bold' : 'font-medium')}>
                      {row.name}
                      {isMe && <span className="font-normal text-paper-2"> (you)</span>}
                    </span>
                    {/* The word, never the stripe alone. */}
                    {isOut && <span className="shrink-0 font-bold text-pink">Out</span>}
                  </span>
                  <span className={cn('font-bold tabular-nums', row.rank === 1 && row.points > 0 && 'text-gold')}>{row.points}</span>
                </li>
              </Fragment>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}
