import { PencilSimpleIcon, ShuffleIcon, XCircleIcon } from '@phosphor-icons/react'
import { useId, useMemo, useState } from 'react'
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'
import Avatar from '@/components/Avatar'
import Confirm from '@/components/Confirm'
import { useHostCall } from '@/components/host/hostCalls'
import RenameDialog from '@/components/host/RenameDialog'
import { clearBlock, makeBlock, memberCount, remakeNote, splitLine, TEAM_COUNTS } from '@/components/host/teamWords'
import { useDialogTarget } from '@/components/host/useDialogTarget'
import TeamChip from '@/components/TeamChip'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { clearTeams, makeTeams, renameTeam } from '@/lib/queries'
import { DEFAULT_TEAMS, MAX_TEAMS, MIN_TEAMS, membersOf, teamless, teamsOf } from '@/lib/teams'
import type { Player, Snapshot, Team } from '@/lib/types'
import { useLive } from '@/lib/useLive'
import { cn } from '@/lib/utils'

/**
 * The party's teams in the control room (docs/user-flows.md, "Teams"), right
 * under the guests. Without teams: what they do, how many to make (2 to 6)
 * and what that gives for the guests here now, and Make teams, which splits
 * them at random. With teams: each team's colour, name and members, with
 * Rename; guests here in no team; Make teams again (a reshuffle, behind a
 * confirm with the count again) and Clear teams. Making or clearing them
 * waits while a game played in teams is live. Default names (Team Gold, Team
 * Pink, ...) come from the database.
 */
export default function TeamsCard({ snapshot, className }: { snapshot: Snapshot; className?: string }) {
  const session = snapshot.session!
  const { refresh } = useLive()
  const call = useHostCall()
  const teams = teamsOf(snapshot)
  const over = session.archived_at !== null
  const guestsHere = snapshot.players.length
  const [count, setCount] = useState(() => defaultCount(teams.length))
  const [making, setMaking] = useState(false)
  const [remaking, setRemaking] = useState(false)
  const [clearing, setClearing] = useState(false)
  const renaming = useDialogTarget<Team>()
  const members = useMemo(() => new Map(teams.map((t) => [t.id, membersOf(snapshot, t.id)])), [snapshot, teams])
  const alone = useMemo(() => (teams.length > 0 ? teamless(snapshot) : []), [snapshot, teams.length])
  const blocked = makeBlock(snapshot.games, guestsHere, teams.length > 0)
  const clearBlocked = clearBlock(snapshot.games)
  const labelId = useId()

  // An archived party keeps its teams to look at; one that never had any has nothing to show.
  if (over && teams.length === 0) return null
  // A database from before teams sends no teams at all: nothing to make them with.
  if (!Array.isArray(snapshot.teams)) return null

  async function make() {
    setMaking(true)
    await call(() => makeTeams(session.id, count), `Made ${count} teams`)
    setMaking(false)
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Teams</CardTitle>
        <CardDescription>
          {teams.length === 0
            ? 'Some games can be played in teams: one answer from any member counts for the whole team.'
            : 'In games played in teams, one answer from any member counts for the whole team. Late guests go into the smallest team.'}
        </CardDescription>
      </CardHeader>

      {teams.length === 0 ? (
        <CardContent className="grid gap-3">
          <div className="grid gap-2">
            <p id={labelId} className="text-sm font-bold text-paper-2">
              How many teams
            </p>
            <TeamCountPicker value={count} onChange={setCount} labelledBy={labelId} disabled={blocked !== null} />
          </div>
          {/* What the pick gives, or why it can't be made: a word either way, never only a greyed button. */}
          <p className="text-sm text-paper-2" aria-live="polite">
            {blocked ?? `${splitLine(guestsHere, count)}.`}
          </p>
          <Button variant="secondary" size="lg" className="justify-self-start" disabled={blocked !== null} isPending={making} onClick={() => void make()}>
            <ShuffleIcon />
            Make teams
          </Button>
        </CardContent>
      ) : (
        <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-2">
          <ul className="divide-y divide-rule">
            {teams.map((team) => (
              <TeamRow key={team.id} team={team} members={members.get(team.id) ?? []} onRename={over ? undefined : () => renaming.show(team)} />
            ))}
            {alone.length > 0 && <NoTeamRow players={alone} />}
          </ul>
          {!over && (
            <div className="grid gap-1 pt-1">
              {/* One under the other: side by side they don't fit the guests' narrow column. */}
              <div className="grid justify-items-start">
                <Button
                  variant="ghost"
                  className="-ml-2.5 text-paper-2"
                  disabled={blocked !== null}
                  onClick={() => {
                    setCount(teams.length)
                    setRemaking(true)
                  }}
                >
                  <ShuffleIcon />
                  Make teams again…
                </Button>
                <Button variant="ghost" className="-ml-2.5 text-paper-2" disabled={clearBlocked !== null} onClick={() => setClearing(true)}>
                  <XCircleIcon />
                  Clear teams…
                </Button>
              </div>
              {(blocked ?? clearBlocked) && <p className="text-sm text-paper-2">{blocked ?? clearBlocked}</p>}
            </div>
          )}
        </CardContent>
      )}

      <RemakeDialog
        open={remaking}
        onOpenChange={setRemaking}
        teams={teams}
        guestsHere={guestsHere}
        count={count}
        onCount={setCount}
        onConfirm={() => void call(() => makeTeams(session.id, count), `Made ${count} new teams`)}
      />

      <RenameDialog
        open={renaming.open}
        onOpenChange={renaming.onOpenChange}
        title={`Rename ${renaming.target?.name ?? 'the team'}`}
        description="Phones and the TV show the new name."
        initial={renaming.target?.name ?? ''}
        maxLength={40}
        onSave={async (name) => {
          if (!renaming.target) return
          await renameTeam(renaming.target.id, name)
          refresh()
        }}
      />

      <Confirm
        open={clearing}
        onOpenChange={setClearing}
        title="Clear the teams?"
        description={
          `The ${teams.length} teams and their names go, and everyone here is in no team again. Games set to play in ` +
          'teams play alone until you make teams again.'
        }
        confirmLabel="Clear teams"
        onConfirm={() => void call(() => clearTeams(session.id), 'Cleared the teams')}
      />
    </Card>
  )
}

