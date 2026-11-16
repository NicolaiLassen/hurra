import { useEffect, useState } from 'react'
import Piece from '@/components/Piece'
import { GUEST_BG, guestLook, slateLines, slateSize } from '@/lib/guest'
import { PLACEHOLDER_NAMES, usePlayerPhoto } from '@/lib/photoIndex'
import { cn } from '@/lib/utils'

/** A photo that failed to load (a Wi-Fi blip, a file just deleted) is tried again after this long. */
const RETRY_MS = 60_000
/** Photos this tab has drawn: an avatar mounted again starts them opaque, with no fade. */
const drawn = new Set<string>()

/**
 * A guest's token (docs/identity.md, The player token): a square with a 14
 * percent radius, at whatever size `className` gives it.
 *
 * - With a photo: the square crop, with a band in the guest's colour along
 *   the bottom.
 * - Without one (and while it loads, and when it fails): the guest's colour
 *   with their piece in ink; from 96 px up, their whole first name instead,
 *   fitted and never cut. A container query on the token picks between them,
 *   so the token follows whatever size it is drawn at, short: steps included.
 * - `out` (knocked out of the game on screen): one pink stripe across it,
 *   over a dimmed piece or photo. A name stays at full strength.
 *
 * Colour and piece come from guestLook (src/lib/guest.ts), keyed on the name,
 * so the TV, every phone and the host room agree. The photo comes from the
 * nearest LiveSessionProvider, already measured (docs/guest-photos.md, 4.4
 * and 5): by `playerId` when given, else by the exact name of a current player
 * of the party, since names are unique in a party. `src` (a URL, or null for
 * none) overrides both: the phone's own preview. Nothing this file imports
 * reaches the Supabase client.
 */
export default function Avatar({
  name,
  playerId,
  src,
  out = false,
  className,
}: {
  name: string
  playerId?: string
  src?: string | null
  /** Knocked out of the game on screen (the hunt): the pink stripe. Print the word Out beside the name too. */
  out?: boolean
  className?: string
}) {
  const found = usePlayerPhoto(playerId, name)
  const url = src === undefined ? found : src
  const [loaded, setLoaded] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => {
    if (failed === null) return
    const timer = setTimeout(() => setFailed(null), RETRY_MS)
    return () => clearTimeout(timer)
  }, [failed])

  const photo = url && url !== failed ? url : null
  // The colour and piece stay under the photo until this element's own image
  // has loaded, so a remount never shows an empty token.
  const covered = photo !== null && photo === loaded
  const opaque = photo !== null && (covered || drawn.has(photo))
  const { color, piece } = guestLook(name)
  // Someone who isn't a player (any more) has no first name to show, only a piece.
  const lines = PLACEHOLDER_NAMES.has(name) ? [] : slateLines(name)
  const hasName = lines.length > 0

  return (
    <span
      aria-hidden
      data-out={out ? '' : undefined}
      className={cn(
        '@container relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-token text-ink select-none',
        covered ? 'bg-ground' : GUEST_BG[color],
        className,
      )}
    >
      {!covered && (
        <Piece kind={piece} className={cn('size-[62cqi]', hasName && '@min-[96px]:hidden', out && 'opacity-50')} />
      )}
      {!covered && hasName && (
        <span
          data-slate=""
          className="hidden -rotate-4 text-center font-display leading-[0.9] font-black tracking-[-0.01em] whitespace-nowrap font-stretch-62% @min-[96px]:block"
          style={{ fontSize: `${(slateSize(lines) * 100).toFixed(2)}cqi` }}
        >
          {lines.map((line, i) => (
            <span key={i} className="block">
              {line}
            </span>
          ))}
        </span>
      )}
      {photo && (
        <img
          src={photo}
          alt=""
          draggable={false}
          decoding="async"
          loading="lazy"
          fetchPriority="low"
          onLoad={() => {
            drawn.add(photo)
            setLoaded(photo)
          }}
          onError={() => {
            drawn.delete(photo)
            setFailed(photo)
          }}
          className={cn(
            'pointer-events-none absolute inset-0 size-full rounded-[inherit] object-cover select-none [-webkit-touch-callout:none]',
            'transition-opacity duration-200 motion-reduce:transition-none',
            opaque ? 'opacity-100' : 'opacity-0',
            out && 'brightness-50',
          )}
        />
      )}
      {/* The band: invisible on the guest's own colour while the photo loads. */}
      {photo && <span data-band="" className={cn('absolute inset-x-0 bottom-0 h-[max(3px,7.5cqi)]', GUEST_BG[color])} />}
      {out && (
        <span data-stripe="" className="absolute top-1/2 left-1/2 h-[max(4px,10cqi)] w-[150cqi] -translate-1/2 -rotate-45 bg-pink" />
      )}
    </span>
  )
}
