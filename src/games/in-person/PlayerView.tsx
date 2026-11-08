import type { InPersonGame } from '@/games/in-person/logic'
import type { PlayerViewProps } from '@/games/types'

export default function PlayerView({ game }: PlayerViewProps<InPersonGame>) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold tracking-widest text-primary uppercase">Now playing</p>
      <p className="text-2xl font-bold">{game.title}</p>
      <p className="text-muted-foreground">
        This round is played in person. When you score, show your QR code to the host.
      </p>
    </div>
  )
}
