// The on-air frame's shared parts (docs/identity.md, The TV's frame): the
// tilted tabs and the band's lines. The core's frame draws its strap and its
// plain band lines with them, and a game's TvStatus draws its own band line
// with them (variant 'band'), so every line along the bottom reads alike.
// CSS only, with no motion library: the registry imports every TvStatus, so
// this file reaches every phone too.
import type { ReactNode } from 'react'
import { clockTime } from '@/components/tv/clock'
import { cn } from '@/lib/utils'

/** A tab's colour by its job: gold is on air, pink the hunt, paper anything else. */
const TAB_TONE = {
  gold: 'bg-gold text-ink',
  pink: 'bg-pink text-ink',
  paper: 'bg-paper text-ink',
} as const

export type TabTone = keyof typeof TAB_TONE

/**
 * Sizes at 1080p with their short: steps. The strap's tab leans back from its
 * right side, as if it landed on the strap; a band line's tab leans forward.
 */
const TAB_SIZE = {
  strap: 'h-16 px-6 text-tv-tab -rotate-2 origin-[70%_50%] short:h-14 short:px-5 short:text-tv-floor',
  band: 'h-14 px-5.5 text-tv-floor rotate-[1.5deg] short:h-12 short:px-4.5',
} as const

/**
 * A tab: a piece of colour that landed on the frame, its words on air (Archivo
 * wide, upper case). Only tabs, letter chips and hero tokens tilt. Its words
 * end in an ellipsis when the caller caps its width.
 */
export function Tab({
  tone = 'gold',
  size = 'band',
  className,
  children,
}: {
  tone?: TabTone
  size?: keyof typeof TAB_SIZE
  className?: string
  children: ReactNode
}) {
  return (
    <span className={cn('relative z-10 inline-flex min-w-0 items-center on-air', TAB_TONE[tone], TAB_SIZE[size], className)}>
      <span className="min-w-0 truncate">{children}</span>
    </span>
  )
}

/** Stripes as high as the tab they stand beside. */
const STRIPES_SIZE = {
  strap: 'h-16 w-11 -rotate-2 short:h-14 short:w-10',
  band: 'h-14 w-10 rotate-[1.5deg] short:h-12 short:w-9',
} as const

/** The popper's gold and pink stripes beside a pink tab: the mark of the hunt. */
export function Stripes({ size = 'band', className }: { size?: keyof typeof STRIPES_SIZE; className?: string }) {
  return <span aria-hidden className={cn('stripes -mr-0.5 shrink-0', STRIPES_SIZE[size], className)} />
}

/**
 * One line of the band: the tab (a Tab, with Stripes before it if it is the
 * hunt's), then what the line says, on one line that never wraps. 60 px high
 * on a 1080p TV, 52 on short screens; the tab takes at most 48 percent of it.
 * The line is a size container, so a detail can show only where it has room
 * (`hidden @min-[96rem]:inline`).
 */
export function BandLine({ tab, className, children }: { tab: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <div data-fit="band-line" className={cn('@container flex h-15 min-w-0 items-center short:h-13', className)}>
      <div className="flex max-w-[48%] min-w-0 shrink-0 items-center">{tab}</div>
      <div className="flex min-w-0 flex-1 items-center gap-6.5 pl-7 short:gap-5 short:pl-5">{children}</div>
    </div>
  )
}

/** A band line's figure, in the condensed numerals: "18 of 24 still in". */
export function BandCount({ children }: { children: ReactNode }) {
  return <span className="shrink-0 tv-num text-tv-band text-paper short:text-tv-field">{children}</span>
}

/** A band line's words: "Question 3 of 10". They end in an ellipsis when the line runs out of room. */
export function BandText({ children }: { children: ReactNode }) {
  return <span className="min-w-0 truncate text-tv-tab font-semibold text-paper-2 short:text-tv-floor [&_strong]:font-bold [&_strong]:text-paper">{children}</span>
}

/** The time of day in a band line, condensed so 21:40 keeps its colon tight. */
function Clock({ at, className }: { at: number; className?: string }) {
  return (
    <time dateTime={new Date(at).toISOString()} className={cn('shrink-0 tv-num text-tv-field short:text-tv-tab', className)}>
      {clockTime(at)}
    </time>
  )
}

/** "Running since 20:30": how long a game has run, by the time it started. */
export function BandSince({ at }: { at: number }) {
  return (
    <span className="flex shrink-0 items-baseline gap-3 text-tv-tab font-semibold whitespace-nowrap text-paper-2 short:text-tv-floor">
      Running since
      <Clock at={at} className="text-paper" />
    </span>
  )
}

/**
 * Something that happened, after its time of day: "22:41 Clara got Frida".
 * Names in <strong> stand out in paper. It ends in an ellipsis when the line
 * runs out of room. Key it on the event, so a new one wipes in from its left
 * edge; it changes only when something happens.
 */
export function BandEvent({ at, children }: { at: number; children: ReactNode }) {
  return (
    <span className="flex min-w-0 animate-strap-in items-baseline gap-3 text-tv-tab font-semibold text-paper-2 motion-reduce:animate-none short:text-tv-floor [&_strong]:font-bold [&_strong]:text-paper">
      <Clock at={at} />
      <span className="min-w-0 truncate">{children}</span>
    </span>
  )
}
