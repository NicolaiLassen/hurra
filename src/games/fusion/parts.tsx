// Participant fusion's parts every screen shares (the TV, the phones, the host
// room), in the Running Order look (docs/identity.md): a picture on the raised
// surface (lazily as a thumbnail, or sharp with the full image over the
// thumbnail), the placeholder of a picture not asked yet, its label as a
// tilted paper chip, two people as tokens, and a name on a paper chip. No
// motion here, so phones can draw them.
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import Avatar from '@/components/Avatar'
import type { FusionPublicPicture } from '@/games/fusion/shapes'
import { playerNamed } from '@/games/fusion/view'
import type { Player } from '@/lib/types'
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
 * Two people by name: their tokens side by side and "Mads and Anna", or one
 * per row when `stacked`. A name that is a guest's here wears that guest's
 * token (and photo, or `photos`, a revealed picture's own photos of them,
 * where given); a name nobody joined with gets a token of its own.
 */
export function Pair({
  names,
  players,
  photos,
  me,
  stacked = false,
  className,
  avatarClassName = 'size-7',
}: {
  names: readonly string[]
  players: readonly Pick<Player, 'id' | 'name'>[]
  /** A photo URL for each person in its place, over their profile photo; null keeps theirs. */
  photos?: readonly (string | null)[]
  /** This phone's guest's name: shown as "You". */
  me?: string
  stacked?: boolean
  className?: string
  avatarClassName?: string
}) {
  const ids = names.map((name) => playerNamed(players, name)?.id)
  // undefined lets Avatar find the guest's own photo; a URL shows that photo instead.
  const srcOf = (i: number) => photos?.[i] ?? (ids[i] === undefined ? null : undefined)
  const shown = names.map((name, i) => (me !== undefined && ids[i] !== undefined && playerNamed(players, me)?.id === ids[i] ? 'You' : name))
  if (stacked) {
    return (
      <ul className={cn('grid gap-1.5', className)}>
        {names.map((name, i) => (
          <li key={`${i}:${name}`} className="flex min-w-0 items-center gap-2">
            <Avatar name={name} playerId={ids[i]} src={srcOf(i)} className={cn('shrink-0', avatarClassName)} />
            <span className="min-w-0 truncate font-semibold">{shown[i]}</span>
          </li>
        ))}
      </ul>
    )
  }
  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)}>
      <span className="flex shrink-0 gap-1">
        {names.map((name, i) => (
          <Avatar key={`${i}:${name}`} name={name} playerId={ids[i]} src={srcOf(i)} className={avatarClassName} />
        ))}
      </span>
      <span className="min-w-0 truncate font-semibold">{shown.join(' and ')}</span>
    </span>
  )
}

/**
 * A picture not asked yet: nobody knows what it looks like. A drawn head and
 * shoulders, flat, in `rule` on the raised surface, with a big "?" in the on
 * air voice over its face, drawn in the same box so it sits on the head at
 * every size and shape. `lit` while the TV's highlight is on it: paper, the
 * figure in `paper-2` and the "?" in ink. No glow, no gradient. Its label chip
 * is the caller's, as on any picture.
 */
export function Placeholder({
  label,
  lit = false,
  className,
  mark,
}: {
  label: string
  lit?: boolean
  className?: string
  /** Wraps the "?" (an SVG element; the TV's frame pulses it). */
  mark?: (mark: ReactNode) => ReactNode
}) {
  const sign = (
    <text
      data-placeholder-mark=""
      x="50"
      y="50"
      textAnchor="middle"
      dominantBaseline="central"
      className={cn('wide', lit ? 'fill-ink' : 'fill-paper')}
      style={{ fontSize: 50 }}
    >
      ?
    </text>
  )
  return (
    <div
      role="img"
      aria-label={`Picture ${label}, not shown yet`}
      data-placeholder={lit ? 'lit' : ''}
      className={cn('relative overflow-hidden', lit ? 'bg-paper' : 'bg-raised', className)}
    >
      <svg aria-hidden viewBox="0 0 100 125" preserveAspectRatio="xMidYMax meet" className="absolute inset-x-0 bottom-0 h-[86%] w-full">
        <g className={lit ? 'fill-paper-2' : 'fill-rule'}>
          <circle cx="50" cy="50" r="22" />
          <path d="M8 125 C8 94 27 79 50 79 C73 79 92 94 92 125 Z" />
        </g>
        {mark ? mark(sign) : sign}
      </svg>
    </div>
  )
}

