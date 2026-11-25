import { CaretDownIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { startText } from './cue'
import type { CueListRow } from './cueRows'

/**
 * The cue list (spec section 10), folded: every song's number and where its
 * hook starts, when it was played, Now or Next, and its title only once
 * revealed (the host phone is out in the room). A revealed song with close
 * answers left carries "2 close", which opens its review.
 */
export default function CueList({
  rows,
  clock,
  onOpenReview,
}: {
  rows: CueListRow[]
  clock: (at: number) => string
  onOpenReview: (index: number) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <section className="grid grid-cols-1 gap-2">
      <button
        type="button"
        aria-expanded={open}
        className="flex min-h-11 items-center gap-2 self-start rounded-control text-left font-extrabold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={() => setOpen((shown) => !shown)}
      >
        <CaretDownIcon className={cn('size-4 text-paper-2 transition-transform', open && 'rotate-180')} />
        Cue list
        <span className="font-medium text-paper-2">({rows.length})</span>
      </button>
      {open && (
        <ol className="divide-y divide-rule">
          {rows.map((row) => (
            <li key={row.n} className={cn('flex min-h-12 items-center gap-3 py-1.5', row.state === 'later' && 'text-paper-2')}>
              <span className="tv-num w-6 shrink-0 text-right text-xl text-paper-3">{row.n}</span>
              <span className="tv-num w-11 shrink-0 text-lg">{row.startAt !== null ? startText(row.startAt) : ''}</span>
              <div className="min-w-0 flex-1">
                {row.named ? (
                  <p className="leading-snug font-bold break-words">{row.named.title}</p>
                ) : (
                  <p className="text-sm text-paper-2">
                    {row.state === 'later' ? 'Not played yet' : row.state === 'next' ? `Track ${row.n} in the playlist` : 'Not revealed yet'}
                  </p>
                )}
                {(row.named || (row.playedAt !== null && row.state !== 'now')) && (
                  <p className="text-sm text-paper-2">
                    {[row.named?.singer, row.playedAt !== null && row.state !== 'now' ? `Played at ${clock(row.playedAt)}` : null]
                      .filter(Boolean)
                      .join('. ')}
                  </p>
                )}
              </div>
              {row.state === 'now' && <Badge variant="secondary">Now</Badge>}
              {row.state === 'next' && <Badge variant="outline">Next</Badge>}
              {row.close > 0 && (
                <Button type="button" variant="outline" size="sm" onClick={() => onOpenReview(row.n - 1)}>
                  {row.close} close
                </Button>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
