import { motion, useReducedMotion } from 'motion/react'
import Piece, { type PieceKind } from '@/components/Piece'
import { cn } from '@/lib/utils'

// The logo's confetti (public/favicon.svg), each piece in its colour there:
// the pink dot, the teal curl, the violet wave and the gold star. Nothing else
// flies: no squares, no triangles, no colour the logo doesn't have.
const PIECES: { kind: PieceKind; className: string }[] = [
  { kind: 'dot', className: 'size-5 text-pink' },
  { kind: 'curl', className: 'size-8 text-guest-teal' },
  { kind: 'wave', className: 'size-8 text-guest-violet' },
  { kind: 'star', className: 'size-7 text-gold' },
]

/** A fixed pseudo-random number in [0, 1) for a seed, so every render draws the same burst. */
const noise = (seed: number) => {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

/**
 * The logo's confetti bursting from the middle of its box and falling away:
 * once, when it mounts (re-key it to fire again), and gone after about three
 * seconds, so the screen under it is still again. Nothing with reduced motion.
 */
export default function Confetti({ pieces = 44, className }: { pieces?: number; className?: string }) {
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
            className="absolute top-1/2 left-1/2"
            initial={{ opacity: 0 }}
            animate={{
              x: ['0vw', `${x * 0.85}vw`, `${x}vw`],
              y: ['0vh', `${y}vh`, `${y + 38}vh`],
              opacity: [1, 1, 0],
              rotate: [0, spin * 0.4, spin],
              scale: [0.3, 1, 1],
            }}
            transition={{ duration: 2.2 + noise(i + 55) * 1.2, times: [0, 0.3, 1], ease: 'easeOut', delay: noise(i + 31) * 0.25 }}
          >
            <Piece kind={piece.kind} className={cn('block', piece.className)} />
          </motion.span>
        )
      })}
    </div>
  )
}
