import { Fragment } from 'react'
import Avatar from '@/components/Avatar'
import RankBadge from '@/components/RankBadge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { withRanks } from '@/lib/format'
import type { ScoreRow } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * The day's standings as seen from one player's phone: the top three, then
 * the player with their neighbours, so a big party still fits on one card.
 */
export default function Standings({
  rows,
  playerId,
  className,
}: {
  rows: ScoreRow[]
  playerId: string
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
        <CardTitle className="text-base font-bold">Standings</CardTitle>
        {me >= 0 && (
          <p className="text-sm text-muted-foreground">
            You're <span className="font-semibold text-foreground">#{ranked[me].rank}</span> of {ranked.length}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <ol className="grid grid-cols-1 gap-1">
          {shown.map((i, k) => {
            const row = ranked[i]
            const isMe = i === me
            return (
              <Fragment key={row.player_id}>
                {k > 0 && i - shown[k - 1] > 1 && (
                  <li aria-hidden className="text-center leading-none tracking-widest text-muted-foreground">
                    ···
                  </li>
                )}
                <li
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-2.5 py-1.5',
                    isMe && 'bg-primary/12 ring-1 ring-primary/50',
                  )}
                >
                  <RankBadge rank={row.rank} />
                  <Avatar name={row.name} className="size-8 text-xs" />
                  <span className={cn('flex-1 truncate', isMe ? 'font-bold' : 'font-medium')}>
                    {row.name}
                    {isMe && <span className="font-normal text-muted-foreground"> (you)</span>}
                  </span>
                  <span className={cn('font-bold tabular-nums', isMe && 'text-primary')}>{row.points}</span>
                </li>
              </Fragment>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}
