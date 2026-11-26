// Participant fusion's parts on the TV (docs/identity.md, Participant fusion
// on the TV): a picture drawn sharp without a blink, the countdown and the
// lock-in pips in the quiz's visual language (drawn here with the same tokens
// and sizes, so fusion never imports the quiz), a guest's name on a paper
// chip, and the sharpest eyes row.
import { motion } from 'motion/react'
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import Avatar from '@/components/Avatar'
import type { FusionPublicPicture, FusionTopRow } from '@/games/fusion/shapes'
import { EASE_OUT, firstName, nameOf, URGENT_MS } from '@/games/fusion/tvLook'
import type { Player } from '@/lib/types'
import { cn } from '@/lib/utils'

type MediaUrl = (path: string, size?: 'full' | 'thumb') => string

/**
 * A picture as the TV draws it, filling its box: the thumbnail at once and,
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
  mediaUrl: MediaUrl
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
 * revealed tiles and the reveal both name the two this way. Its size comes
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
