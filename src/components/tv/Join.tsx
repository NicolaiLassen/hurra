import Qr from '@/components/Qr'
import { joinUrl } from '@/lib/urls'

// The way in while joining is open (`joinPlace` in scene.ts). Codes are paper,
// never gold, and the address is this page's own, never a written one.

/** "Join with HURRA30", at the right of the band's bottom line, while a game holds the stage. */
export function JoinTag({ code }: { code: string }) {
  return (
    <p data-fit="join" className="flex h-16 shrink-0 items-center gap-4 text-tv-tab font-semibold whitespace-nowrap text-paper-2 short:h-14 short:gap-3 short:text-tv-floor">
      Join with
      <span className="font-mono text-tv-band font-extrabold tracking-[0.04em] text-paper short:text-tv-field">{code}</span>
    </p>
  )
}

/**
 * The QR code on its white quiet zone, with the code and the address it
 * opens, beside the podium on a bigger party's standings: big enough to scan
 * from a few steps away. One row, never wrapped: the board's grid widens its
 * column for it and moves the podium left instead.
 */
export function JoinBlock({ code }: { code: string }) {
  return (
    <div data-fit="join" className="flex shrink-0 items-center gap-6 short:gap-5">
      <div className="shrink-0 rounded-tile bg-white p-1.5 short:[&_svg]:size-28 [&_svg]:size-38">
        <Qr value={joinUrl(code)} size={152} />
      </div>
      <div className="grid gap-1 whitespace-nowrap">
        <p className="text-tv-tab font-semibold text-paper short:text-tv-floor">Scan to join</p>
        <p className="text-tv-floor text-paper-2 short:hidden">or enter the code</p>
        <p className="font-mono text-tv-score font-extrabold tracking-[0.04em] text-paper short:text-tv-name">{code}</p>
        <p className="text-tv-floor text-paper-2">at {window.location.host}</p>
      </div>
    </div>
  )
}
