import { ImageBrokenIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import Avatar from '@/components/Avatar'
import Confirm from '@/components/Confirm'
import { useHostCall } from '@/components/host/hostCalls'
import { useDialogTarget } from '@/components/host/useDialogTarget'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { removeGuestPhoto } from '@/lib/queries'
import type { ScoreRow, Snapshot } from '@/lib/types'

/**
 * The player menu's Remove photo… and its confirm, for the players panel
 * (docs/guest-photos.md, 6.4). `item(row)` is null for a guest without a
 * photo; `dialog` goes once at the end of the panel.
 */
export function useRemovePhoto(snapshot: Snapshot): { item: (row: ScoreRow) => ReactNode; dialog: ReactNode } {
  const call = useHostCall()
  const removing = useDialogTarget<ScoreRow>()
  const withPhoto = new Set(snapshot.players.filter((player) => player.photo).map((player) => player.id))
  const target = removing.target

  const item = (row: ScoreRow) =>
    withPhoto.has(row.player_id) ? (
      <DropdownMenuItem onSelect={() => removing.show(row)}>
        <ImageBrokenIcon />
        Remove photo…
      </DropdownMenuItem>
    ) : null

  const dialog = (
    <Confirm
      open={removing.open}
      onOpenChange={removing.onOpenChange}
      title={`Remove the photo of ${target?.name ?? 'this guest'}?`}
      description={
        <>
          {/* Big enough to judge, so the host sees what they remove. */}
          {target && (
            <span className="mb-3 flex justify-center">
              <Avatar name={target.name} playerId={target.player_id} className="size-24" />
            </span>
          )}
          It disappears from the TV and every phone now. They can add a new one from their phone.
        </>
      }
      confirmLabel="Remove photo"
      onConfirm={() => {
        if (target) void call(() => removeGuestPhoto(target.player_id), `Removed the photo of ${target.name}`)
      }}
    />
  )

  return { item, dialog }
}
