import { QrCodeIcon } from '@phosphor-icons/react'
import type { InPersonGame } from '@/games/in-person/logic'
import type { PlayerViewProps } from '@/games/types'

/**
 * The round on a phone. The phone draws the card and its header (the title,
 * "Now playing" or "On the TV"), so this is only what to do. The code is here
 * too, for a host who types it instead of scanning.
 */
export default function PlayerView({ player }: PlayerViewProps<InPersonGame>) {
  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid gap-1">
        <p className="text-lg font-semibold">Played in person</p>
        <p className="text-muted-foreground">When you score, show your code to the host.</p>
      </div>
      <p className="flex items-center gap-3 rounded-xl bg-secondary/60 px-4 py-3">
        <QrCodeIcon weight="duotone" className="size-5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 text-sm text-muted-foreground">Your code</span>
        <span className="font-mono text-lg font-bold tracking-widest">{player.code}</span>
      </p>
    </div>
  )
}
