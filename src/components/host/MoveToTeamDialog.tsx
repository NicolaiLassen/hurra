import { useMemo, useState } from 'react'
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'
import { useHostCall } from '@/components/host/hostCalls'
import { moveChoices, NO_TEAM, teamIdOf } from '@/components/host/teamWords'
import { TeamSwatch } from '@/components/TeamChip'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { moveToTeam } from '@/lib/queries'
import { membersOf, teamOf, teamsOf } from '@/lib/teams'
import type { Snapshot } from '@/lib/types'
import { cn } from '@/lib/utils'

export type TeamMover = { id: string; name: string }

/**
 * Move a guest who is here to another team, or to no team (docs/user-flows.md,
 * "Teams"), from their menu in the guest list: the party's teams as a list to
 * pick from, each with how many are in it, and No team. Allowed while a game
 * is live: from their next answer on, they answer with the new team.
 */
export default function MoveToTeamDialog({
  snapshot,
  player,
  open,
  onOpenChange,
}: {
  snapshot: Snapshot
  /** The guest to move: kept while the dialog fades out. */
  player: TeamMover | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open && player !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Mounted only while open, so the pick starts from the guest's team each time. */}
        {player && <MoveForm key={player.id} snapshot={snapshot} player={player} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function MoveForm({ snapshot, player, onDone }: { snapshot: Snapshot; player: TeamMover; onDone: () => void }) {
  const call = useHostCall()
  const teams = teamsOf(snapshot)
  const currentTeamId = teamOf(snapshot, player.id)?.id ?? null
  const choices = useMemo(
    () => moveChoices(teams, new Map(teams.map((t) => [t.id, membersOf(snapshot, t.id).length])), currentTeamId),
    [snapshot, teams, currentTeamId],
  )
  const current = choices.find((c) => c.current)?.value ?? NO_TEAM
  const [picked, setPicked] = useState(current)
  const [pending, setPending] = useState(false)
  const choice = choices.find((c) => c.value === picked)

  async function move() {
    if (picked === current) return onDone()
    setPending(true)
    const to = choice?.label ?? 'the team'
    const moved = await call(() => moveToTeam(player.id, teamIdOf(picked)), picked === NO_TEAM ? `${player.name} is in no team now` : `Moved ${player.name} to ${to}`)
    setPending(false)
    if (moved) onDone()
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        void move()
      }}
    >
      <DialogHeader>
        <DialogTitle className="text-lg font-semibold">Move {player.name} to a team</DialogTitle>
        <DialogDescription>Their phone shows the new team. From their next answer on, they answer with it.</DialogDescription>
      </DialogHeader>
      <RadioGroupPrimitive.Root value={picked} onValueChange={setPicked} aria-label={`Team for ${player.name}`} className="grid gap-1">
        {choices.map((c) => (
          <RadioGroupPrimitive.Item
            key={c.value}
            value={c.value}
            className={cn(
              'group/choice flex min-w-0 items-center gap-3 rounded-control bg-overlay px-3 py-2.5 text-left transition-colors outline-none',
              'hover:bg-rule focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=checked]:bg-rule',
            )}
          >
            {/* The radio's own mark: a ring, filled with paper once picked. */}
            <span
              aria-hidden
              className="grid size-4 shrink-0 place-items-center rounded-full border-[1.5px] border-paper-3 group-data-[state=checked]/choice:border-paper"
            >
              <span className="size-2 rounded-full bg-paper opacity-0 group-data-[state=checked]/choice:opacity-100" />
            </span>
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="flex min-w-0 items-center gap-2 font-bold text-paper">
                {c.team && <TeamSwatch team={c.team} className="size-3.5" />}
                <span className="truncate">{c.label}</span>
              </span>
              <span className={cn('text-xs text-paper-2', c.team && 'pl-5.5')}>{c.detail}</span>
            </span>
          </RadioGroupPrimitive.Item>
        ))}
      </RadioGroupPrimitive.Root>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" size="lg">
            Cancel
          </Button>
        </DialogClose>
        {/* The dialog's one step, gold once another team is picked. */}
        <Button type="submit" size="lg" disabled={picked === current} isPending={pending}>
          Move
        </Button>
      </DialogFooter>
    </form>
  )
}
