import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useRef, useState } from 'react'
import { SHOW_MS } from '@/components/SecretCard'
import { Button } from '@/components/ui/button'
import type { PhoneSecret } from '@/games/types'
import type { Player } from '@/lib/types'
import { playerUrl } from '@/lib/urls'
import { cn } from '@/lib/utils'

/**
 * The "Show my code" bar, in the thumb zone at the bottom of the phone home
 * (in-person games need your code at a moment's notice): the home's one gold
 * step, on a solid strip of the ground, with your code at its right. It opens
 * the full-screen QR code: white, so it scans in a dark room. Tap anywhere to
 * close.
 *
 * While a stage game takes over the phone, the bar also keeps a background
 * game's `secret` one tap away (GameModule.phoneSecret: Last one standing's
 * task): a quiet face-down card, "My task", at the bar's left. Tapped, it
 * turns over across the whole bar to show the words and turns back by itself,
 * as the secret card on the home does.
 *
 * `hidden` steps the bar aside (while a timed question is open, so it covers
 * no answer, and while the guest types, for the browsers that lift a fixed
 * bar above the keyboard); a QR code already open stays open.
 *
 * While it shows, the bar's height is `--phone-bar-height` on the root
 * element, kept current as the secret turns over and grows the bar with its
 * words, so a note a game floats above the bar (BAR_NOTE_BOTTOM) stands on
 * it instead of under the task.
 */
export default function ShowMyCode({
  player,
  hidden = false,
  secret = null,
}: {
  player: Pick<Player, 'name' | 'code'>
  hidden?: boolean
  secret?: PhoneSecret | null
}) {
  const [open, setOpen] = useState(false)
  const [turned, setTurned] = useState({ up: false, times: 0 })
  const up = secret !== null && turned.up
  const bar = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = bar.current
    if (!element) return
    const root = document.documentElement
    const publish = () => root.style.setProperty(BAR_HEIGHT, `${element.offsetHeight}px`)
    publish()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish)
    observer?.observe(element)
    return () => {
      observer?.disconnect()
      root.style.removeProperty(BAR_HEIGHT)
    }
  }, [hidden])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Face up for a few seconds, then face down again by itself, so nobody reads it over a shoulder.
  useEffect(() => {
    if (!turned.up) return
    const timer = setTimeout(() => setTurned((t) => ({ up: false, times: t.times + 1 })), SHOW_MS)
    return () => clearTimeout(timer)
  }, [turned])

  return (
    <>
      {!hidden && (
        <div ref={bar} data-code-bar="" className="fixed inset-x-0 bottom-0 z-40 bg-ground pt-3 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
          <div className="mx-auto flex max-w-md items-end gap-2 px-4">
            {secret && (
              <BarSecret
                secret={secret}
                up={up}
                turns={turned.times}
                onTurn={() => setTurned((t) => ({ up: !t.up, times: t.times + 1 }))}
              />
            )}
            {!up && (
              <Button size="xl" className="@container min-w-0 flex-1 justify-between px-[18px]" onClick={() => setOpen(true)}>
                <span className="text-phone-action font-extrabold">Show my code</span>
                {/* Where it doesn't fit (beside a secret on most phones) the code steps aside: the QR code shows it. */}
                <span className="text-[25px] leading-none tracking-[0.08em] tv-num @max-[13.5rem]:hidden">{player.code}</span>
              </Button>
            )}
          </div>
        </div>
      )}

      {open && (
        <button
          type="button"
          autoFocus
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-white p-8 text-black outline-none"
        >
          <QRCodeSVG value={playerUrl(player.code)} size={320} level="M" className="h-auto w-full max-w-sm" />
          <span className="text-center">
            <span className="block text-3xl font-bold">{player.name}</span>
            <span className="block font-mono text-xl tracking-widest">{player.code}</span>
          </span>
          <span className="text-sm text-black/50">Turn your brightness up if it won't scan. Tap anywhere to close.</span>
        </button>
      )}
    </>
  )
}

/** The CSS variable with the bar's height while it shows. */
const BAR_HEIGHT = '--phone-bar-height'

/**
 * The bottom edge for a note a game floats just above the bar (a swap note
 * with Undo): 10 px over the bar's top as it is now, its secret face up or
 * down, and over the bar at rest where no bar has said its height.
 */
export const BAR_NOTE_BOTTOM = 'bottom-[calc(var(--phone-bar-height,calc(max(env(safe-area-inset-bottom),1.25rem)+4.125rem))+0.625rem)]'

/**
 * The secret on the bar: face down, a quiet card as tall as the gold step
 * with the popper's stripes on its left edge (the secret card's look, never
 * gold); face up, the whole bar with the words. One button throughout, so the
 * focus stays on it as it turns.
 */
function BarSecret({ secret, up, turns, onTurn }: { secret: PhoneSecret; up: boolean; turns: number; onTurn: () => void }) {
  return (
    <button
      type="button"
      onClick={onTurn}
      aria-pressed={up}
      data-bar-secret=""
      className={cn(
        'relative min-h-13.5 overflow-hidden rounded-phone bg-overlay text-left perspective-[900px] focus-visible:ring-3 focus-visible:ring-gold/50 focus-visible:outline-none',
        "before:absolute before:inset-y-0 before:left-0 before:w-3.5 before:stripes before:content-['']",
        up ? 'min-w-0 flex-1' : 'shrink-0',
      )}
    >
      {/* Keyed by each turn, so the face that lands turns in; the first face down just shows. */}
      <span
        key={turns}
        className={cn(
          'flex min-h-13.5 flex-col justify-center py-2.5 pr-3.5 pl-[1.625rem]',
          turns > 0 && 'animate-card-turn motion-reduce:animate-none',
        )}
      >
        {up ? (
          <>
            <span className="block text-sm font-semibold text-paper-2">Your {secret.label}</span>
            <span className="block text-lg leading-snug font-bold">{secret.text}</span>
          </>
        ) : (
          <span className="text-phone-action font-extrabold whitespace-nowrap">My {secret.label}</span>
        )}
      </span>
    </button>
  )
}
