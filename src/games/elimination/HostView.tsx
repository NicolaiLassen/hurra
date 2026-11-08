import { CrownIcon, DetectiveIcon, EyeIcon, EyeSlashIcon, SwordIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { EliminationGame } from '@/games/elimination/logic'
import type { HostViewProps } from '@/games/types'

export default function HostView({ players, state }: HostViewProps<EliminationGame>) {
  // Tasks stay hidden by default in case the host page is on a shared screen.
  const [showTasks, setShowTasks] = useState(false)
  if (!state) return <p className="text-muted-foreground">Dealing tasks…</p>

  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? 'Someone'
  const alive = Object.entries(state.tasks)
  const winner = alive.length === 1 && state.playerIds.length > 1 ? alive[0][0] : null

  return (
    // grid-cols-1: one column as wide as the panel, so a long winner name truncates instead of widening it.
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-lg font-semibold">
          {alive.length} of {state.playerIds.length} still in
        </p>
        {winner && (
          <Badge size="lg" className="max-w-full">
            <CrownIcon weight="fill" />
            {/* Only the name truncates, so "wins" stays readable. */}
            <span className="truncate">{nameOf(winner)}</span> <span className="shrink-0">wins</span>
          </Badge>
        )}
        <Button variant="ghost" className="ml-auto" onClick={() => setShowTasks((s) => !s)}>
          {showTasks ? <EyeSlashIcon /> : <EyeIcon />}
          {showTasks ? 'Hide tasks' : 'Show tasks'}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section>
          <h3 className="mb-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">Still in</h3>
          <ul className="divide-y">
            {alive.map(([id, task]) => (
              <li key={id} className="py-1.5">
                <p className="font-medium">{nameOf(id)}</p>
                {showTasks && <p className="text-sm text-muted-foreground">{task}</p>}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="mb-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">Latest knockouts</h3>
          {state.knockouts.length === 0 && <p className="text-sm text-muted-foreground">Nobody's out yet.</p>}
          <ul className="divide-y">
            {state.knockouts
              .slice(-6)
              .reverse()
              .map((k) => (
                <li key={`${k.by}-${k.target}`} className="flex gap-2 py-1.5">
                  {k.method === 'catch' ? (
                    <DetectiveIcon weight="duotone" className="mt-0.5 size-5 shrink-0 text-confetti-teal" />
                  ) : (
                    <SwordIcon weight="duotone" className="mt-0.5 size-5 shrink-0 text-confetti-pink" />
                  )}
                  <div className="min-w-0">
                    <p className="font-medium">
                      {nameOf(k.by)} {k.method === 'catch' ? 'caught' : 'tagged'} {nameOf(k.target)}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">“{k.task}”</p>
                  </div>
                </li>
              ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
