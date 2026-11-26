// Participant fusion's parts every screen shares (the TV, the phones, the host
// room), in the Running Order look (docs/identity.md): a picture on the raised
// surface, its label as a tilted paper chip, and two people as tokens.
import { useState } from 'react'
import Avatar from '@/components/Avatar'
import type { PlayerId } from '@/games/core/Game'
import type { FusionPublicPicture } from '@/games/fusion/shapes'
import { nameOf, type Pickable } from '@/games/fusion/view'
import { cn } from '@/lib/utils'

/**
 * A picture as the screens draw it: its image on the raised surface, which
 * shows round an image of another shape with `fit="contain"`. Without an
 * image, or when it fails to load, its label stands large in `wide` on the
 * raised surface instead (the print on the wall is the real thing). Phones and
 * small tiles use the thumbnail, lazily; the TV's frame uses the full image.
 */
export function PictureArt({
  picture,
  mediaUrl,
  size,
  fit = 'cover',
  className,
  labelClassName,
  numberClassName,
}: {
  picture: Pick<FusionPublicPicture, 'n' | 'label' | 'image'>
  mediaUrl: (path: string, size?: 'full' | 'thumb') => string
  size: 'thumb' | 'full'
  /** `cover` fills the box (faces sit 35 percent from the top); `contain` shows the whole picture. */
  fit?: 'cover' | 'contain'
  className?: string
  /** The label's text size when there is no image. Default: a share of the box's width. */
  labelClassName?: string
  /** The background version's name for labelClassName; the old screens still pass it. */
  numberClassName?: string
}) {
  const src = picture.image ? mediaUrl(picture.image, size) : null
  // Which source failed, so a new image tries again.
  const [failed, setFailed] = useState<string | null>(null)
  if (src && failed !== src) {
    return (
      <img
        src={src}
        alt={`Picture ${picture.label}`}
        // Thumbnails are 400 px on their long edge; the full image about 1600 px.
        width={size === 'thumb' ? 320 : 1280}
        height={size === 'thumb' ? 400 : 1600}
        loading={size === 'thumb' ? 'lazy' : 'eager'}
        decoding="async"
        onError={() => setFailed(src)}
        className={cn('bg-raised', fit === 'cover' ? 'object-cover object-[50%_35%]' : 'object-contain', className)}
      />
    )
  }
  return (
    <div role="img" aria-label={`Picture ${picture.label}`} className={cn('@container grid place-items-center bg-raised', className)}>
      <span className={cn('wide max-w-full truncate px-[6cqw] py-[0.12em] leading-none text-paper text-[28cqw]', labelClassName ?? numberClassName)}>
        {picture.label}
      </span>
    </div>
  )
}

/**
 * A picture's label as a letter chip: paper with ink, `wide`, on the chip
 * radius, tilted 2 degrees. Its text size comes from `className`.
 */
export function LabelChip({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn('wide inline-block max-w-full -rotate-2 truncate rounded-chip bg-paper px-[0.3em] py-[0.12em] leading-none text-ink', className)}
    >
      {label}
    </span>
  )
}

/**
 * Two people: their tokens side by side and "Mads and Anna", or one per row
 * when `stacked`. A token carries the guest's photo by their id, or `photos`
 * (a revealed picture's own photos of them) where given; someone who has left
 * keeps the name the round kept for them.
 */
export function Pair({
  people,
  players,
  kept,
  photos,
  meId,
  stacked = false,
  className,
  avatarClassName = 'size-7',
}: {
  people: readonly PlayerId[]
  players: readonly Pickable[]
  /** Names a reveal kept, for anyone who has left since. */
  kept?: readonly string[]
  /** A photo URL for each person in its place, over their profile photo; null keeps theirs. */
  photos?: readonly (string | null)[]
  /** Shown as "You". */
  meId?: PlayerId
  stacked?: boolean
  className?: string
  avatarClassName?: string
}) {
  const names = people.map((id, i) => nameOf(players, id, kept?.[i]))
  // undefined lets Avatar find the guest's own photo; a URL shows that photo instead.
  const srcOf = (i: number) => photos?.[i] ?? undefined
  const shown = people.map((id, i) => (id === meId ? 'You' : names[i]))
  if (stacked) {
    return (
      <ul className={cn('grid gap-1.5', className)}>
        {people.map((id, i) => (
          <li key={id} className="flex min-w-0 items-center gap-2">
            <Avatar name={names[i]} playerId={id} src={srcOf(i)} className={cn('shrink-0', avatarClassName)} />
            <span className="min-w-0 truncate font-semibold">{shown[i]}</span>
          </li>
        ))}
      </ul>
    )
  }
  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)}>
      <span className="flex shrink-0 gap-1">
        {people.map((id, i) => (
          <Avatar key={id} name={names[i]} playerId={id} src={srcOf(i)} className={avatarClassName} />
        ))}
      </span>
      <span className="min-w-0 truncate font-semibold">{shown.join(' and ')}</span>
    </span>
  )
}
