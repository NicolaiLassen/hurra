import { ArrowClockwiseIcon } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import type { DealMeIn } from '@/games/elimination/dealMeIn'
import { watchLine } from '@/games/elimination/hunt'
import type { EliminationPublicState } from '@/games/elimination/logic'

/** A guest with no task this round: what happens next, and Try again when their phone's ask to be dealt in failed. */
export default function WatchLine({
  publicState,
  serverNow,
  dealing,
}: {
  publicState: EliminationPublicState | null
  serverNow: () => number
  dealing: DealMeIn
}) {
  return (
    <div className="grid justify-items-start gap-3">
      <p className="text-paper-2">{watchLine(publicState, serverNow(), dealing.failed)}</p>
      {dealing.failed && (
        <Button variant="secondary" size="lg" onClick={dealing.retry}>
          <ArrowClockwiseIcon />
          Try again
        </Button>
      )}
    </div>
  )
}
