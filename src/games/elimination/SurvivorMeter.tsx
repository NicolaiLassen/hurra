import { CrownIcon } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

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
  /** 'lg' for the TV. */
  size?: 'md' | 'lg'
  className?: string
}) {
  const lg = size === 'lg'
  const won = alive === 1 && total > 1

  return (
    <div
      className={cn('grid gap-2', lg && 'gap-4', className)}
      role="img"
      aria-label={`${alive} of ${total} still standing`}
    >
      <p className="flex items-baseline gap-2">
        {/* Re-keyed on every change so the number pops. */}
        <span
          key={alive}
          className={cn(
            'animate-count-pop inline-block leading-none font-black text-primary tabular-nums',
            lg ? 'text-8xl short:text-6xl' : 'text-5xl',
          )}
        >
          {alive}
        </span>
        <span className={cn('font-semibold text-muted-foreground', lg ? 'text-4xl short:text-3xl' : 'text-lg')}>of {total}</span>
        <span className={cn('ml-auto flex items-center gap-1.5 font-bold', lg ? 'text-3xl short:text-2xl' : 'text-base')}>
          {won && <CrownIcon weight="fill" className="text-primary" />}
          {won ? 'one left!' : 'still standing'}
        </span>
      </p>
      <div className={cn('flex', lg ? 'h-4 gap-1.5 short:h-3' : 'h-2.5 gap-1')}>
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn(
              'flex-1 rounded-full transition-colors duration-700',
              i < alive ? 'bg-primary shadow-[0_0_10px_rgb(245_197_66/0.35)]' : 'bg-white/10',
            )}
          />
        ))}
      </div>
    </div>
  )
}
