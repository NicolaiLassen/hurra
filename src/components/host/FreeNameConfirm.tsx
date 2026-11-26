import Confirm from '@/components/Confirm'
import { freeNameDescription } from '@/components/host/guestListWords'
import { useHostCall } from '@/components/host/hostCalls'
import { wasListed } from '@/lib/guestList'
import { freeGuest, removeGuest } from '@/lib/queries'
import type { Snapshot } from '@/lib/types'

/** The guest whose name is freed: their id, name and the day's points. */
export type FreeingPlayer = { id: string; name: string; points: number }

/**
 * Free the name (docs/guest-list.md, 7.5), from a guest's menu in the list and
 * the award page: the name goes back on the guest list as not here yet, and the phone
 * that has it asks Who are you? again. A name the guest typed (never listed)
 * also gets "Free and take off the list", for another spelling of a listed
 * name (Mads H for Mads Holm), so the stray spelling never shows on phones.
 */
export default function FreeNameConfirm({
  snapshot,
  player,
  open,
  onOpenChange,
  onFreed,
}: {
  snapshot: Snapshot
  /** Kept after the dialog closes, so its words don't change while it fades out. */
  player: FreeingPlayer | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** After the name is free (the award page goes back to the room, since the player is gone from it). */
  onFreed?: () => void
}) {
  const session = snapshot.session!
  const call = useHostCall()
  const row = player ? snapshot.guests?.find((g) => g.id === player.id) : undefined
  const typed = row !== undefined && !wasListed(row)

  async function free(takeOff: boolean) {
    if (!player) return
    const freed = await call(
      async () => {
        await freeGuest(session.id, player.id)
        if (takeOff) await removeGuest(player.id)
      },
      takeOff ? `${player.name} is free and off the list` : `${player.name} is free again`,
    )
    if (freed) onFreed?.()
  }

  return (
    <Confirm
      open={open}
      onOpenChange={onOpenChange}
      title={`Free the name ${player?.name ?? ''}?`}
      description={
        player
          ? freeNameDescription({ name: player.name, points: player.points, joiningOpen: session.status === 'open', typed })
          : undefined
      }
      confirmLabel="Free the name"
      // Not destructive: the guest can take the name again. Remove stays the destructive one.
      variant="default"
      onConfirm={() => void free(false)}
      secondary={typed ? { label: 'Free and take off the list', onConfirm: () => void free(true) } : undefined}
    />
  )
}
