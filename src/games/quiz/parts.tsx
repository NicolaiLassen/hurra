import { useState } from 'react'
import { useReducedMotionPreference, useServerTime } from '@/games/quiz/clock'
import { dotSize, LETTER_TILTS, LETTER_TONES, letterOf, PIP_TILTS, URGENT_MS } from '@/games/quiz/look'
import { cn } from '@/lib/utils'

/** An option's letter on its key colour, in wide Archivo, on the chip radius. Size (and other corners) come from `className`. */
export function LetterBadge({ index, className }: { index: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'wide grid shrink-0 place-items-center rounded-chip',
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
 * The countdown as a bar: paper that drains from right to left on a rule
 * track, and turns gold for its last seconds (docs/identity.md, The quiz on
 * the TV), the same as the TV's countdown figure.
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
      className={cn('overflow-hidden bg-rule', className)}
    >
      <div
        className={cn('h-full origin-left', urgent ? 'bg-gold' : 'bg-paper')}
        style={{
          transform: `scaleX(${left / total})`,
          transition: reduced ? undefined : 'transform 100ms linear, background-color 400ms ease',
        }}
      />
    </div>
  )
}

/** Whole seconds left: paper, gold for the last few (the countdown's one gold moment), then "Time's up". */
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
  if (left <= 0) return <span className={cn('font-black text-paper-2', className)}>Time's up</span>
  return (
    <span className={cn('font-black tabular-nums', left <= URGENT_MS ? 'text-gold' : 'text-paper', className)}>
      {Math.ceil(left / 1000)}
      {suffix}
    </span>
  )
}

/**
 * How many have answered, by count only, never names or faces, so nobody can
 * tell who hasn't answered. On the TV: a tilted paper pip per guest, filled as
 * they answer (an empty one is a rule outline), with "17 of 24 have answered";
 * the pips shrink to fit the row, so 45 guests still fit on one line. On the
 * host page: a small square per guest with "17 of 24 answered".
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
  if (screen === 'tv') {
    return (
      <div className={cn('flex min-w-0 items-center gap-8 short:gap-6', className)} role="img" aria-label={`${count} of ${dots} have answered`}>
        <div
          className="grid min-w-0 gap-2 [--pip:1.625rem] short:gap-1.5 short:[--pip:1.375rem] low:[--pip:1.125rem]"
          style={{ gridTemplateColumns: `repeat(${dots}, minmax(0, var(--pip)))` }}
        >
          {Array.from({ length: dots }, (_, i) => (
            <span
              key={i}
              className={cn(
                'aspect-square rounded-[3px] transition-colors duration-300',
                PIP_TILTS[i % PIP_TILTS.length],
                i < count ? 'bg-paper' : 'border-[3px] border-rule short:border-2',
              )}
            />
          ))}
        </div>
        <p className="flex shrink-0 items-baseline gap-4 whitespace-nowrap short:gap-3">
          <span className="tv-num text-tv-band text-paper short:text-tv-field low:text-tv-tab">
            {count} of {dots}
          </span>
          <span className="text-tv-body font-medium text-paper-2 short:text-tv-tab low:text-tv-floor">have answered</span>
        </p>
      </div>
    )
  }
  return (
    <div className={cn('flex items-center gap-4', className)} role="img" aria-label={`${count} of ${dots} answered`}>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1">
        {Array.from({ length: dots }, (_, i) => (
          <span key={i} className={cn('rounded-[2px] transition-colors duration-300', dotSize(dots, screen), i < count ? 'bg-paper' : 'bg-rule')} />
        ))}
      </div>
      <p className="shrink-0 font-semibold whitespace-nowrap text-paper-2 tabular-nums">
        <span className="text-paper">{count}</span> of {dots} answered
      </p>
    </div>
  )
}
