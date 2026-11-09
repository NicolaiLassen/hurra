import { ArchiveIcon, ArrowCounterClockwiseIcon, DotsThreeIcon, PencilSimpleIcon, TrashIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import ConfirmByTyping from '@/components/ConfirmByTyping'
import { errorMessage } from '@/components/host/hostCalls'
import RenameDialog from '@/components/host/RenameDialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { archiveSession, deleteSession, renameSession, setJoining } from '@/lib/queries'
import { toast } from '@/lib/toast'

/** What the menu needs of a party: the live snapshot's session or a row of the host's list. */
export type MenuSession = { id: string; name: string; status: 'open' | 'closed'; archived_at: number | string | null }

/** A change the menu made, so a list can show it before its next read. */
export type SessionChange = { name?: string; status?: 'open' | 'closed'; archived?: boolean; deleted?: true }

/** Rename, archive, unarchive or delete a whole session (party). */
export default function SessionMenu({
  session,
  size = 'icon',
  variant = 'ghost',
  onChanged,
}: {
  session: MenuSession
  size?: 'icon' | 'icon-lg'
  /** 'secondary' when it sits next to other filled buttons. */
  variant?: 'ghost' | 'secondary'
  onChanged?: (change: SessionChange) => void
}) {
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const archived = session.archived_at !== null

  async function archive() {
    const reopen = session.status === 'open'
    try {
      // The party is over: archiving also closes joining.
      await archiveSession(session.id, true)
    } catch (error) {
      return toast.error(errorMessage(error))
    }
    onChanged?.({ archived: true, status: 'closed' })
    toast(`Archived ${session.name}`, {
      description: 'Joining is closed and everything is kept.',
      action: { label: 'Undo', onClick: () => void unarchive(reopen) },
    })
  }

  async function unarchive(reopen = false) {
    try {
      await archiveSession(session.id, false)
      if (reopen) await setJoining(session.id, true)
    } catch (error) {
      return toast.error(errorMessage(error))
    }
    onChanged?.({ archived: false, ...(reopen ? { status: 'open' as const } : {}) })
    toast(`${session.name} is back in your sessions`)
  }

  async function remove() {
    try {
      await deleteSession(session.id)
    } catch (error) {
      return toast.error(errorMessage(error))
    }
    toast(`Deleted ${session.name}`)
    onChanged?.({ deleted: true })
  }

  return (
    <>
      {/* Not modal, so the dialogs it opens don't fight it for focus. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant={variant} size={size} aria-label={`More actions for ${session.name}`}>
            <DotsThreeIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
            <PencilSimpleIcon />
            Rename…
          </DropdownMenuItem>
          {archived ? (
            <DropdownMenuItem onSelect={() => void unarchive()}>
              <ArrowCounterClockwiseIcon />
              Unarchive
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => void archive()}>
              <ArchiveIcon />
              Archive
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
            <TrashIcon />
            Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="Rename the session"
        description="Every phone and the TV show the new name."
        initial={session.name}
        maxLength={80}
        onSave={async (name) => {
          await renameSession(session.id, name)
          onChanged?.({ name })
        }}
      />

      <ConfirmByTyping
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${session.name}?`}
        confirmText={session.name}
        actionLabel="Delete this session"
        onConfirm={() => void remove()}
      >
        <p>
          This permanently deletes the session with all its players, games, points, announcements and the story of the
          night. Guests' phones won't find it anymore.
        </p>
        <p>To put it away and keep everything, archive it instead.</p>
      </ConfirmByTyping>
    </>
  )
}
