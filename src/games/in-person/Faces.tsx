import { CrownIcon } from '@phosphor-icons/react'
import Avatar from '@/components/Avatar'
import AvatarBadge from '@/components/AvatarBadge'
import { cn } from '@/lib/utils'

const SIZES = {
  md: { avatar: 'size-10 text-sm', overlap: '-space-x-3', badge: 'md' },
  lg: { avatar: 'size-11 text-base short:size-9 short:text-sm', overlap: '-space-x-3 short:-space-x-2', badge: 'md' },
} as const
/** The first face on top, so its crown isn't hidden under the next one. */
const STACK = ['z-30', 'z-20', 'z-10']

/** The top scorers' faces, overlapping, at most three; `crown` marks the first as a winner. */
export default function Faces({
  names,
  size = 'md',
  crown = false,
  className,
}: {
  names: readonly string[]
  size?: keyof typeof SIZES
  crown?: boolean
  className?: string
}) {
  const s = SIZES[size]
  return (
    <span aria-hidden className={cn('flex shrink-0', s.overlap, className)}>
      {names.slice(0, STACK.length).map((name, i) => (
        <span key={i} className={cn('relative', STACK[i])}>
          <Avatar name={name} className={cn('ring-2 ring-card', s.avatar)} />
          {crown && i === 0 && <AvatarBadge icon={CrownIcon} tone="gold" size={s.badge} />}
        </span>
      ))}
    </span>
  )
}
