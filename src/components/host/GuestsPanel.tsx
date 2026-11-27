import {
  ArrowsLeftRightIcon,
  ArrowUUpLeftIcon,
  CheckIcon,
  CircleDashedIcon,
  DotsThreeIcon,
  HandCoinsIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  UserMinusIcon,
  UserPlusIcon,
  UsersFourIcon,
  UsersThreeIcon,
} from '@phosphor-icons/react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import Avatar from '@/components/Avatar'
import Confirm from '@/components/Confirm'
import AddGuestsDialog from '@/components/host/AddGuestsDialog'
import FreeNameConfirm, { type FreeingPlayer } from '@/components/host/FreeNameConfirm'
import { guestListLine, presenceLine, removePlayerDescription } from '@/components/host/guestListWords'
import { useHostCall } from '@/components/host/hostCalls'
import MovePlayerDialog, { type MovingPlayer } from '@/components/host/MovePlayerDialog'
import MoveToTeamDialog, { type TeamMover } from '@/components/host/MoveToTeamDialog'
import RenameDialog from '@/components/host/RenameDialog'
import TeamsCard from '@/components/host/TeamsCard'
import { useDialogTarget } from '@/components/host/useDialogTarget'
import { useRemovePhoto } from '@/components/photos/RemovePhoto'
import ProfileBadges from '@/components/ProfileBadges'
import { TeamSwatch } from '@/components/TeamChip'
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
import { knockedOutIds, profileBadgesOf } from '@/games/registry'
import { listCounts, matchNames, presenceRows, wasListed, type PresenceRow } from '@/lib/guestList'
import { removeExpectedGuests, removeGuest, removePlayer, renamePlayer } from '@/lib/queries'
import { teamOf, teamsOf } from '@/lib/teams'
import type { ListedGuest, ScoreRow, Snapshot, Team } from '@/lib/types'
import { toast } from '@/lib/toast'
import { useLive } from '@/lib/useLive'
import { cn } from '@/lib/utils'

/** From this many names on, the list gets a search field. */
const SEARCH_FROM = 9

/**
 * Everyone at the party in one list (docs/guest-list.md, 7.1): every name on
 * the guest list and anyone who joined without being on it, each marked Here
 * or Not yet, with "14 of 22 here" on top. Not yet comes first, then Here,
 * each by name (presenceRows). It follows the party's snapshot, so a guest
 * who joins moves to Here as they tap their name.
 *
 * A guest who is here: their token (with the hunt's stripe when a live game
 * knocked them out, and the word Out), their name to the award page, their
 * badges and points, and a menu: Give points, Rename, Move to team (once the
 * party has teams), Move to a new phone, Free the name (back on the list as
 * not yet), Remove photo and Remove. A guest not here yet: Rename and Remove
 * from the list. Add guests and Remove everyone not here yet are the list's
 * own. A guest in a team has its colour beside their name; the party's teams
 * are a card of their own right under the list (TeamsCard).
 */
