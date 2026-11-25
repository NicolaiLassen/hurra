import { DotsThreeIcon, MagnifyingGlassIcon, PencilSimpleIcon, UserMinusIcon, UserPlusIcon, UsersThreeIcon } from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import Avatar from '@/components/Avatar'
import Confirm from '@/components/Confirm'
import AddGuestsDialog from '@/components/host/AddGuestsDialog'
import { guestListLine } from '@/components/host/guestListWords'
import { useHostCall } from '@/components/host/hostCalls'
import RenameDialog from '@/components/host/RenameDialog'
import { useDialogTarget } from '@/components/host/useDialogTarget'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { listCounts, matchNames, sortNames } from '@/lib/guestList'
import { removeExpectedGuests, removeGuest, renamePlayer } from '@/lib/queries'
import type { ListedGuest, Snapshot } from '@/lib/types'
import { toast } from '@/lib/toast'
import { useLive } from '@/lib/useLive'

/** From this many expected guests on, the list gets a search field. */
const SEARCH_FROM = 9

/**
 * The guest list (docs/guest-list.md, 7.1): the names the host added before
 * the party, how many have joined, and the guests still expected, each with
 * Rename and Remove from the list, and Remove everyone still expected under
 * the list (a paste that went wrong, undone in one step). Joined guests are
 * not repeated here: they are in Players. Shown only where the database keeps
 * a guest list (the host's snapshot has `guests`).
 */
export default function GuestListPanel({ snapshot, className }: { snapshot: Snapshot; className?: string }) {
  const session = snapshot.session!
  const { refresh } = useLive()
  const call = useHostCall()
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState('')
  const renaming = useDialogTarget<ListedGuest>()
  const removing = useDialogTarget<ListedGuest>()
  const [clearing, setClearing] = useState(false)

  const expected = useMemo(() => sortNames((snapshot.guests ?? []).filter((g) => g.joined_at === null)), [snapshot.guests])
  if (!snapshot.guests) return null
  const over = session.archived_at !== null
  const shown = matchNames(expected, search)

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Guest list</CardTitle>
          {!over && (
            <Button variant="secondary" onClick={() => setAdding(true)}>
              <UserPlusIcon />
              Add guests
            </Button>
          )}
        </div>
        <CardDescription>{guestListLine(listCounts(snapshot))}</CardDescription>
      </CardHeader>
      {expected.length > 0 && (
        <CardContent className="grid gap-2">
          {expected.length >= SEARCH_FROM && (
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-paper-2" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find a name on the list"
                aria-label="Find a name on the list"
                className="pl-9"
              />
            </div>
          )}
          <h3 className="pt-1 text-sm font-bold text-paper-2">Still expected ({expected.length})</h3>
          {shown.length === 0 && <p className="py-2 text-sm text-paper-2">Nobody called “{search.trim()}” on the list.</p>}
          <ul className="divide-y divide-rule">
            {shown.map((guest) => (
              <li key={guest.id} className="flex items-center gap-2.5 py-1">
                {/* No photo and no player yet: the token from the name alone. */}
                <Avatar name={guest.name} src={null} className="size-7" />
                <span className="min-w-0 flex-1 truncate py-1.5 font-bold">{guest.name}</span>
                {/* Not modal, so the dialogs it opens don't fight it for focus. */}
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="text-paper-2" aria-label={`More actions for ${guest.name}`}>
                      <DotsThreeIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-auto min-w-52">
                    <DropdownMenuItem onSelect={() => renaming.show(guest)}>
                      <PencilSimpleIcon />
                      Rename…
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => removing.show(guest)}>
                      <UserMinusIcon />
                      Remove from the list…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
          {!over && expected.length > 1 && (
            <Button variant="ghost" className="justify-self-start text-paper-2" onClick={() => setClearing(true)}>
              <UsersThreeIcon />
              Remove everyone still expected…
            </Button>
          )}
        </CardContent>
      )}

      <AddGuestsDialog sessionId={session.id} listed={snapshot.guests.map((g) => g.name)} open={adding} onOpenChange={setAdding} />

      <RenameDialog
        open={renaming.open}
        onOpenChange={renaming.onOpenChange}
        title={`Rename ${renaming.target?.name ?? 'the guest'}`}
        description="The name they tap when they join, and the name in the games' settings."
        initial={renaming.target?.name ?? ''}
        maxLength={40}
        onSave={async (name) => {
          if (!renaming.target) return
          await renamePlayer(renaming.target.id, name)
          refresh()
        }}
      />

      <Confirm
        open={clearing}
        onOpenChange={setClearing}
        title="Remove everyone still expected?"
        description={
          `The ${expected.length} names nobody has taken yet leave the guest list, and game settings that name them ` +
          'lose those picks. Guests who joined stay.'
        }
        confirmLabel={`Remove ${expected.length} names`}
        onConfirm={() =>
          void call(async () => {
            const removed = await removeExpectedGuests(session.id)
            toast.success(`Removed ${removed} ${removed === 1 ? 'name' : 'names'} from the list`)
          })
        }
      />

      <Confirm
        open={removing.open}
        onOpenChange={removing.onOpenChange}
        title={`Remove ${removing.target?.name ?? 'this guest'} from the guest list?`}
        description={`${removing.target?.name ?? 'They'} can still join by typing a name. Game settings that name ${removing.target?.name ?? 'them'} lose that pick.`}
        confirmLabel="Remove"
        onConfirm={() => {
          const guest = removing.target
          if (guest) void call(() => removeGuest(guest.id), `Removed ${guest.name} from the list`)
        }}
      />
    </Card>
  )
}
