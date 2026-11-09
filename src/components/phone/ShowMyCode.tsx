import { QrCodeIcon } from '@phosphor-icons/react'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { Player } from '@/lib/types'
import { playerUrl } from '@/lib/urls'

/**
 * The "Show my code" bar, in reach at the bottom of the phone home (in-person
 * games need your code at a moment's notice), and the full-screen QR code it
 * opens: white, so it scans in a dark room. Tap anywhere to close.
 *
 * `hidden` steps the bar aside (while a timed question is open, so it covers
 * no answer); a QR code already open stays open.
 */
export default function ShowMyCode({ player, hidden = false }: { player: Pick<Player, 'name' | 'code'>; hidden?: boolean }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      {!hidden && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/85 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] backdrop-blur">
          <div className="mx-auto max-w-md px-4">
            <Button size="xl" variant="secondary" className="w-full" onClick={() => setOpen(true)}>
              <QrCodeIcon />
              Show my code
              <span className="font-mono text-sm tracking-widest text-muted-foreground">{player.code}</span>
            </Button>
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
