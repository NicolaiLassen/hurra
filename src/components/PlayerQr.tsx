import { QRCodeSVG } from 'qrcode.react'
import type { Player } from '@/lib/types'
import { playerUrl } from '@/lib/urls'

/** A player's QR code on a white card, big enough to scan from another phone. */
export default function PlayerQr({ player }: { player: Player }) {
  return (
    <div className="mx-auto grid w-full max-w-sm justify-items-center gap-4 rounded-3xl bg-white p-6 text-black">
      <QRCodeSVG value={playerUrl(player.code)} size={320} level="M" className="h-auto w-full" />
      <div className="text-center">
        <p className="text-2xl font-bold">{player.name}</p>
        <p className="font-mono text-lg tracking-widest">{player.code}</p>
      </div>
    </div>
  )
}