export default function GuestsPanel({ snapshot, className }: { snapshot: Snapshot; className?: string }) {
  const session = snapshot.session!
  const { refresh } = useLive()
  const call = useHostCall()
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [clearing, setClearing] = useState(false)
  const moving = useDialogTarget<MovingPlayer>()
  const renaming = useDialogTarget<{ id: string; name: string; here: boolean }>()
  const removing = useDialogTarget<ScoreRow>()
  const unlisting = useDialogTarget<ListedGuest>()
  const freeing = useDialogTarget<FreeingPlayer>()
  const teaming = useDialogTarget<TeamMover>()
  const removingPhoto = useRemovePhoto(snapshot)
  // Only a database that keeps a guest list can free a name or add guests (the host's snapshot has guests).
  const hasList = Array.isArray(snapshot.guests)
  const over = session.archived_at !== null
  const hasTeams = teamsOf(snapshot).length > 0

  // Remove takes a guest off the guest list too; one who took a listed name is offered Free the name instead.
  const removedRow = removing.target ? snapshot.guests?.find((g) => g.id === removing.target!.player_id) : undefined
  const removedWasListed = removedRow !== undefined && wasListed(removedRow)

  const { notYet, here } = useMemo(() => presenceRows(snapshot), [snapshot])
  const counts = listCounts(snapshot)
  const out = useMemo(() => knockedOutIds(snapshot.games), [snapshot.games])
  const total = notYet.length + here.length
  // Folded like fusion's search: "soren" finds Søren, and plain letters find a full-width name.
  const shownNotYet = matchNames(notYet, search)
  const shownHere = matchNames(here, search)
  const invite = hasList ? guestListLine(counts) : null

  return (
    <>
      <Card className={className}>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Guests</CardTitle>
            {hasList && !over && (
              <Button variant="secondary" onClick={() => setAdding(true)}>
                <UserPlusIcon />
                Add guests
              </Button>
            )}
          </div>
          {/* The count the host looks for first: a number that changes in place, in tv-num (docs/identity.md). */}
          <p className="tv-num text-2xl leading-tight text-paper" aria-live="polite">
            {presenceLine(counts)}
          </p>
          {invite && <CardDescription>{invite}</CardDescription>}
        </CardHeader>
        {total > 0 && (
          <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-2">
            {total >= SEARCH_FROM && (
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
            {shownNotYet.length + shownHere.length === 0 && <p className="py-2 text-sm text-paper-2">Nobody called “{search.trim()}”.</p>}
            {shownNotYet.length > 0 && (
              <Group title={`Not yet (${notYet.length})`}>
                {shownNotYet.map((row) => (
                  <GuestRow key={row.id} row={row}>
                    <DropdownMenuItem onSelect={() => renaming.show({ id: row.id, name: row.name, here: false })}>
                      <PencilSimpleIcon />
                      Rename…
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => {
                        if (!row.here) unlisting.show(row.guest)
                      }}
                    >
                      <UserMinusIcon />
                      Remove from the list…
                    </DropdownMenuItem>
                  </GuestRow>
                ))}
              </Group>
            )}
            {shownHere.length > 0 && (
              <Group title={`Here (${here.length})`}>
                {shownHere.map((row) =>
                  row.here ? (
                    <GuestRow key={row.id} row={row} out={out.has(row.id)} team={teamOf(snapshot, row.id)}>
                      <DropdownMenuItem asChild>
                        <Link to={`/p/${row.score.code}`}>
                          <HandCoinsIcon />
                          Give points
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => renaming.show({ id: row.id, name: row.name, here: true })}>
                        <PencilSimpleIcon />
                        Rename…
                      </DropdownMenuItem>
                      {hasTeams && !over && (
                        <DropdownMenuItem onSelect={() => teaming.show({ id: row.id, name: row.name })}>
                          <UsersFourIcon />
                          Move to team…
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onSelect={() => moving.show({ id: row.id, name: row.name })}>
                        <ArrowsLeftRightIcon />
                        Move to a new phone…
                      </DropdownMenuItem>
                      {hasList && (
                        <DropdownMenuItem onSelect={() => freeing.show({ id: row.id, name: row.name, points: row.score.points })}>
                          <ArrowUUpLeftIcon />
                          Free the name…
                        </DropdownMenuItem>
                      )}
                      {removingPhoto.item(row.score)}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => removing.show(row.score)}>
                        <UserMinusIcon />
                        Remove…
                      </DropdownMenuItem>
                    </GuestRow>
                  ) : null,
                )}
              </Group>
            )}
            {hasList && !over && notYet.length > 1 && (
              <Button variant="ghost" className="justify-self-start text-paper-2" onClick={() => setClearing(true)}>
                <UsersThreeIcon />
                Remove everyone not here yet…
              </Button>
            )}
          </CardContent>
        )}

        {hasList && <AddGuestsDialog sessionId={session.id} listed={snapshot.guests!.map((g) => g.name)} open={adding} onOpenChange={setAdding} />}

        <MovePlayerDialog player={moving.target} open={moving.open} onOpenChange={moving.onOpenChange} joinCode={session.join_code} />

        <MoveToTeamDialog snapshot={snapshot} player={teaming.target} open={teaming.open} onOpenChange={teaming.onOpenChange} />

        {removingPhoto.dialog}

        <RenameDialog
          open={renaming.open}
          onOpenChange={renaming.onOpenChange}
          title={`Rename ${renaming.target?.name ?? 'the guest'}`}
          description={
            renaming.target?.here === false
              ? 'The name they tap when they join, and the one games suggest in their settings.'
              : 'Their phone, the TV and every game show the new name.'
          }
          initial={renaming.target?.name ?? ''}
          maxLength={40}
          onSave={async (name) => {
            if (!renaming.target) return
            await renamePlayer(renaming.target.id, name)
            refresh()
          }}
        />

        <FreeNameConfirm snapshot={snapshot} player={freeing.target} open={freeing.open} onOpenChange={freeing.onOpenChange} />

        <Confirm
          open={removing.open}
          onOpenChange={removing.onOpenChange}
          title={`Remove ${removing.target?.name ?? 'this guest'}?`}
          description={removePlayerDescription({
            name: removing.target?.name ?? 'They',
            listed: removedWasListed,
            canFree: hasList,
          })}
          confirmLabel="Remove"
          onConfirm={() => {
            const row = removing.target
            if (row) void call(() => removePlayer(session.id, row.player_id), `Removed ${row.name}`)
          }}
          // Someone took a name on the list by mistake: Free the name keeps the name on the list.
          secondary={
            hasList && removedWasListed && removing.target
              ? {
                  label: 'Free the name instead',
                  onConfirm: () => {
                    const row = removing.target!
                    freeing.show({ id: row.player_id, name: row.name, points: row.points })
                  },
                }
              : undefined
          }
        />

        <Confirm
          open={unlisting.open}
          onOpenChange={unlisting.onOpenChange}
          title={`Remove ${unlisting.target?.name ?? 'this guest'} from the guest list?`}
          description={`${unlisting.target?.name ?? 'They'} can still join by typing a name. Names typed in a game's settings stay as they are.`}
          confirmLabel="Remove"
          onConfirm={() => {
            const guest = unlisting.target
            if (guest) void call(() => removeGuest(guest.id), `Removed ${guest.name} from the list`)
          }}
        />

        <Confirm
          open={clearing}
          onOpenChange={setClearing}
          title="Remove everyone not here yet?"
          description={
            `The ${notYet.length} names nobody has taken yet leave the guest list. Guests who are here stay, and names ` +
            "typed in a game's settings stay as they are."
          }
          confirmLabel={`Remove ${notYet.length} names`}
          onConfirm={() =>
            void call(async () => {
              const removed = await removeExpectedGuests(session.id)
              toast.success(`Removed ${removed} ${removed === 1 ? 'name' : 'names'} from the list`)
            })
          }
        />
      </Card>
      <TeamsCard snapshot={snapshot} />
    </>
  )
}

/** One of the list's two groups, under its name and count. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-0.5 pt-1">
      <h3 className="text-sm font-bold text-paper-2">{title}</h3>
      <ul className="divide-y divide-rule">{children}</ul>
    </section>
  )
}

/**
 * A guest's row: their token, their name (to the award page once here), what
 * they hold, the mark, their points and the menu (`children`). The mark is a
 * word with a glyph, never a colour (docs/identity.md): Here a quiet check in
 * paper-2, Not yet a dashed circle in the dimmer paper-3, its name dimmer too.
 */
function GuestRow({ row, out = false, team = null, children }: { row: PresenceRow; out?: boolean; team?: Team | null; children: ReactNode }) {
  const below = row.here && (row.typed || profileBadgesOf(row.score.profile).length > 0)
  return (
    // A grid, so the badges take a line of their own under the name and the mark, and never push the row past the card.
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-center gap-x-2.5 py-1">
      <span className={cn('self-center', below && 'row-span-2')}>
        {row.here ? (
          <Avatar name={row.name} playerId={row.id} out={out} className="size-7" />
        ) : (
          // No photo and no player yet: the token from the name alone.
          <Avatar name={row.name} src={null} className="size-7" />
        )}
      </span>
      <span className="flex min-w-0 items-center gap-2">
        {row.here ? (
          // Padded to a 32px tap target without making the row taller.
          <Link to={`/p/${row.score.code}`} className="truncate py-1.5 font-bold hover:underline hover:decoration-paper-3 hover:underline-offset-4">
            {row.name}
          </Link>
        ) : (
          <span className="truncate py-1.5 font-bold text-paper-2">{row.name}</span>
        )}
        {/* The guest's team, quietly: its colour, with the name for a screen reader and on hover. The Teams card says it in words. */}
        {team && (
          <span className="inline-flex shrink-0" title={team.name}>
            <TeamSwatch team={team} />
            <span className="sr-only">{team.name}</span>
          </span>
        )}
        {out && (
          <Badge variant="hunt" className="px-0">
            Out
          </Badge>
        )}
      </span>
      <PresenceMark here={row.here} />
      {/* Points, once here: tv-num, so the column holds still as they change. */}
      <span className={cn('tv-num w-7 shrink-0 text-right text-lg', row.here && row.score.points !== 0 ? 'text-paper' : 'text-paper-3')}>
        {row.here ? row.score.points : ''}
      </span>
      {/* Not modal, so the dialogs it opens don't fight it for focus. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="text-paper-2" aria-label={`More actions for ${row.name}`}>
            <DotsThreeIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-52">
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
      {row.here && below && (
        <span className="col-span-3 col-start-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pb-1">
          <ProfileBadges profile={row.score.profile} />
          {/* Joined by typing a name that isn't on the list: often another spelling of a name that is. */}
          {row.typed && <span className="text-xs text-paper-3">Typed their name</span>}
        </span>
      )}
    </li>
  )
}

/** Here or Not yet, as a word with a glyph in a column of its own, so the marks line up down the list. */
export function PresenceMark({ here }: { here: boolean }) {
  return here ? (
    <span className="inline-flex w-15 shrink-0 items-center gap-1 text-xs font-bold text-paper-2">
      <CheckIcon weight="bold" aria-hidden className="size-3.5" />
      Here
    </span>
  ) : (
    <span className="inline-flex w-15 shrink-0 items-center gap-1 text-xs text-paper-3">
      <CircleDashedIcon aria-hidden className="size-3.5" />
      Not yet
    </span>
  )
}
