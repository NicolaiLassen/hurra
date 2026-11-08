import { gameModules } from '@/games/registry'
import type { GameData } from '@/lib/types'
import type { ProfileBadge } from '@/games/types'
import { cn } from '@/lib/utils'

const TONES: Record<NonNullable<ProfileBadge['tone']>, string> = {
  gold: 'text-primary',
  pink: 'text-confetti-pink',
  teal: 'text-confetti-teal',
  violet: 'text-confetti-violet',
}

/** The badges every game has put on a player's profile. */
export default function ProfileBadges({
  profile,
  size = 'sm',
  className,
}: {
  profile: GameData | undefined
  /** 'lg' for the TV scoreboard. */
  size?: 'sm' | 'lg'
  className?: string
}) {
  const badges = gameModules.flatMap((m) => {
    const data = profile?.[m.logic.type]
    return data && m.profileBadges ? m.profileBadges(data) : []
  })
  if (badges.length === 0) return null

  return (
    <span className={cn('inline-flex flex-wrap gap-1', className)}>
      {badges.map((badge) => (
        <span
          key={badge.label}
          className={cn(
            'inline-flex items-center gap-1 rounded-full bg-white/10 font-semibold whitespace-nowrap',
            size === 'lg' ? 'px-3 py-1 text-lg' : 'px-2 py-0.5 text-xs',
          )}
        >
          <badge.icon
            aria-hidden
            weight="fill"
            className={cn('shrink-0', TONES[badge.tone ?? 'gold'], size === 'lg' ? 'size-5' : 'size-3.5')}
          />
          {badge.label}
        </span>
      ))}
    </span>
  )
}
