import Avatar from '@/components/Avatar'
import type { PlayerId } from '@/games/core/Game'
import type { FusionPublicPicture } from '@/games/fusion/logic'
import { nameOf } from '@/games/fusion/view'
import type { Player } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * A picture as the screens draw it: the image when the host uploaded one,
 * else its number large in paper-2 on the overlay surface (the print on the
 * wall is the real thing; violet is a guest's colour, so never a picture's). Phones use the thumbnail, lazily; the TV uses the full image.
 */
export function PictureArt({
  picture,
  mediaUrl,
  size,
  className,
  numberClassName,
}: {
  picture: Pick<FusionPublicPicture, 'n' | 'label' | 'image'>
  mediaUrl: (path: string, size?: 'full' | 'thumb') => string
  size: 'thumb' | 'full'
  className?: string
  /** The number's text size when there is no image. */
  numberClassName?: string
}) {
  if (picture.image) {
    return (
      <img
        src={mediaUrl(picture.image, size)}
        alt={`Picture ${picture.label}`}
        // Thumbnails are 400 px; the full image is about 1600 px on its long edge.
        width={size === 'thumb' ? 400 : 1600}
        height={size === 'thumb' ? 400 : 1600}
        loading={size === 'thumb' ? 'lazy' : 'eager'}
        decoding="async"
        className={cn('bg-muted object-cover', className)}
      />
    )
  }
  return (
    <div
      role="img"
      aria-label={`Picture ${picture.label}`}
      className={cn('grid place-items-center bg-overlay font-black text-paper-2', className)}
    >
      <span className={cn('text-5xl leading-none tabular-nums', numberClassName)}>{picture.n}</span>
    </div>
  )
}

/** Two people: overlapping avatars and "Mads and Anna", or one per row when `stacked` (narrow cards). */
export function Pair({
  people,
  players,
  kept,
  meId,
  stacked = false,
  className,
  avatarClassName = 'size-7',
}: {
  people: readonly PlayerId[]
  players: readonly Player[]
  /** Names a reveal kept, for anyone who has left since. */
  kept?: readonly string[]
  /** Shown as "You". */
  meId?: PlayerId
  stacked?: boolean
  className?: string
  avatarClassName?: string
}) {
  const names = people.map((id, i) => (id === meId ? 'You' : nameOf(players, id, kept?.[i])))
  if (stacked) {
    return (
      <ul className={cn('grid gap-1', className)}>
        {people.map((id, i) => (
          <li key={id} className="flex min-w-0 items-center gap-2">
            <Avatar name={nameOf(players, id, kept?.[i])} className={avatarClassName} />
            <span className="min-w-0 truncate font-semibold">{names[i]}</span>
          </li>
        ))}
      </ul>
    )
  }
  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)}>
      <span className="flex shrink-0 -space-x-2">
        {people.map((id, i) => (
          <Avatar
            key={id}
            name={nameOf(players, id, kept?.[i])}
            className={cn('ring-2 ring-card', avatarClassName)}
          />
        ))}
      </span>
      <span className="min-w-0 truncate font-semibold">{names.join(' and ')}</span>
    </span>
  )
}
