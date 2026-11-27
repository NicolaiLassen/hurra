import { useId, useState, type ComponentProps } from 'react'
import { Switch as SwitchPrimitive } from 'radix-ui'
import { useHostCall } from '@/components/host/hostCalls'
import { teamPlayLine } from '@/components/host/teamWords'
import { setTeamPlay } from '@/lib/queries'
import { teamPlayOn, teamsOf } from '@/lib/teams'
import type { SessionGame, Snapshot } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * Play in teams on a game's settings page (docs/user-flows.md, "Teams"), above
 * the game's own editor, for a game whose module can be played in teams
 * (canPlayInTeams). It is the game's own column, not one of its settings: a
 * change is saved at once, apart from the editor's Save. It changes only while
 * the game isn't live; live, it is read only and says how this round is
 * played. Without teams it may still be switched on, and says to make teams
 * in Guests first.
 */
export default function TeamPlaySetting({ snapshot, game }: { snapshot: Snapshot; game: SessionGame }) {
  const call = useHostCall()
  const on = teamPlayOn(game)
  const live = game.status === 'active'
  const teams = teamsOf(snapshot).length
  // What the host switched to, until the snapshot says so too, so the switch never flicks back while it catches up.
  const [wanted, setWanted] = useState<boolean | null>(null)
  const [pending, setPending] = useState(false)
  if (wanted !== null && !pending && wanted === on) setWanted(null)
  const checked = live ? on : (wanted ?? on)
  const id = useId()

  async function change(next: boolean) {
    if (pending) return
    setWanted(next)
    setPending(true)
    const done = await call(() => setTeamPlay(game.id, next))
    setPending(false)
    if (!done) setWanted(null)
  }

  return (
    <section className="flex items-start justify-between gap-4 rounded-lg bg-raised p-3 sm:p-4">
      <div className="grid min-w-0 gap-1">
        <label htmlFor={`${id}-switch`} className="font-extrabold">
          Play in teams
        </label>
        <p id={`${id}-line`} className="text-sm text-paper-2">
          {teamPlayLine({ on: checked, live, teams })}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-0.5">
        {/* The state in a word too, never only the switch's look. */}
        <span aria-hidden className="w-6 text-right text-sm font-bold text-paper-2">
          {checked ? 'On' : 'Off'}
        </span>
        <Switch
          id={`${id}-switch`}
          checked={checked}
          disabled={live}
          aria-busy={pending || undefined}
          aria-describedby={`${id}-line`}
          onCheckedChange={(next) => void change(next)}
        />
      </div>
    </section>
  )
}

/**
 * An on and off switch (role switch, Space or Enter toggles it), in the host's
 * shapes: the control radius, an edge that reaches 3 to 1 like a field's, and
 * paper once on. A setting, not a step, so never gold.
 */
export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-control border-[1.5px] border-paper-3/60 bg-overlay p-0.5 transition-colors outline-none',
        'focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:border-paper data-[state=checked]:bg-paper',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-4 rounded-chip bg-paper-2 transition-transform motion-reduce:transition-none data-[state=checked]:translate-x-5 data-[state=checked]:bg-ink" />
    </SwitchPrimitive.Root>
  )
}
