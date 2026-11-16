import type { Icon } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

const TONES = {
  /** A win (the winner's crown): a gold chip with an ink icon. */
  gold: 'bg-gold text-ink',
  /** A quiet nudge on your own token (add a photo): paper, so the screen's one gold stays its next step. */
  paper: 'bg-paper text-ink',
}

// Sized to the token it sits on: sm for size-6 to size-10 tokens, md for
// size-10 to 12, lg for size-14 and up (the TV). A square chip like the token,
// across its bottom right corner, cut out of it by a ring in the ground colour.
// Icons follow the badge sizes in index.css.
const SIZES = {
  sm: '-right-1.5 -bottom-1.5 size-4 rounded-[3px] ring-2 [&>svg]:size-3',
  md: '-right-1.5 -bottom-1.5 size-5 rounded-chip ring-2 [&>svg]:size-3.5',
  lg: '-right-2 -bottom-2 size-7 rounded-chip ring-[3px] [&>svg]:size-5',
}

/**
 * A status mark on a token's bottom right corner, such as a crown for the
 * winner. Put it next to the Avatar inside a `relative` wrapper; it stays
 * within a few pixels of the token. Being knocked out is no badge: the
 * token's own pink stripe (Avatar's `out`) and the word Out say it.
 */
export default function AvatarBadge({
  icon: BadgeIcon,
  tone,
  size = 'md',
  label,
  className,
}: {
  icon: Icon
  tone: keyof typeof TONES
  size?: keyof typeof SIZES
  /** Read out by screen readers; leave out when the text next to it already says it. */
  label?: string
  className?: string
}) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('absolute grid place-items-center ring-ground', TONES[tone], SIZES[size], className)}
    >
      <BadgeIcon weight="fill" />
    </span>
  )
}
