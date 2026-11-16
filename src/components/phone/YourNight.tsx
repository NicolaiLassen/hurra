import { CrownIcon, MoonIcon } from '@phosphor-icons/react'
import AnnouncementIconView from '@/components/AnnouncementIconView'
import { ordinal, pointsText } from '@/components/phone/text'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import type { RecapDoc } from '@/lib/recap'
import { cn } from '@/lib/utils'

/**
 * "Your night" (docs/engine-v2.md, 7.1): this guest's part of the recap the
 * host published. Their place, their points by game and the moments that name
 * them, on a solid card. Gold only for the night's winner. Nothing for a guest
 * the recap doesn't know (joined after it was made).
 */
export default function YourNight({ doc, playerId, className }: { doc: RecapDoc; playerId: string; className?: string }) {
  const me = doc.players[playerId]
  if (!me) return null
  const best = Math.max(1, ...me.byGame.map((g) => g.points))
  const won = me.rank === 1 && me.points > 0

  return (
    <Card aria-labelledby="your-night" className={cn('gap-6', className)}>
      <CardHeader>
        <h2 id="your-night" className="flex items-center gap-2 on-air text-sm text-paper-2">
          <MoonIcon weight="fill" className="size-4" />
          Your night
        </h2>
      </CardHeader>

      <CardContent className="grid gap-6">
        <div className="grid justify-items-center text-center">
          {won && <CrownIcon weight="fill" className="mb-1 size-10 text-gold" aria-hidden />}
          <p className={cn('text-6xl leading-none wide', won && 'text-gold')}>{ordinal(me.rank)}</p>
          <p className="mt-2 text-paper-2">
            of {doc.standings.length}, with <span className="font-semibold text-paper">{pointsText(me.points)}</span>
          </p>
        </div>

        {me.byGame.length > 0 && (
          <section className="grid gap-2.5">
            <h3 className="text-sm font-bold text-paper-2">Points by game</h3>
            <ul className="grid gap-2">
              {me.byGame.map((row) => (
                <li key={row.gameId} className="grid gap-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate font-medium">{row.title}</span>
                    <span className="font-bold tabular-nums">{row.points}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-rule" aria-hidden>
                    <div className="h-full rounded-full bg-paper" style={{ width: `${(Math.max(0, row.points) / best) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {me.moments.length > 0 && (
          <section className="grid gap-2.5">
            <h3 className="text-sm font-bold text-paper-2">Your moments</h3>
            <ul className="grid gap-3">
              {me.moments.map((moment, i) => (
                <li key={`${moment.title}-${i}`} className="flex gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-chip bg-overlay text-paper [&_svg]:size-5">
                    <AnnouncementIconView name={moment.icon ?? 'star'} />
                  </span>
                  <span className="min-w-0 self-center">
                    <span className="block leading-snug font-semibold">{moment.title}</span>
                    {moment.detail && <span className="block text-sm text-paper-2">{moment.detail}</span>}
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
