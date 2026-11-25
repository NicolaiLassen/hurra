// The parts of Lydspor's TV screens (.design/lydspor/spec.md, section 9): a
// photo that never shows a broken image, its letter chip, the wall, the
// running order and the pips. Nothing here can show a typed answer: the parts
// take only the public state's wall, times and counts.
import { useState } from 'react'
import { clockTime } from '@/components/tv/clock'
import type { TvViewProps } from '@/games/types'
import { useElementSize } from '@/lib/useElementSize'
import { cn } from '@/lib/utils'
import { letterOf } from '../types'
import { orderColumns, wallGrid } from './fit'

type MediaUrl = TvViewProps['mediaUrl']

/**
 * A photo from game media, cropped to its box. While it loads, and if it
 * fails (a deleted upload, the venue's connection), the overlay surface
 * stands in its place, so the wall never shows a broken image; the letter
 * chip on it still says which photo it is.
 */
export function Photo({ path, mediaUrl, alt, className }: { path: string; mediaUrl: MediaUrl; alt: string; className?: string }) {
  const src = path ? mediaUrl(path, 'full') : ''
  const [failed, setFailed] = useState<string | null>(null)
  if (!src || failed === src) return <div role="img" aria-label={alt} className={cn('bg-overlay', className)} />
  return (
    <img
      src={src}
      alt={alt}
      // The full image is about 1600 px on its long edge.
      width={1600}
      height={1600}
      decoding="async"
      onError={() => setFailed(src)}
      className={cn('bg-overlay object-cover', className)}
    />
  )
}

/** Each chip sits at its own small tilt, like the quiz's letters: only tabs, letter chips and hero tokens tilt. */
const TILTS = ['-rotate-3', 'rotate-2', '-rotate-2', 'rotate-3'] as const

/** A photo's letter on a paper chip, in wide Archivo, tilted. Size and place come from `className`. */
export function LetterChip({ index, className }: { index: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('grid shrink-0 place-items-center rounded-chip bg-paper wide leading-none text-ink', TILTS[index % TILTS.length], className)}
    >
      {letterOf(index)}
    </span>
  )
}

/**
 * The wall: every photo in the phones' order, lettered A on, as big as the
 * box allows at 6 to 5 (12 photos are 4 across and 3 down). No titles, no
 * singers, no names and no counts on a photo, so nothing spoils; a caption
 * only with the hints setting on.
 */
export function Wall({
  wall,
  mediaUrl,
  className,
}: {
  wall: readonly { path: string; hint: string | null }[]
  mediaUrl: MediaUrl
  className?: string
}) {
  const [ref, { width, height }] = useElementSize<HTMLDivElement>()
  const gap = width >= 800 ? 16 : 12
  const grid = wallGrid(wall.length, width, height, gap)
  return (
    <div ref={ref} className={cn('min-h-0 min-w-0', className)}>
      {grid.tileWidth > 0 && (
        <ol
          aria-label="The photos"
          className="grid h-full content-start justify-end"
          style={{ gridTemplateColumns: `repeat(${grid.columns}, ${grid.tileWidth}px)`, gridAutoRows: `${grid.tileHeight}px`, gap }}
        >
          {wall.map((photo, i) => (
            <li key={i} className="@container relative overflow-hidden rounded-tile bg-overlay">
              <Photo path={photo.path} mediaUrl={mediaUrl} alt={`Photo ${letterOf(i)}`} className="absolute inset-0 size-full" />
              {/* The chip and its letter never go under the TV's floor, however small the tile; so does a hint, on a band across the photo's foot. */}
              <LetterChip
                index={i}
                className="absolute top-[5cqw] left-[5cqw] size-[max(2.75rem,19cqw)] text-[length:max(var(--text-tv-floor),12cqw)]"
              />
              {photo.hint && (
                <span className="absolute inset-x-0 bottom-0 line-clamp-2 bg-paper px-[4cqw] py-[1.5cqw] text-[length:max(var(--text-tv-floor),9cqw)] leading-[1.12] font-bold break-words text-ink">
                  {photo.hint}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** A running order cell's least width, px: room for a start time in the floor's size (21:29 is 55 px). */
const MIN_CELL = 62

/**
 * The running order: one cell per song. Played songs on the overlay surface
 * with the clock time they started (a time the database holds), the song now
 * playing in gold and tilted like a tab (on air), songs to come as rule
 * outlines (after an early last call, songs never played stay outlined).
 * Every song on one row while the cells keep their room, else two.
 */
export function RunningOrder({
  total,
  playedAt,
  playing,
  className,
}: {
  total: number
  playedAt: readonly number[]
  playing: boolean
  className?: string
}) {
  const [ref, { width }] = useElementSize<HTMLOListElement>()
  const gap = width >= 640 ? 10 : 6
  const columns = orderColumns(total, width, MIN_CELL, gap)
  const now = playing ? playedAt.length - 1 : -1
  return (
    <ol
      ref={ref}
      aria-label="The running order"
      className={cn('grid', className)}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 6.5rem))`, gap }}
    >
      {Array.from({ length: total }, (_, i) => {
        const at = playedAt[i]
        const state = i === now ? 'now' : at !== undefined ? 'played' : 'next'
        return (
          <li
            key={i}
            aria-label={
              state === 'now'
                ? `Song ${i + 1}, playing since ${clockTime(at)}`
                : state === 'played'
                  ? `Song ${i + 1}, played at ${clockTime(at)}`
                  : playing
                    ? `Song ${i + 1}, still to come`
                    : `Song ${i + 1}, not played`
            }
            className={cn(
              'flex h-26 min-w-0 flex-col items-center justify-center rounded-tile short:h-22 low:h-19',
              state === 'now' && 'z-10 -rotate-2 bg-gold text-ink',
              state === 'played' && 'bg-overlay text-paper',
              state === 'next' && 'border-[3px] border-rule text-paper-3',
            )}
          >
            <span className="tv-num text-tv-name leading-none short:text-tv-band low:text-tv-field">{i + 1}</span>
            {at !== undefined && (
              <time
                dateTime={new Date(at).toISOString()}
                className={cn('mt-1.5 tv-num text-tv-floor leading-none', state === 'played' && 'text-paper-2')}
              >
                {clockTime(at)}
              </time>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** The pips lean like the letter chips, in a fixed pattern so each keeps its tilt. */
const PIP_TILTS = ['-rotate-3', 'rotate-2', '-rotate-1', 'rotate-3', '-rotate-2', 'rotate-1', 'rotate-3', '-rotate-2'] as const

/**
 * One tilted paper pip per guest who can score, filled as they type a title
 * (an empty one is a rule outline): counts only, never names. They shrink to
 * fit their row, so 45 guests still fit on one line.
 */
export function Pips({ count, total, className }: { count: number; total: number; className?: string }) {
  const pips = Math.max(total, count)
  return (
    <div
      aria-hidden
      className={cn('grid min-w-0 gap-2 [--pip:1.625rem] short:gap-1.5 short:[--pip:1.375rem] low:[--pip:1.125rem]', className)}
      style={{ gridTemplateColumns: `repeat(${pips}, minmax(0, var(--pip)))` }}
    >
      {Array.from({ length: pips }, (_, i) => (
        <span
          key={i}
          className={cn(
            'aspect-square rounded-[3px] transition-colors duration-300',
            PIP_TILTS[i % PIP_TILTS.length],
            i < count ? 'bg-paper' : 'border-[3px] border-rule short:border-2',
          )}
        />
      ))}
    </div>
  )
}
