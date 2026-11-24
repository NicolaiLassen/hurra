import { CopyIcon } from '@phosphor-icons/react'
import Qr from '@/components/Qr'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/lib/toast'
import type { Session } from '@/lib/types'
import { joinUrl } from '@/lib/urls'
import { cn } from '@/lib/utils'

async function copyJoinLink(joinCode: string) {
  try {
    await navigator.clipboard.writeText(joinUrl(joinCode))
    toast.success('Join link copied')
  } catch {
    // Clipboard access can be refused; show the link so it can be copied by hand.
    toast(joinUrl(joinCode))
  }
}

/** The party's QR code and join code, faded while joining is closed. */
export default function JoinCard({ session, className }: { session: Pick<Session, 'join_code' | 'status' | 'archived_at'>; className?: string }) {
  const open = session.status === 'open' && session.archived_at === null
  return (
    <Card className={cn('text-center', className)}>
      <CardHeader>
        <CardTitle>{session.archived_at !== null ? 'The party is over' : open ? 'Scan to join' : 'Joining is closed'}</CardTitle>
      </CardHeader>
      <CardContent className="grid justify-items-center gap-3">
        <div className={open ? '' : 'opacity-30'}>
          <Qr value={joinUrl(session.join_code)} size={200} />
        </div>
        <div>
          <p className="text-sm font-bold text-paper-2">Join code</p>
          {/* The code face (Archivo at 87.5 percent, so 0 and O differ), in paper: gold is the room's next step. */}
          <p className="font-mono text-4xl leading-tight font-extrabold tracking-[0.04em] text-paper">{session.join_code}</p>
        </div>
        <Button variant="secondary" size="lg" className="w-full" onClick={() => void copyJoinLink(session.join_code)}>
          <CopyIcon />
          Copy join link
        </Button>
      </CardContent>
    </Card>
  )
}
