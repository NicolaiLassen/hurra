import { cn } from '@/lib/utils'

// A fixed scatter (not random) so the pieces don't jump around on re-render.
const CONFETTI = Array.from({ length: 18 }, (_, i) => ({
  left: (i * 37 + 11) % 100,
  delay: -((i * 7) % 18),
  duration: 16 + ((i * 5) % 9),
  className: cn(
    ['bg-primary', 'bg-confetti-pink', 'bg-confetti-teal', 'bg-confetti-violet'][i % 4],
    ['size-3 rounded-sm', 'size-2.5 rounded-full', 'h-4 w-1.5 rounded-full', 'size-2 rounded-sm'][(i * 3) % 4],
  ),
}))

/** The night sky behind every scene: soft glows and slowly falling confetti (none with reduced motion). */
export default function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
      <div className="scoreboard-glow absolute inset-0" />
      {CONFETTI.map((piece, i) => (
        <span
          key={i}
          className={cn('confetti-fall absolute -top-6 opacity-25', piece.className)}
          style={{ left: `${piece.left}%`, animationDelay: `${piece.delay}s`, animationDuration: `${piece.duration}s` }}
        />
      ))}
    </div>
  )
}
