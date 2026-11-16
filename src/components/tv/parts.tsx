// Small pieces the TV's scenes share.
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, type ReactNode } from 'react'
import { formatPoints } from '@/lib/format'
import { useElementSize } from '@/lib/useElementSize'
import { cn } from '@/lib/utils'

/** A number that pops whenever it changes. */
export function Points({ value, className }: { value: number; className?: string }) {
  return (
    <motion.span
      key={value}
      initial={{ scale: 1.4 }}
      animate={{ scale: 1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 14 }}
      className={cn('inline-block tabular-nums', className)}
    >
      {value}
    </motion.span>
  )
}

/** "+3" floating up from a row whose points just changed. */
export function GainBubble({ gain, className }: { gain?: { amount: number; seq: number }; className?: string }) {
  return (
    <AnimatePresence>
      {gain && (
        <motion.span
          key={gain.seq}
          initial={{ opacity: 0, y: 12, scale: 0.6 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -24 }}
          transition={{ type: 'spring', stiffness: 320, damping: 18 }}
          className={cn(
            'pointer-events-none absolute z-10 rounded-full px-3 py-1 text-xl font-black text-background shadow-lg',
            gain.amount > 0 ? 'bg-confetti-teal' : 'bg-destructive',
            className,
          )}
        >
          {formatPoints(gain.amount)}
        </motion.span>
      )}
    </AnimatePresence>
  )
}

/** A small uppercase label over a group: "Also running", "Finished". */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('text-sm font-semibold tracking-widest text-muted-foreground uppercase short:text-xs', className)}>
      {children}
    </p>
  )
}

/**
 * One of a stack that shows as many as fit (`cardsThatStack` in fit.ts): it
 * reports its height, and while `hidden` it stays mounted out of sight (in a
 * `relative` parent), so its height stays known and it comes back when there
 * is room again. `fit` marks it for the fit checks while it shows.
 */
export function Measured({
  id,
  hidden,
  onHeight,
  fit,
  children,
}: {
  id: string
  hidden: boolean
  onHeight: (id: string, height: number) => void
  fit?: string
  children: ReactNode
}) {
  const [ref, size] = useElementSize<HTMLDivElement>()
  useEffect(() => {
    if (size.height > 0) onHeight(id, size.height)
  }, [id, size.height, onHeight])
  return (
    <div ref={ref} data-fit={hidden ? undefined : fit} aria-hidden={hidden || undefined} className={cn(hidden && 'invisible absolute inset-x-0 top-0')}>
      {children}
    </div>
  )
}