/**
 * A picture drawn sharp, filling its box (the TV, and a phone's reveal): the thumbnail at once and,
 * with `size` full, the full image over it, fading in over 200 ms once it has
 * loaded; one already decoded (preloaded) shows at once. A full image that
 * fails keeps the thumbnail; with neither, or no image at all, the label
 * stands large in `wide` on the raised surface (the print is the real thing).
 */
export function PictureImage({
  picture,
  mediaUrl,
  size,
  fit,
  className,
  labelClassName,
  alt,
}: {
  picture: Pick<FusionPublicPicture, 'label' | 'image'>
  mediaUrl: (path: string, size?: 'full' | 'thumb') => string
  size: 'thumb' | 'full'
  /** `cover` fills the box (faces sit 35 percent from the top); `contain` shows the whole picture. */
  fit: 'cover' | 'contain'
  className?: string
  /** The label's text size when there is no image to show. */
  labelClassName?: string
  /** What the image is, for a screen reader: "Picture #4" unless said. */
  alt?: string
}) {
  const thumb = picture.image ? mediaUrl(picture.image, 'thumb') : null
  const full = picture.image && size === 'full' ? mediaUrl(picture.image, 'full') : null
  // Which sources failed, so a new picture tries again.
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set())
  const fail = (src: string) => setFailed((set) => new Set(set).add(src))
  const showThumb = thumb !== null && !failed.has(thumb)
  const showFull = full !== null && !failed.has(full)
  const fitClass = fit === 'cover' ? 'object-cover object-[50%_35%]' : 'object-contain'

  return (
    <div role="img" aria-label={alt ?? `Picture ${picture.label}`} className={cn('@container relative overflow-hidden bg-raised', className)}>
      {!showThumb && !showFull ? (
        <span className="absolute inset-0 grid place-items-center">
          {/* Padded so a label's descenders ("The viking") stay inside truncate's clip. */}
          <span className={cn('wide max-w-full truncate px-[6cqw] py-[0.12em] leading-none text-paper', labelClassName ?? 'text-[28cqw]')}>{picture.label}</span>
        </span>
      ) : (
        <>
          {showThumb && (
            <img
              key={thumb}
              src={thumb}
              alt=""
              draggable={false}
              decoding="async"
              onError={() => fail(thumb)}
              className={cn('absolute inset-0 size-full', fitClass)}
            />
          )}
          {showFull && <FullImage key={full} src={full} fitClass={fitClass} onError={() => fail(full)} />}
        </>
      )}
    </div>
  )
}

/** The full image over the thumbnail: at once when it is ready as it mounts, else fading in when it loads. */
function FullImage({ src, fitClass, onError }: { src: string; fitClass: string; onError: () => void }) {
  const ref = useRef<HTMLImageElement>(null)
  const [state, setState] = useState<'waiting' | 'ready' | 'loaded'>('waiting')
  useLayoutEffect(() => {
    const img = ref.current
    // Already in memory (warmed and decoded): show it in the first frame, with no fade.
    if (img?.complete && img.naturalWidth > 0) setState('ready')
  }, [])
  return (
    <img
      ref={ref}
      src={src}
      alt=""
      draggable={false}
      decoding="async"
      onLoad={() => setState((s) => (s === 'waiting' ? 'loaded' : s))}
      onError={onError}
      className={cn(
        'absolute inset-0 size-full',
        fitClass,
        state === 'waiting' ? 'opacity-0' : 'opacity-100',
        state === 'loaded' && 'transition-opacity duration-200 ease-out',
      )}
    />
  )
}

/**
 * A guest's name on a paper chip in the condensed numerals, tilted like a
 * letter chip: the first of two one way, the second the other. The wall's
 * revealed tiles and the reveal (on the TV and on a phone) name the two this way. Its size comes
 * from `className` or `style`.
 */
export function NameChip({ name, first, className, style }: { name: string; first: boolean; className?: string; style?: CSSProperties }) {
  return (
    <span
      className={cn(
        'inline-block max-w-full truncate rounded-chip bg-paper px-[0.28em] py-[0.1em] tv-num leading-[1.1] text-ink',
        first ? '-rotate-2' : 'rotate-1',
        className,
      )}
      style={style}
    >
      {name}
    </span>
  )
}
