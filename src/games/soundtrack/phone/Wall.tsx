import { ArrowsLeftRightIcon, CheckIcon, ImageIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { letterOf } from '@/games/soundtrack/types'
import { cn } from '@/lib/utils'
import type { Band } from './model'

// The wall of photos on a phone (spec 4.3 and 4.6): lettered A to L in the
// same order as on the TV and every phone, 3 across in 6 to 5 tiles, each
// saying what a tap does before the tap: "Here now", "Swap with 4", or
// nothing for a free photo.

/** A photo from game media, or a quiet stand-in while it is missing (a failed load never shows a broken image). */
export function PhotoImage({ src, className }: { src: string; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (failed === src || src === '') {
    return (
      <span aria-hidden className={cn('grid place-items-center bg-overlay', className)}>
        <ImageIcon weight="duotone" className="size-6 text-paper-3" />
      </span>
    )
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(src)}
      className={cn('object-cover', className)}
    />
  )
}

/**
 * A song's photo across the phone (the reveal, and Now playing with typed moments on): the thumbnail at once, then the
 * full photo over it once it has loaded, so a real photo is sharp on a 3x
 * screen. If the full one fails, the thumbnail stays.
 */
export function HeroPhoto({ thumb, full }: { thumb: string; full: string }) {
  const [loaded, setLoaded] = useState<string | null>(null)
  return (
    <>
      <PhotoImage src={thumb} className="absolute inset-0 size-full" />
      {full !== '' && (
        <img
          src={full}
          alt=""
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(full)}
          className={cn(
            'absolute inset-0 size-full object-cover transition-opacity duration-300 motion-reduce:transition-none',
            loaded === full ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}
    </>
  )
}

/** A photo's tilted letter chip, paper with ink, as on the TV. */
export function LetterChip({ index, size = 'tile', className }: { index: number; size?: 'tile' | 'small' | 'hero'; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'absolute z-[2] -rotate-3 rounded-chip bg-paper text-center text-ink wide',
        size === 'tile' && 'top-[5px] left-[5px] h-[26px] min-w-[26px] px-[5px] text-[15px] leading-[26px]',
        size === 'small' && 'top-[3px] left-[3px] h-5 min-w-5 px-[3px] text-[13px] leading-5',
        size === 'hero' && 'top-2.5 left-2.5 h-8 min-w-8 px-1.5 text-[18px] leading-8',
        className,
      )}
    >
      {letterOf(index)}
    </span>
  )
}

/** What a tile's accessible name says after its letter. */
function bandWords(band: Band): string {
  if (!band) return ''
  return band.kind === 'here' ? ', here now' : `, swap with song ${band.with}`
}

export function Wall({
  photos,
  bandOf,
  thumbUrl,
  onTap,
  disabled = false,
  failed = null,
  surface = 'ground',
  label,
}: {
  /** The wall in letter order: each photo's path, and its caption with hints on. */
  photos: readonly { path: string; hint: string | null }[]
  bandOf: (index: number) => Band
  thumbUrl: (path: string) => string
  onTap: (index: number) => void
  disabled?: boolean
  /** The photo whose tap could not be sent: its band says to tap again. */
  failed?: number | null
  /** What the wall stands on: the bands of other songs' photos match it. */
  surface?: 'ground' | 'raised'
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-3 gap-2 max-[379px]:gap-1.5">
      {photos.map((photo, i) => {
        const band = bandOf(i)
        const here = band?.kind === 'here'
        const retry = failed === i && !here
        return (
          <div key={i} className="grid grid-cols-1 content-start gap-1">
            <button
              type="button"
              aria-label={`Photo ${letterOf(i)}${bandWords(band)}`}
              aria-pressed={here}
              aria-disabled={disabled || undefined}
              onClick={() => {
                if (!disabled) onTap(i)
              }}
              className={cn(
                'relative block aspect-[6/5] w-full overflow-hidden rounded-[12px] bg-overlay outline-none select-none',
                'focus-visible:ring-3 focus-visible:ring-gold/50',
                // Here now: a paper edge inside the tile, never a glow.
                here && 'after:pointer-events-none after:absolute after:inset-0 after:rounded-[12px] after:border-4 after:border-paper',
              )}
            >
              <PhotoImage src={thumbUrl(photo.path)} className="absolute inset-0 size-full" />
              <LetterChip index={i} />
              {(band || retry) && (
                <span
                  className={cn(
                    'absolute inset-x-0 bottom-0 z-[1] flex h-7 items-center justify-center gap-1 text-[13px] font-extrabold whitespace-nowrap',
                    here ? 'bg-paper text-ink' : surface === 'raised' ? 'bg-raised text-paper' : 'bg-ground text-paper',
                  )}
                >
                  {retry ? (
                    'Tap again'
                  ) : here ? (
                    <>
                      <CheckIcon weight="bold" className="size-3.5 shrink-0 max-[379px]:hidden" />
                      Here now
                    </>
                  ) : (
                    band && (
                      <>
                        <ArrowsLeftRightIcon weight="bold" className="size-3.5 shrink-0 max-[379px]:hidden" />
                        Swap with {band.with}
                      </>
                    )
                  )}
                </span>
              )}
            </button>
            {photo.hint && <span className="line-clamp-2 text-[13px] leading-tight font-semibold text-paper-2">{photo.hint}</span>}
          </div>
        )
      })}
    </div>
  )
}
