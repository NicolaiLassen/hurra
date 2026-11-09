import { useLive } from '@/lib/useLive'
import { cn } from '@/lib/utils'

/**
 * Whether this page hears changes as they happen, like the TV's dot: teal
 * while every channel is joined and pings arrive, grey while it catches up by
 * reading every few seconds instead (docs/engine-v2.md, 5.4).
 */
export default function LiveDot({ className }: { className?: string }) {
  const { connected, pings } = useLive()
  const live = connected && pings === 'ok'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-sans text-xs font-semibold',
        live ? 'text-confetti-teal' : 'text-muted-foreground',
        className,
      )}
      title={live ? 'Changes show up as they happen' : 'Checking for changes every few seconds until the live connection is back'}
      role="status"
    >
      <span className="relative flex size-2.5">
        {live && <span className="absolute inline-flex size-full animate-ping rounded-full bg-confetti-teal opacity-60 motion-reduce:hidden" />}
        <span className={cn('relative inline-flex size-2.5 rounded-full', live ? 'bg-confetti-teal' : 'bg-muted-foreground')} />
      </span>
      {live ? 'Live' : 'Catching up'}
    </span>
  )
}
