import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** How long a secret shows before the card turns back over by itself. */
const SHOW_MS = 8000

/**
 * A face-down card that turns over to show a secret when tapped, and turns
 * back by itself after a few seconds, so nobody reads it over the player's
 * shoulder. Both faces stand on the overlay step with the popper's gold and
 * pink stripes along the left edge (the mark of the hunt), so the card never
 * out-shouts the screen's one gold step.
 *
 * `compact` is a slim card for a section of the phone home; the full one is
 * for the game's own view.
 */
export default function SecretCard({
  label,
  compact = false,
  children,
}: {
  label: string
  compact?: boolean
  children: ReactNode
}) {
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    if (!revealed) return
    const timer = setTimeout(() => setRevealed(false), SHOW_MS)
    return () => clearTimeout(timer)
  }, [revealed])

  const face = cn(
    'relative flex flex-col justify-center overflow-hidden rounded-phone bg-overlay py-3 pr-4 pl-[2.125rem] text-left backface-hidden',
    // The popper's stripes along the left edge.
    "before:absolute before:inset-y-0 before:left-0 before:w-[1.125rem] before:stripes before:content-['']",
  )

  return (
    <button
      type="button"
      onClick={() => setRevealed((r) => !r)}
      aria-pressed={revealed}
      className="block w-full rounded-phone text-left perspective-[1200px] focus-visible:ring-3 focus-visible:ring-gold/50 focus-visible:outline-none"
    >
      <div
        className={cn(
          'relative grid transition-transform duration-500 ease-out transform-3d *:[grid-area:1/1] motion-reduce:transition-none',
          compact ? 'min-h-21' : 'min-h-40',
          revealed && 'rotate-y-180',
        )}
      >
        <div className={face}>
          <span className={cn('block font-extrabold', compact ? 'text-[1.0625rem]' : 'text-xl')}>Your secret {label}</span>
          <span className="mt-1 block text-sm font-medium text-paper-2">Tap to read it. It turns back over by itself.</span>
        </div>
        <div className={cn(face, 'rotate-y-180 gap-1')}>
          <span className="block text-sm font-semibold text-paper-2">Your {label}</span>
          <span className={cn('block leading-snug font-bold', compact ? 'text-lg' : 'text-2xl')}>{children}</span>
          {!compact && <span className="mt-2 block text-xs text-paper-2">Tap to hide</span>}
        </div>
      </div>
    </button>
  )
}
