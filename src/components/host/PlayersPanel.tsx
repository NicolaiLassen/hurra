import {
  ArrowsLeftRightIcon,
  DotsThreeIcon,
  HandCoinsIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  UserMinusIcon,
} from '@phosphor-icons/react'
import { useState } from 'react'
import { Link } from 'react-router'
import Avatar from '@/components/Avatar'
import Confirm from '@/components/Confirm'
import { useHostCall } from '@/components/host/hostCalls'
import MovePlayerDialog, { type MovingPlayer } from '@/components/host/MovePlayerDialog'
import RenameDialog from '@/components/host/RenameDialog'
import { useDialogTarget } from '@/components/host/useDialogTarget'
import ProfileBadges from '@/components/ProfileBadges'
import RankBadge from '@/components/RankBadge'
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
import { foldName, withRanks } from '@/lib/format'
import { removePlayer, renamePlayer } from '@/lib/queries'
import type { ScoreRow, Snapshot } from '@/lib/types'
import { useLive } from '@/lib/useLive'
import { cn } from '@/lib/utils'

/** From this many guests on, the list gets a search field. */
const SEARCH_FROM = 9

/**
 * The guests by the day's points (docs/engine-v2.md, 7.3): rank, avatar, name,
 * badges and points. The name opens the award page; the row's menu renames,
 * moves the player to a new phone, or removes them.
 */
export default function PlayersPanel({ snapshot, className }: { snapshot: Snapshot; className?: string }) {
  const session = snapshot.session!
  const { refresh } = useLive()
  const call = useHostCall()
  const [search, setSearch] = useState('')
  const moving = useDialogTarget<MovingPlayer>()
  const renaming = useDialogTarget<ScoreRow>()
  const removing = useDialogTarget<ScoreRow>()

  const rows = withRanks(snapshot.standings)
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
              <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find a guest"
                aria-label="Find a guest"
                className="pl-9"
              />
            </div>
          )}
          {shown.length === 0 && <p className="py-2 text-sm text-muted-foreground">Nobody called “{search.trim()}”.</p>}
          <ul className="divide-y">
            {shown.map((row) => (
              <li key={row.player_id} className="flex items-center gap-2.5 py-1">
                <RankBadge rank={row.rank} className="mx-0.5" />
                <Avatar name={row.name} className="size-8 text-xs" />
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                  {/* Padded to a 32px tap target without making the row taller. */}
                  <Link to={`/p/${row.code}`} className="truncate py-1.5 font-medium hover:text-primary">
                    {row.name}
                  </Link>
                  <ProfileBadges profile={row.profile} />
                </span>
                <span className={cn('font-bold tabular-nums', row.points !== 0 ? 'text-primary' : 'text-muted-foreground')}>{row.points}</span>
                {/* Not modal, so the dialogs it opens don't fight it for focus. */}
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="text-muted-foreground" aria-label={`More actions for ${row.name}`}>
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
