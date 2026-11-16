import { useState } from 'react'
import { useReducedMotionPreference, useServerTime } from '@/games/quiz/clock'
import { dotSize, LETTER_TILTS, LETTER_TONES, letterOf, URGENT_MS } from '@/games/quiz/look'
import { cn } from '@/lib/utils'

/** An option's letter on its confetti colour. Size and corners come from `className`. */
export function LetterBadge({ index, className }: { index: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center font-black',
        LETTER_TONES[index % LETTER_TONES.length],
        LETTER_TILTS[index % LETTER_TILTS.length],
        className,
      )}
    >
      {letterOf(index)}
    </span>
  )
}

/**
 * The countdown: a gold bar that drains from right to left and turns pink for
 * its last seconds. Lay it along the bottom edge of the question card.
 */
export function DrainBar({
  startsAt,
  endsAt,
  serverNow,
  className,
}: {
  /** When the question opened, or null to start full from when it is first seen. */
  startsAt: number | null
  endsAt: number
  serverNow: () => number
  className?: string
}) {
  const reduced = useReducedMotionPreference()
  // Small steps with a matching linear transition read as one smooth drain; a step a second with less motion.
  const now = useServerTime(serverNow, reduced ? 1000 : 100)
  const [firstSeen] = useState(serverNow)
  const start = startsAt ?? Math.min(firstSeen, endsAt - 1000)
  const total = Math.max(1, endsAt - start)
  const left = Math.max(0, Math.min(total, endsAt - now))
  const urgent = left <= URGENT_MS

  return (
    <div
      role="progressbar"
      aria-label="Time left"
      aria-valuemin={0}
      aria-valuemax={Math.round(total / 1000)}
      aria-valuenow={Math.ceil(left / 1000)}
      className={cn('overflow-hidden bg-white/10', className)}
    >
      <div
        className={cn('h-full origin-left', urgent ? 'bg-confetti-pink' : 'bg-primary')}
        style={{
          transform: `scaleX(${left / total})`,
          transition: reduced ? undefined : 'transform 100ms linear, background-color 400ms ease',
        }}
      />
    </div>
  )
}

/** Whole seconds left, pink for the last few, then "Time's up". */
export function SecondsLeft({
  endsAt,
  serverNow,
  suffix = '',
  className,
}: {
  endsAt: number
  serverNow: () => number
  /** After the number, e.g. " s left". */
  suffix?: string
  className?: string
}) {
  const now = useServerTime(serverNow, 250)
  const left = endsAt - now
  if (left <= 0) return <span className={cn('font-black text-confetti-pink', className)}>Time's up</span>
  return (
    <span className={cn('font-black tabular-nums', left <= URGENT_MS ? 'text-confetti-pink' : 'text-primary', className)}>
      {Math.ceil(left / 1000)}
      {suffix}
    </span>
  )
}

/**
 * How many have answered: a dot per guest, filling in gold, with "31 of 45".
 * Counts only, never names or faces, so nobody can tell who hasn't answered.
 */
export function AnsweredDots({
  count,
  total,
  screen,
  className,
}: {
  count: number
  total: number
  screen: 'tv' | 'host'
  className?: string
}) {
  const dots = Math.max(total, count)
  return (
    <div className={cn('flex items-center gap-4', className)} role="img" aria-label={`${count} of ${dots} answered`}>
      <div className={cn('flex min-w-0 flex-1 flex-wrap', screen === 'tv' ? 'gap-1.5' : 'gap-1')}>
        {Array.from({ length: dots }, (_, i) => (
          <span
            key={i}
            className={cn(
              'rounded-full transition-[background-color,box-shadow] duration-500',
              dotSize(dots, screen),
              i < count ? 'bg-primary shadow-[0_0_10px_color-mix(in_oklab,var(--color-gold)_45%,transparent)]' : 'bg-white/10',
            )}
          />
        ))}
      </div>
      <p className="shrink-0 font-semibold whitespace-nowrap tabular-nums">
        <span className="text-primary">{count}</span> of {dots} answered
      </p>
    </div>
  )
}
