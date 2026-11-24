import { CrownIcon, DetectiveIcon, EyeIcon, EyeSlashIcon, SwordIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { standing, winnerOf, type EliminationGame } from '@/games/elimination/logic'
import { nameFrom } from '@/games/elimination/roster'
import type { HostViewProps } from '@/games/types'

export default function HostView({ players, state }: HostViewProps<EliminationGame>) {
  // Tasks stay hidden by default in case the host page is on a shared screen.
  const [showTasks, setShowTasks] = useState(false)
  if (!state) return <p className="text-paper-2">Dealing tasks…</p>

  const nameOf = nameFrom(players)
  // Tasks repeat when there are more guests than tasks: a knockout's task stays
  // hidden while someone still holds the same one, as in the room's feed (publicState).
  const live = new Set(Object.values(state.tasks))
  // Only players still in the party: a removed guest's task left with them.
  const party = { players }
  const alive = standing(state, party).map((id) => [id, state.tasks[id]] as const)
  const winner = winnerOf(state, party)
  const dealtIn = state.playerIds.filter((id) => players.some((p) => p.id === id)).length

  return (
    // grid-cols-1: one column as wide as the panel, so a long winner name truncates instead of widening it.
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-lg font-extrabold">
          <span className="tv-num text-xl">
            {alive.length} of {dealtIn}
          </span>{' '}
          still in
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
          <h3 className="mb-2 text-sm font-extrabold">Still in</h3>
          <ul className="divide-y divide-rule">
            {alive.map(([id, task]) => (
              <li key={id} className="py-1.5">
                <p className="font-bold">{nameOf(id)}</p>
                {showTasks && <p className="text-sm text-paper-2">{task}</p>}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="mb-2 text-sm font-extrabold">Latest knockouts</h3>
          {state.knockouts.length === 0 && <p className="text-sm text-paper-2">Nobody's out yet.</p>}
          <ul className="divide-y divide-rule">
            {state.knockouts
              .slice(-6)
              .reverse()
              .map((k) => (
                <li key={`${k.by}-${k.target}`} className="flex gap-2 py-1.5">
                  {/* Both are the hunt: pink (docs/identity.md). The words say which. */}
                  {k.method === 'catch' ? (
                    <DetectiveIcon weight="duotone" className="mt-0.5 size-5 shrink-0 text-pink" />
                  ) : (
                    <SwordIcon weight="duotone" className="mt-0.5 size-5 shrink-0 text-pink" />
                  )}
                  <div className="min-w-0">
                    <p className="font-bold">
                      {nameOf(k.by)} {k.method === 'catch' ? 'caught' : 'tagged'} {nameOf(k.target)}
                    </p>
                    {(showTasks || !live.has(k.task)) && <p className="truncate text-sm text-paper-2">“{k.task}”</p>}
                  </div>
                </li>
              ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
