import { CrownIcon, SparkleIcon } from '@phosphor-icons/react'
import AnnouncementIconView from '@/components/AnnouncementIconView'
import { Eyebrow } from '@/components/phone/GameCard'
import { pointsText } from '@/components/phone/text'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { CALLOUT_TONE } from '@/lib/callout'
import type { RecapDoc } from '@/lib/recap'
import { cn } from '@/lib/utils'

/**
 * "Your night" (docs/engine-v2.md, 7.1): this guest's part of the recap the
 * host published. Their rank, their points by game and the moments that name
 * them. Nothing for a guest the recap doesn't know (joined after it was made).
 */
export default function YourNight({ doc, playerId, className }: { doc: RecapDoc; playerId: string; className?: string }) {
  const me = doc.players[playerId]
  if (!me) return null
  const best = Math.max(1, ...me.byGame.map((g) => g.points))

  return (
    <Card
      aria-labelledby="your-night"
      className={cn(
        'gap-6 bg-[radial-gradient(90%_55%_at_50%_0%,color-mix(in_oklch,var(--primary)_16%,transparent),transparent)]',
        className,
      )}
    >
      <CardHeader>
        <Eyebrow className="text-primary">
          <SparkleIcon weight="fill" className="size-3.5" />
          <span id="your-night">Your night</span>
        </Eyebrow>
      </CardHeader>

      <CardContent className="grid gap-6">
        <div className="grid justify-items-center text-center">
          {me.rank === 1 && <CrownIcon weight="fill" className="mb-1 size-10 text-primary" aria-hidden />}
          <p className="text-6xl leading-none font-black tracking-tight text-primary tabular-nums">#{me.rank}</p>
          <p className="mt-2 text-muted-foreground">
            of {doc.standings.length}, with <span className="font-semibold text-foreground">{pointsText(me.points)}</span>
          </p>
        </div>

        {me.byGame.length > 0 && (
          <section className="grid gap-2.5">
            <Eyebrow>Points by game</Eyebrow>
            <ul className="grid gap-2">
              {me.byGame.map((row) => (
                <li key={row.gameId} className="grid gap-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate font-medium">{row.title}</span>
                    <span className="font-bold tabular-nums">{row.points}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden>
                    <div className="h-full rounded-full bg-primary" style={{ width: `${(Math.max(0, row.points) / best) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {me.moments.length > 0 && (
          <section className="grid gap-2.5">
            <Eyebrow>Your moments</Eyebrow>
            <ul className="grid gap-3">
              {me.moments.map((moment, i) => (
                <li key={`${moment.title}-${i}`} className="flex gap-3">
                  <span
                    className={cn(
                      'grid size-9 shrink-0 place-items-center rounded-full [&_svg]:size-5',
                      CALLOUT_TONE[moment.tone ?? 'gold'].icon,
                    )}
                  >
                    <AnnouncementIconView name={moment.icon ?? 'star'} />
                  </span>
                  <span className="min-w-0 self-center">
                    <span className="block leading-snug font-semibold">{moment.title}</span>
                    {moment.detail && <span className="block text-sm text-muted-foreground">{moment.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </CardContent>
    </Card>
  )
}
