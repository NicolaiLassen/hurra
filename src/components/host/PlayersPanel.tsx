import {
  ArrowsLeftRightIcon,
  ArrowUUpLeftIcon,
  DotsThreeIcon,
  HandCoinsIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  UserMinusIcon,
} from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import Avatar from '@/components/Avatar'
import Confirm from '@/components/Confirm'
import { freeNameDescription } from '@/components/host/guestListWords'
import { useHostCall } from '@/components/host/hostCalls'
import MovePlayerDialog, { type MovingPlayer } from '@/components/host/MovePlayerDialog'
import RenameDialog from '@/components/host/RenameDialog'
import { useDialogTarget } from '@/components/host/useDialogTarget'
import { useRemovePhoto } from '@/components/photos/RemovePhoto'
import ProfileBadges from '@/components/ProfileBadges'
import { Badge } from '@/components/ui/badge'
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
import { knockedOutIds } from '@/games/registry'
import { foldName, withRanks } from '@/lib/format'
import { freeGuest, removePlayer, renamePlayer } from '@/lib/queries'
import type { ScoreRow, Snapshot } from '@/lib/types'
import { useLive } from '@/lib/useLive'
import { cn } from '@/lib/utils'

/** From this many guests on, the list gets a search field. */
const SEARCH_FROM = 9

/**
 * The guests by the day's points (docs/engine-v2.md, 7.3): rank, token, name,
 * badges and points. The name opens the award page; the row's menu renames,
 * moves the player to a new phone, frees the name (it goes back on the guest
 * list, docs/guest-list.md 7.5), or removes them. A guest a live game has
 * knocked out (the games' knockedOut hook) gets the pink stripe on their token
 * and the word Out beside the points (docs/identity.md, The player token).
 */
export default function PlayersPanel({ snapshot, className }: { snapshot: Snapshot; className?: string }) {
  const session = snapshot.session!
  const { refresh } = useLive()
  const call = useHostCall()
  const [search, setSearch] = useState('')
  const moving = useDialogTarget<MovingPlayer>()
  const renaming = useDialogTarget<ScoreRow>()
  const removing = useDialogTarget<ScoreRow>()
  const freeing = useDialogTarget<ScoreRow>()
  const removingPhoto = useRemovePhoto(snapshot)
  // Only a database that keeps a guest list can free a name (the host's snapshot has guests).
  const canFree = Array.isArray(snapshot.guests)

  const rows = withRanks(snapshot.standings)
  const out = useMemo(() => knockedOutIds(snapshot.games), [snapshot.games])
  // Folded like fusion's search: "soren" finds Søren, and plain letters find a full-width name.
  const needle = foldName(search)
  const shown = needle ? rows.filter((row) => foldName(row.name).includes(needle)) : rows

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Players ({rows.length})</CardTitle>
        {rows.length === 0 && <CardDescription>Nobody has joined yet.</CardDescription>}
      </CardHeader>
      {rows.length > 0 && (
        <CardContent className="grid gap-2">
          {rows.length >= SEARCH_FROM && (
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-paper-2" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find a guest"
                aria-label="Find a guest"
                className="pl-9"
              />
            </div>
          )}
          {shown.length === 0 && <p className="py-2 text-sm text-paper-2">Nobody called “{search.trim()}”.</p>}
          <ul className="divide-y divide-rule">
            {shown.map((row) => (
              <li key={row.player_id} className="flex items-center gap-2.5 py-1">
                {/* A plain rank in condensed numerals, as on the TV's rows: no medal coins. */}
                <span className="tv-num w-6 shrink-0 text-right text-base text-paper-3">{row.rank}</span>
                <Avatar name={row.name} playerId={row.player_id} out={out.has(row.player_id)} className="size-7" />
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                  {/* Padded to a 32px tap target without making the row taller. */}
                  <Link to={`/p/${row.code}`} className="truncate py-1.5 font-bold hover:underline hover:decoration-paper-3 hover:underline-offset-4">
                    {row.name}
                  </Link>
                  <ProfileBadges profile={row.profile} />
                </span>
                {out.has(row.player_id) && (
                  <Badge variant="hunt" className="px-0">
                    Out
                  </Badge>
                )}
                <span className={cn('tv-num w-8 shrink-0 text-right text-lg', row.points !== 0 ? 'text-paper' : 'text-paper-3')}>{row.points}</span>
                {/* Not modal, so the dialogs it opens don't fight it for focus. */}
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="text-paper-2" aria-label={`More actions for ${row.name}`}>
                      <DotsThreeIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-auto min-w-52">
                    <DropdownMenuItem asChild>
                      <Link to={`/p/${row.code}`}>
                        <HandCoinsIcon />
                        Give points
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => renaming.show(row)}>
                      <PencilSimpleIcon />
                      Rename…
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => moving.show({ id: row.player_id, name: row.name })}>
                      <ArrowsLeftRightIcon />
                      Move to a new phone…
                    </DropdownMenuItem>
                    {canFree && (
                      <DropdownMenuItem onSelect={() => freeing.show(row)}>
                        <ArrowUUpLeftIcon />
                        Free the name…
                      </DropdownMenuItem>
                    )}
                    {removingPhoto.item(row)}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => removing.show(row)}>
                      <UserMinusIcon />
                      Remove…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        </CardContent>
      )}

      <MovePlayerDialog player={moving.target} open={moving.open} onOpenChange={moving.onOpenChange} joinCode={session.join_code} />

      {removingPhoto.dialog}

      <RenameDialog
        open={renaming.open}
        onOpenChange={renaming.onOpenChange}
        title={`Rename ${renaming.target?.name ?? 'the player'}`}
        description="Their phone, the TV and every game show the new name."
        initial={renaming.target?.name ?? ''}
        maxLength={40}
        onSave={async (name) => {
          if (!renaming.target) return
          await renamePlayer(renaming.target.player_id, name)
          refresh()
        }}
      />

      <Confirm
        open={freeing.open}
        onOpenChange={freeing.onOpenChange}
        title={`Free the name ${freeing.target?.name ?? ''}?`}
        description={
          freeing.target
            ? freeNameDescription({ name: freeing.target.name, points: freeing.target.points, joiningOpen: session.status === 'open' })
            : undefined
        }
        confirmLabel="Free the name"
        // Not destructive: the guest can take the name again. Remove stays the destructive one.
        variant="default"
        onConfirm={() => {
          const row = freeing.target
          if (row) void call(() => freeGuest(session.id, row.player_id), `${row.name} is free again`)
        }}
      />

      <Confirm
        open={removing.open}
        onOpenChange={removing.onOpenChange}
        title={`Remove ${removing.target?.name ?? 'this player'}?`}
        description={
          'Their points go with them, and the games running now carry on without them. ' +
          'On a new phone? Move them instead: their points stay.'
        }
        confirmLabel="Remove"
        onConfirm={() => {
          const row = removing.target
          if (row) void call(() => removePlayer(session.id, row.player_id), `Removed ${row.name}`)
        }}
      />
    </Card>
  )
}
