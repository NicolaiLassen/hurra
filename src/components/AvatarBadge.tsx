import type { Icon } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

const TONES = {
  /** A win: a gold coin with a dark icon. */
  gold: 'bg-primary text-primary-foreground',
  /** Out: a dark coin with a red icon. */
  red: 'bg-background text-destructive',
}

// Sized to the avatar it sits on: sm for size-6 avatars, md for size-10 to 12,
// lg for size-14 and up (the TV). Icons follow the badge sizes in index.css.
const SIZES = {
  sm: '-right-1 -bottom-1 size-4 ring-1 [&>svg]:size-3',
  md: '-right-1 -bottom-1 size-5 ring-2 [&>svg]:size-3.5',
  lg: '-right-1 -bottom-0.5 size-7 ring-2 [&>svg]:size-5',
}

/**
 * A status mark on an avatar's bottom right corner, such as a crown for the
 * winner or a skull for someone who's out. Put it next to the Avatar inside a
 * `relative` wrapper; it stays within a few pixels of the avatar.
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
      className={cn('absolute grid place-items-center rounded-full ring-background', TONES[tone], SIZES[size], className)}
    >
      <BadgeIcon weight="fill" />
    </span>
  )
}
