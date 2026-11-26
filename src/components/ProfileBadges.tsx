import { profileBadgesOf } from '@/games/registry'
import type { GameData } from '@/lib/types'
import type { ProfileBadge } from '@/games/types'
import { cn } from '@/lib/utils'

/**
 * A badge's icon by its job (docs/identity.md, Colour jobs): gold only for a
 * win, pink for the hunt's, and paper for anything else, since the guest
 * colours (teal, violet) are identity only, never a status.
 */
const TONES: Record<NonNullable<ProfileBadge['tone']>, string> = {
  gold: 'text-gold',
  pink: 'text-pink',
  teal: 'text-paper-2',
  violet: 'text-paper-2',
}

/** The badges every game has put on a player's profile: square chips on the overlay surface, like every chip with words. */
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
  const badges = profileBadgesOf(profile)
  if (badges.length === 0) return null

  return (
    <span className={cn('inline-flex flex-wrap gap-1', className)}>
      {badges.map((badge) => (
        <span
          key={badge.label}
          className={cn(
            'inline-flex items-center gap-1 rounded-chip bg-overlay font-semibold whitespace-nowrap',
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
