// Participant fusion's parts on the TV (docs/identity.md, Participant fusion
// on the TV): a picture drawn sharp without a blink, the countdown and the
// lock-in pips in the quiz's visual language (drawn here with the same tokens
// and sizes, so fusion never imports the quiz), a guest's name on a paper
// chip, and the sharpest eyes row.
import { motion } from 'motion/react'
import Avatar from '@/components/Avatar'
import type { FusionTopRow } from '@/games/fusion/shapes'
import { EASE_OUT, firstName, nameOf, URGENT_MS } from '@/games/fusion/tvLook'
import type { Player } from '@/lib/types'
import { cn } from '@/lib/utils'

// The picture drawn sharp and the name chip live in parts.tsx, without motion, so a phone's reveal draws them too.
export { NameChip, PictureImage } from '@/games/fusion/parts'

/**
 * The time left as one big figure in the condensed numerals, with "seconds
 * left" under it: the quiz's countdown. Paper, gold only for its last 5
 * seconds while the tick-tock plays, then `paper-3` with "Time's up". Two
 * figures wide, so what stands beside it never moves.
 */
export function Countdown({ left }: { left: number }) {
  const seconds = Math.max(0, Math.ceil(left / 1000))
  const over = seconds === 0
  return (
    <div role="timer" aria-label={over ? "Time's up" : `${seconds} seconds left`} className="flex shrink-0 flex-col items-end">
      <span
        aria-hidden
        className={cn(
          'min-w-[2ch] text-right tv-num text-tv-count transition-colors duration-300 short:text-tv-lead low:text-tv-cheer',
          over ? 'text-paper-3' : left <= URGENT_MS ? 'text-gold' : 'text-paper',
        )}
      >
        {seconds}
      </span>
      <span aria-hidden className="mt-1 text-tv-body font-semibold whitespace-nowrap text-paper-2 short:text-tv-tab low:text-tv-floor">
        {over ? "Time's up" : seconds === 1 ? 'second left' : 'seconds left'}
      </span>
    </div>
  )
}

/** The pips lean like letter chips, in a fixed pattern so each keeps its tilt (the quiz's). */
const PIP_TILTS = ['-rotate-3', 'rotate-2', '-rotate-1', 'rotate-3', '-rotate-2', 'rotate-1', 'rotate-3', '-rotate-2'] as const

/**
 * Tilted paper squares, `filled` of `total` filled and the rest a `rule`
 * outline, shrinking to fit one row (the quiz's pips): the showing's pictures,
 * or the guests who have locked in. Counts only, never names.
 */
export function Pips({ filled, total, label, className }: { filled: number; total: number; label: string; className?: string }) {
  const pips = Math.max(total, filled)
  return (
    <div
      role="img"
      aria-label={label}
      className={cn('grid min-w-0 gap-2 [--pip:1.625rem] short:gap-1.5 short:[--pip:1.375rem] low:[--pip:1.125rem]', className)}
      style={{ gridTemplateColumns: `repeat(${pips}, minmax(0, var(--pip)))` }}
    >
      {Array.from({ length: pips }, (_, i) => (
        <span
          key={i}
          className={cn(
            'aspect-square rounded-[3px] transition-colors duration-300',
            PIP_TILTS[i % PIP_TILTS.length],
            i < filled ? 'bg-paper' : 'border-[3px] border-rule short:border-2',
          )}
        />
      ))}
    </div>
  )
}

/**
 * "Sharpest eyes" and up to three of the round's top face detectives: token,
 * first name and points, the points gold for everyone tied first (the
 * leader is one of gold's jobs). Lands after the reveal's counts.
 */
export function Leaders({ top, players, delay }: { top: readonly FusionTopRow[]; players: readonly Player[]; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, ease: EASE_OUT, delay }}
      className="flex min-w-0 items-center gap-8 short:gap-6 low:gap-5"
    >
      {/* Lines tall enough for g, j and y at every size: the row may stand at the foot of the stage's clip. */}
      <p className="shrink-0 text-tv-body leading-[1.3] font-medium text-paper-2 short:text-tv-tab short:leading-[1.3] low:text-tv-floor low:leading-[1.3]">
        Sharpest eyes
      </p>
      <ol className="flex min-w-0 items-center gap-8 short:gap-6 low:gap-5">
        {top.slice(0, 3).map((row, i) => {
          const name = nameOf(players, row.playerId)
          return (
            <motion.li
              key={row.playerId}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, ease: EASE_OUT, delay: delay + 0.1 + i * 0.12 }}
              className="flex min-w-0 items-center gap-3"
            >
              <Avatar name={name} playerId={row.playerId} className="size-12 short:size-10 low:size-8" />
              <span className="max-w-[12rem] min-w-0 truncate text-tv-body leading-[1.3] font-bold text-paper short:max-w-[10rem] short:text-tv-tab short:leading-[1.3] low:text-tv-floor low:leading-[1.3]">
                {firstName(name)}
              </span>
              <span className={cn('shrink-0 tv-num text-tv-body short:text-tv-tab low:text-tv-floor', row.rank === 1 ? 'text-gold' : 'text-paper-2')}>
                {row.points}
              </span>
            </motion.li>
          )
        })}
      </ol>
    </motion.div>
  )
}
