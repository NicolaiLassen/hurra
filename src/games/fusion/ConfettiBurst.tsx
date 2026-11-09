import { motion, useReducedMotion } from 'motion/react'
import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'

// The four confetti pieces of the loader, in its colours: a gold square, a pink
// dot, a teal triangle and a violet strip.
const PIECES: { className: string; style: CSSProperties }[] = [
  { className: 'size-4 rounded-[3px]', style: { backgroundColor: 'var(--primary)' } },
  { className: 'size-4 rounded-full', style: { backgroundColor: 'var(--confetti-pink)' } },
  {
    className: 'size-5',
    style: { backgroundColor: 'var(--confetti-teal)', clipPath: 'polygon(50% 0, 100% 100%, 0 100%)' },
  },
  { className: 'h-6 w-2 rounded-full', style: { backgroundColor: 'var(--confetti-violet)' } },
]

/** A fixed pseudo-random number in [0, 1) for a seed, so every render draws the same burst. */
const noise = (seed: number) => {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

/**
 * Confetti bursting from the middle of its box and falling away: once, when
 * it mounts (re-key it to fire again). Nothing with reduced motion.
 */
export default function ConfettiBurst({ pieces = 44, className }: { pieces?: number; className?: string }) {
  const reduce = useReducedMotion()
  if (reduce) return null
  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      {Array.from({ length: pieces }, (_, i) => {
        const piece = PIECES[i % PIECES.length]
        const angle = noise(i + 1) * Math.PI * 2
        const reach = 18 + noise(i + 101) * 26
        const x = Math.cos(angle) * reach
        const y = Math.sin(angle) * reach * 0.8 - 8
        const spin = (noise(i + 7) - 0.5) * 900
        return (
          <motion.span
            key={i}
            className={cn('absolute top-1/2 left-1/2', piece.className)}
            style={piece.style}
            initial={{ opacity: 0 }}
            animate={{
              x: ['0vw', `${x * 0.85}vw`, `${x}vw`],
              y: ['0vh', `${y}vh`, `${y + 38}vh`],
              opacity: [1, 1, 0],
              rotate: [0, spin * 0.4, spin],
              scale: [0.3, 1, 1],
            }}
            transition={{ duration: 2.2 + noise(i + 55) * 1.2, times: [0, 0.3, 1], ease: 'easeOut', delay: noise(i + 31) * 0.25 }}
          />
        )
      })}
    </div>
  )
}
