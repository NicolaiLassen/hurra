import { useLive } from '@/lib/useLive'
import { cn } from '@/lib/utils'

/**
 * Whether this page hears changes as they happen, like the TV's dot: a paper
 * dot and the word Live while every channel is joined and pings arrive, an
 * empty one and Catching up while it reads every few seconds instead
 * (docs/engine-v2.md, 5.4). The word carries the state; the dot never does it
 * alone, and it stays out of the guest colours (docs/identity.md).
 */
export default function LiveDot({ className }: { className?: string }) {
  const { connected, pings } = useLive()
  const live = connected && pings === 'ok'
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 font-sans text-xs font-bold', live ? 'text-paper' : 'text-paper-3', className)}
      title={live ? 'Changes show up as they happen' : 'Checking for changes every few seconds until the live connection is back'}
      role="status"
    >
      <span aria-hidden className={cn('inline-flex size-2 rounded-full', live ? 'bg-paper' : 'border-[1.5px] border-paper-3')} />
      {live ? 'Live' : 'Catching up'}
    </span>
  )
}
