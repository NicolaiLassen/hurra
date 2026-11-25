import { EyeIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { Cue } from './cue'
import { useClock } from './useClock'

/**
 * The cue card (spec section 10): what to do in Spotify and in the app, in a
 * well at the top of Lydspor's card. While the last call runs it counts down
 * by the database clock. Before the lock, Hold to show the title shows the
 * song playing and the next track for as long as it is held, for an operator
 * who lost their place: the host phone is out in the room.
 */
export default function CueCard({
  cue,
  lockAt,
  serverNow,
  titleLine,
}: {
  cue: Cue
  /** In the last call: when the answers lock. */
  lockAt: number | null
  serverNow: () => number
  /** What Hold to show the title shows, or null when there is no such button. */
  titleLine: string | null
}) {
  const [holding, setHolding] = useState(false)
  const counting = cue.lead === null && lockAt !== null
  const now = useClock(serverNow, 250, counting)
  const left = lockAt !== null ? Math.ceil((lockAt - now) / 1000) : 0
  const lead =
    cue.lead ??
    (counting && left > 0 ? (
      <>
        Last call: <span className="tv-num text-2xl">{left}</span> s left.
      </>
    ) : (
      'Locking the answers…'
    ))
  const hold = {
    onPointerDown: () => setHolding(true),
    onPointerUp: () => setHolding(false),
    onPointerLeave: () => setHolding(false),
    onPointerCancel: () => setHolding(false),
    onKeyDown: (e: { key: string }) => (e.key === ' ' || e.key === 'Enter') && setHolding(true),
    onKeyUp: () => setHolding(false),
    onBlur: () => setHolding(false),
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  }

  return (
    <section className="grid grid-cols-1 gap-2 rounded-lg bg-overlay p-4" aria-label="Cue card">
      <p className="text-base leading-snug text-paper sm:text-[17px]">
        <span className="font-extrabold">{lead}</span> {cue.text}
      </p>
      {cue.counts && (
        <p className="text-sm text-paper-2">
          <span className="tv-num text-lg text-paper">
            {cue.counts.title} of {cue.counts.of}
          </span>{' '}
          typed a title, <span className="tv-num text-lg text-paper">{cue.counts.singer}</span> a singer,{' '}
          <span className="tv-num text-lg text-paper">{cue.counts.event}</span> a photo.
        </p>
      )}
      {cue.note && <p className="text-sm text-paper-2">Note: {cue.note}</p>}
      {titleLine && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button type="button" variant="ghost" size="sm" className="-ml-2 touch-none select-none" aria-pressed={holding} {...hold}>
            <EyeIcon />
            Hold to show the title
          </Button>
          {holding && <p className="text-sm font-bold text-paper">{titleLine}</p>}
        </div>
      )}
    </section>
  )
}
