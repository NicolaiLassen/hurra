import { useEffect, useState } from 'react'
import { usePlayerPhoto } from '@/lib/photoIndex'
import { cn } from '@/lib/utils'

const COLORS = ['bg-primary', 'bg-confetti-pink', 'bg-confetti-teal', 'bg-confetti-violet']
/** A photo that failed to load (a Wi-Fi blip, a file just deleted) is tried again after this long. */
const RETRY_MS = 60_000
/** Photos this tab has drawn: an avatar mounted again starts them opaque, with no fade. */
const drawn = new Set<string>()

/**
 * A player's face: their photo, or their initials on a colour derived from
 * the name (so a player keeps their colour) when there is none, while it
 * loads and when it fails. The photo comes from the nearest
 * LiveSessionProvider, already measured (docs/guest-photos.md, 4.4 and 5):
 * by `playerId` when given, else by the exact name of a current player of the
 * party, since names are unique in a party. `src` (a URL, or null for none)
 * overrides both: the phone's own preview. Nothing this file imports reaches
 * the Supabase client.
 */
export default function Avatar({
  name,
  playerId,
  src,
  className,
}: {
  name: string
  playerId?: string
  src?: string | null
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
  // The initials stay under the photo until this element's own image has
  // loaded, so a remount never shows an empty disc.
  const covered = photo !== null && photo === loaded
  const opaque = photo !== null && (covered || drawn.has(photo))
  const hash = Array.from(name).reduce((h, ch) => (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0, 7)
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join('')
    .toUpperCase()

  return (
    <span
      aria-hidden
      className={cn(
        'relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-full font-black text-background',
        covered ? 'bg-secondary' : COLORS[hash % COLORS.length],
        className,
      )}
    >
      {initials}
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
            'pointer-events-none absolute inset-0 size-full rounded-full object-cover select-none [-webkit-touch-callout:none]',
            'transition-opacity duration-200 motion-reduce:transition-none',
            opaque ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}
    </span>
  )
}
