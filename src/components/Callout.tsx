import type { ReactNode } from 'react'
import type { Tone } from '@/games/core/Game'
import { CALLOUT_TONE } from '@/lib/callout'
import { cn } from '@/lib/utils'

const SIZE = {
  toast: {
    root: 'gap-3 rounded-2xl p-3 pr-4 shadow-2xl shadow-black/40',
    icon: 'size-9 [&_svg]:size-5',
    eyebrow: 'text-[0.65rem] tracking-widest',
    title: 'text-sm leading-snug font-semibold',
    detail: 'text-sm',
  },
  tv: {
    root: 'gap-5 rounded-3xl px-7 py-5 shadow-2xl shadow-black/50',
    icon: 'size-16 [&_svg]:size-8',
    eyebrow: 'text-sm tracking-widest',
    title: 'text-4xl leading-tight font-semibold text-balance',
    detail: 'mt-1 text-2xl',
  },
}

/**
 * The app's one callout: a tone border, the icon in a tinted circle, an optional
 * eyebrow, the title and an optional detail line. Every toast is one at `toast`
 * size (src/lib/toast.tsx), and the TV's announcement banner is one at `tv` size.
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
  /** A Phosphor icon; the circle sizes it. Leave out for a plain message. */
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
  const t = CALLOUT_TONE[tone]
  return (
    <div
      className={cn(
        'relative flex w-full items-center overflow-hidden border-2 bg-popover/95 text-popover-foreground backdrop-blur-md',
        s.root,
        t.border,
        className,
      )}
    >
      {icon && <span className={cn('grid shrink-0 place-items-center rounded-full', s.icon, t.icon)}>{icon}</span>}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {eyebrow && <p className={cn('font-semibold text-muted-foreground uppercase', s.eyebrow)}>{eyebrow}</p>}
        <p className={s.title}>{title}</p>
        {detail && <p className={cn('text-muted-foreground', s.detail)}>{detail}</p>}
      </div>
      {action}
      {children}
    </div>
  )
}
