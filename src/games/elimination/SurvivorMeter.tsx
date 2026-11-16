import { CrownIcon } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

// md: the phone. lg: the TV's main area. slim: the TV's status card while the
// game runs in the background beside another one.
const SIZES = {
  md: { root: 'gap-2', number: 'text-5xl', of: 'text-lg', label: 'text-base', bar: 'h-2.5 gap-1' },
  lg: {
    root: 'gap-4',
    number: 'text-8xl short:text-6xl',
    of: 'text-4xl short:text-3xl',
    label: 'text-3xl short:text-2xl',
    bar: 'h-4 gap-1.5 short:h-3',
  },
  slim: {
    root: 'gap-2.5 short:gap-2',
    number: 'text-5xl short:text-4xl',
    of: 'text-2xl short:text-xl',
    label: 'text-xl short:text-lg',
    bar: 'h-2 gap-0.5',
  },
}

/**
 * How many are still standing: a big number over a bar with one segment per
 * player that drains from the right as people get knocked out.
 */
export default function SurvivorMeter({
  alive,
  total,
  size = 'md',
  className,
}: {
  alive: number
  total: number
  size?: keyof typeof SIZES
  className?: string
}) {
  const style = SIZES[size]
  const won = alive === 1 && total > 1

  return (
    <div
      className={cn('grid', style.root, className)}
      role="img"
      aria-label={`${alive} of ${total} still standing`}
    >
      <p className="flex items-baseline gap-2">
        {/* Re-keyed on every change so the number pops. */}
        <span
          key={alive}
          className={cn('animate-count-pop inline-block leading-none font-black text-primary tabular-nums', style.number)}
        >
          {alive}
        </span>
        <span className={cn('font-semibold text-muted-foreground', style.of)}>of {total}</span>
        <span className={cn('ml-auto flex items-center gap-1.5 font-bold', style.label)}>
          {won && <CrownIcon weight="fill" className="text-primary" />}
          {won ? 'one left!' : 'still standing'}
        </span>
      </p>
      <div className={cn('flex', style.bar)}>
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn(
              'flex-1 rounded-full transition-colors duration-700',
              i < alive ? 'bg-primary shadow-[0_0_10px_color-mix(in_oklab,var(--color-gold)_35%,transparent)]' : 'bg-white/10',
            )}
          />
        ))}
      </div>
    </div>
  )
}