/** The count to offer: the teams there are, else the default 4, always within 2 to 6. */
const defaultCount = (teams: number) => Math.min(MAX_TEAMS, Math.max(MIN_TEAMS, teams || DEFAULT_TEAMS))

/**
 * A team: its chip (the swatch and the name), how many are in it, Rename, and
 * its members as small tokens with their names, in join order.
 */
function TeamRow({ team, members, onRename }: { team: Team; members: Player[]; onRename?: () => void }) {
  return (
    <li className="grid gap-1.5 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <TeamChip team={team} size="lg" plain className="min-w-0" />
        <span className="shrink-0 text-xs text-paper-2">{memberCount(members.length)}</span>
        {onRename && (
          <Button variant="ghost" size="icon-sm" className="-my-1 ml-auto text-paper-2" aria-label={`Rename ${team.name}`} title="Rename" onClick={onRename}>
            <PencilSimpleIcon />
          </Button>
        )}
      </div>
      {members.length > 0 && <Members players={members} />}
    </li>
  )
}

/** Guests here in no team (moved out of one, or here from before a team was cleared and made again): they answer alone. */
function NoTeamRow({ players }: { players: Player[] }) {
  return (
    <li className="grid gap-1.5 py-2.5">
      <p className="flex items-center gap-2">
        <span className="text-sm font-bold text-paper">No team</span>
        <span className="text-xs text-paper-2">{memberCount(players.length)}, answering alone</span>
      </p>
      <Members players={players} />
    </li>
  )
}

function Members({ players }: { players: Player[] }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1.5 pl-5.5" aria-label="Members">
      {players.map((p) => (
        <li key={p.id} className="inline-flex min-w-0 items-center gap-1.5 text-sm">
          <Avatar name={p.name} playerId={p.id} className="size-5" />
          <span className="max-w-32 truncate">{p.name}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * 2 to 6 as one row of choices (radio buttons: the arrow keys move between
 * them). The picked one is paper with ink, as the phone's tab switch: a
 * choice, not a step, so never gold.
 */
function TeamCountPicker({
  value,
  onChange,
  labelledBy,
  disabled = false,
}: {
  value: number
  onChange: (count: number) => void
  labelledBy: string
  disabled?: boolean
}) {
  return (
    <RadioGroupPrimitive.Root
      value={String(value)}
      onValueChange={(next) => onChange(Number(next))}
      orientation="horizontal"
      disabled={disabled}
      aria-labelledby={labelledBy}
      className="grid grid-cols-5 gap-1 rounded-control bg-overlay p-1"
    >
      {TEAM_COUNTS.map((n) => (
        <RadioGroupPrimitive.Item
          key={n}
          value={String(n)}
          aria-label={`${n} teams`}
          className={cn(
            'tv-num grid h-9 place-items-center rounded-[6px] text-xl text-paper-2 transition-colors outline-none',
            'hover:text-paper focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
            'data-[state=checked]:bg-paper data-[state=checked]:text-ink',
          )}
        >
          {n}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  )
}

/**
 * Make teams again: a reshuffle of everyone here, so it asks first, with the
 * count to pick again and what it gives. Teams up to the new count keep their
 * names and colours.
 */
function RemakeDialog({
  open,
  onOpenChange,
  teams,
  guestsHere,
  count,
  onCount,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  teams: Team[]
  guestsHere: number
  count: number
  onCount: (count: number) => void
  onConfirm: () => void
}) {
  const labelId = useId()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Make the teams again?</DialogTitle>
          <DialogDescription>{remakeNote(teams, count)}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <p id={labelId} className="text-sm font-bold text-paper-2">
            How many teams
          </p>
          <TeamCountPicker value={count} onChange={onCount} labelledBy={labelId} />
          <p className="text-sm text-paper-2" aria-live="polite">
            {splitLine(guestsHere, count)}.
          </p>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" size="lg">
              Cancel
            </Button>
          </DialogClose>
          {/* The dialog's one step. */}
          <Button
            size="lg"
            onClick={() => {
              onOpenChange(false)
              onConfirm()
            }}
          >
            <ShuffleIcon />
            Make {count} teams
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
