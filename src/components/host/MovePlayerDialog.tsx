import { useCallback } from 'react'
import IssuedCodeView from '@/components/host/IssuedCodeView'
import { useIssuedCode } from '@/components/host/useIssuedCode'
import Qr from '@/components/Qr'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { issuePlayerTransfer, revokePlayerTransfer } from '@/lib/queries'
import { joinUrl } from '@/lib/urls'

export type MovingPlayer = { id: string; name: string }

/**
 * Move a player to a new phone (gap G4, docs/engine-v2.md 7.3): a one-time code
 * the guest types on the new phone's join page, under "Got a code from the
 * host?". Their points and badges come along; the old phone says the player
 * moved. Opening the dialog issues the code, and closing it cancels the code,
 * so nobody who read it over the host's shoulder can use it later.
 */
export default function MovePlayerDialog({
  player,
  open,
  onOpenChange,
  joinCode,
}: {
  /** The player to move: kept while the dialog fades out. */
  player: MovingPlayer | null
  open: boolean
  onOpenChange: (open: boolean) => void
  joinCode: string
}) {
  return (
    <Dialog open={open && player !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Mounted only while open, so each opening issues a fresh code. */}
        {player && <MovePlayer key={player.id} player={player} joinCode={joinCode} />}
      </DialogContent>
    </Dialog>
  )
}

function MovePlayer({ player, joinCode }: { player: MovingPlayer; joinCode: string }) {
  const issue = useCallback(() => issuePlayerTransfer(player.id), [player.id])
  const code = useIssuedCode(issue, revokePlayerTransfer)

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-lg font-semibold">Move {player.name} to a new phone</DialogTitle>
        <DialogDescription>
          On the new phone, open the join link, tap <span className="font-semibold text-foreground">Got a code from the host</span>,
          and type this code. Their points and badges come along. Closing this cancels the code, so keep it open until their
          phone says Welcome back.
        </DialogDescription>
      </DialogHeader>
      <IssuedCodeView code={code} className="py-1" />
      <div className="grid gap-2">
        <div className="flex items-center gap-4 rounded-lg bg-overlay p-3">
          <Qr value={joinUrl(joinCode)} size={88} />
          <p className="min-w-0 text-sm text-muted-foreground">The new phone can scan this to open the join link.</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Or open <span className="font-mono break-all text-foreground">{joinUrl(joinCode).replace(/^https?:\/\//, '')}</span>
        </p>
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button size="lg">Done</Button>
        </DialogClose>
      </DialogFooter>
    </>
  )
}
