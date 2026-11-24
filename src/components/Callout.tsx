import type { ReactNode } from 'react'
import type { Tone } from '@/games/core/Game'
import { cn } from '@/lib/utils'

const SIZE = {
  toast: {
    root: 'gap-3 rounded-2xl p-3 pr-4 shadow-2xl shadow-black/40',
    icon: 'size-9 rounded-chip [&_svg]:size-5',
    eyebrow: 'text-[0.65rem] tracking-widest',
    title: 'text-sm leading-snug font-semibold',
    detail: 'text-sm',
  },
  tv: {
    root: 'gap-6 rounded-tile px-7 py-6',
    icon: 'size-16 rounded-chip [&_svg]:size-9',
    eyebrow: 'text-tv-floor',
    title: 'text-tv-band leading-tight font-bold text-balance short:text-tv-field',
    detail: 'mt-1 text-tv-tab short:text-tv-floor',
  },
}

/**
 * The icon's chip by the callout's job (docs/identity.md, Colour jobs): gold
 * for news on air, pink for the hunt, danger for what went wrong; the guest
 * colours are identity only, so the other tones get a paper chip.
 */
const CHIP: Record<Tone, string> = {
  gold: 'bg-gold text-ink',
  pink: 'bg-pink text-ink',
  red: 'bg-danger text-ink',
  teal: 'bg-paper text-ink',
  violet: 'bg-paper text-ink',
}

/**
 * The app's one callout: a solid overlay panel (no glass, no tinted edge), the
 * icon on a square chip in its tone's job colour, an optional eyebrow, the
 * title and an optional detail line. Every toast is one at `toast` size
 * (src/lib/toast.tsx); the TV draws one at `tv` size where a scene shows a
 * piece of news in place.
 */
export default function Callout({
  tone = 'gold',
  icon,
  eyebrow,
  title,
  detail,
  size = 'toast',
  action,
  className,
  children,
}: {
  tone?: Tone
  /** A Phosphor icon; the chip sizes it. Leave out for a plain message. */
  icon?: ReactNode
  /** A small uppercase line above the title, e.g. the game it's about. */
  eyebrow?: ReactNode
  title: ReactNode
  detail?: ReactNode
  size?: keyof typeof SIZE
  /** A button at the end, e.g. Undo. */
  action?: ReactNode
  className?: string
  /** Extras laid over the callout, e.g. the TV's progress bar. */
  children?: ReactNode
}) {
  const s = SIZE[size]
  return (
    <div className={cn('relative flex w-full items-center overflow-hidden bg-overlay text-paper', s.root, className)}>
      {icon && <span className={cn('grid shrink-0 place-items-center', s.icon, CHIP[tone])}>{icon}</span>}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {eyebrow && <p className={cn('font-semibold text-paper-2 uppercase', s.eyebrow)}>{eyebrow}</p>}
        <p className={s.title}>{title}</p>
        {detail && <p className={cn('text-paper-2', s.detail)}>{detail}</p>}
      </div>
      {action}
      {children}
    </div>
  )
}
