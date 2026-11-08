import { ArchiveIcon, ArrowCounterClockwiseIcon, DotsThreeIcon, TrashIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { toast } from '@/lib/toast'
import ConfirmByTyping from '@/components/ConfirmByTyping'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { supabase } from '@/lib/supabase'
import type { Session } from '@/lib/types'

/** Archive, unarchive or delete a whole session (party). */
export default function SessionMenu({
  session,
  size = 'icon',
  variant = 'ghost',
  onDeleted,
}: {
  session: Session
  size?: 'icon' | 'icon-lg'
  /** 'secondary' when it sits next to other filled buttons. */
  variant?: 'ghost' | 'secondary'
  onDeleted?: () => void
}) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const archived = session.archived_at !== null

  async function archive() {
    const previousStatus = session.status
    // The party is over: nobody new should be able to join it.
    const { error } = await supabase
      .from('sessions')
      .update({ archived_at: new Date().toISOString(), status: 'closed' })
      .eq('id', session.id)
    if (error) return toast.error(error.message)
    toast(`Archived ${session.name}`, {
      description: 'Joining is closed and everything is kept.',
      action: { label: 'Undo', onClick: () => void unarchive(previousStatus) },
    })
  }

  async function unarchive(status?: Session['status']) {
    const { error } = await supabase
      .from('sessions')
      .update({ archived_at: null, ...(status ? { status } : {}) })
      .eq('id', session.id)
    if (error) return toast.error(error.message)
    toast(`${session.name} is back in your sessions`)
  }

  async function remove() {
    const { error } = await supabase.from('sessions').delete().eq('id', session.id)
    if (error) return toast.error(error.message)
    toast(`Deleted ${session.name}`)
    onDeleted?.()
  }

  return (
    <>
      {/* Not modal, so the delete dialog it opens doesn't fight it for focus. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant={variant} size={size} aria-label={`More actions for ${session.name}`}>
            <DotsThreeIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
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

      <ConfirmByTyping
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${session.name}?`}
        confirmText={session.name}
        actionLabel="Delete this session"
        onConfirm={() => void remove()}
      >
        <p>
          This permanently deletes the session with all its players, games, points and announcements. Guests' phones
          won't find it anymore.
        </p>
        <p>To put it away and keep everything, archive it instead.</p>
      </ConfirmByTyping>
    </>
  )
}
