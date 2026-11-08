import { ScanIcon } from '@phosphor-icons/react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import type { InPersonGame } from '@/games/in-person/logic'
import type { HostViewProps } from '@/games/types'

export default function HostView({ game }: HostViewProps<InPersonGame>) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-muted-foreground">Scan players' QR codes to give points for {game.title}.</p>
      <Button asChild>
        <Link to="/host/scan">
          <ScanIcon />
          Scan a player
        </Link>
      </Button>
    </div>
  )
}
