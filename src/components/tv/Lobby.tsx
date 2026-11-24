import Qr from '@/components/Qr'
import { joinUrl } from '@/lib/urls'

/**
 * The stage before anyone has joined: the night's first programme is one big
 * QR code on its white quiet zone, with the code and the address it opens
 * (this page's own, never a written one). With joining closed, or the party
 * over, it says so instead.
 */
export default function Lobby({ joinCode, open, over }: { joinCode: string; open: boolean; over: boolean }) {
  if (over || !open) {
    return <p className="m-auto wide text-tv-answer text-paper-2 short:text-tv-score">{over ? 'This party is over.' : 'Joining is closed.'}</p>
  }
  return (
    <div data-fit="lobby" className="m-auto flex items-center gap-20 short:gap-14">
      <div className="shrink-0 rounded-tile bg-white p-3 short:[&_svg]:size-64 [&_svg]:size-88">
        <Qr value={joinUrl(joinCode)} size={352} />
      </div>
      <div className="grid gap-4 short:gap-3">
        <p className="wide text-tv-question text-paper short:text-tv-answer">Scan to join</p>
        <p className="text-tv-body text-paper-2 short:text-tv-tab">or enter the code</p>
        <p className="font-mono text-tv-code font-extrabold tracking-[0.04em] text-paper short:text-tv-question">{joinCode}</p>
        <p className="text-tv-body text-paper-2 short:text-tv-tab">at {window.location.host}</p>
      </div>
    </div>
  )
}
