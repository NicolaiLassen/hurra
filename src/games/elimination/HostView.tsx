import { CrownIcon, DetectiveIcon, EyeIcon, EyeSlashIcon, SwordIcon, UserPlusIcon } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { clockTime } from '@/components/tv/clock'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { dealingIn, standing, winnerOf, type EliminationGame, type EliminationState } from '@/games/elimination/logic'
import { nameFrom } from '@/games/elimination/roster'
import type { HostViewProps } from '@/games/types'

/**
 * Last one standing in the control room: how many are still in, Deal in
 * latecomers with when it closes and the switch, who is still in (their
 * tasks behind Show tasks) and the latest knockouts.
 */
export default function HostView({ players, state, serverNow, act }: HostViewProps<EliminationGame>) {
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
  const late = new Set(state.late ?? [])

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

      {!winner && <DealIn state={state} serverNow={serverNow} act={act} />}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section>
          <h3 className="mb-2 text-sm font-extrabold">Still in</h3>
          <ul className="divide-y divide-rule">
            {alive.map(([id, task]) => (
              <li key={id} className="py-1.5">
                <p className="font-bold">
                  {nameOf(id)}
                  {late.has(id) && <span className="ml-2 text-xs font-semibold text-paper-3">dealt in late</span>}
                </p>
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

/**
 * Deal in latecomers: whether a guest who joins now gets a task, until when,
 * and the switch. It closes by itself at the time the settings gave
 * (re-drawn on the minute); Open dealing in keeps it open until Close.
 */
function DealIn({
  state,
  serverNow,
  act,
}: {
  state: EliminationState
  serverNow: () => number
  act: HostViewProps<EliminationGame>['act']
}) {
  const [pending, setPending] = useState(false)
  const [, redraw] = useState(0)
  const until = state.dealInUntil ?? null
  useEffect(() => {
    if (until === null) return
    const ms = until - serverNow()
    if (ms <= 0) return
    const timer = setTimeout(() => redraw((n) => n + 1), Math.min(ms + 250, 2 ** 31 - 1))
    return () => clearTimeout(timer)
  }, [until, serverNow])

  const open = dealingIn(state, serverNow())
  const lateCount = state.late?.length ?? 0
  const status = open
    ? until !== null
      ? `A guest who joins gets a task until ${clockTime(until)}.`
      : 'A guest who joins gets a task until you close it.'
    : state.dealIn !== false && until !== null
      ? `Closed by itself at ${clockTime(until)}. A guest who joins now watches this round.`
      : 'Closed. A guest who joins now watches this round.'

  async function send(next: boolean) {
    setPending(true)
    try {
      await act({ type: 'dealIn', open: next })
    } catch {
      // The host page shows a refusal as a toast in the server's words.
    } finally {
      setPending(false)
    }
  }

  return (
    <section aria-label="Deal in latecomers" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-control border border-rule p-3">
      <UserPlusIcon weight="duotone" className="size-6 shrink-0 text-pink" />
      <div className="min-w-0 flex-1 basis-56">
        <p className="font-bold">Deal in latecomers: {open ? 'on' : 'off'}</p>
        <p className="text-sm text-paper-2">
          {status}
          {lateCount > 0 && ` ${lateCount} dealt in late so far.`}
        </p>
      </div>
      <Button variant={open ? 'outline' : 'secondary'} isPending={pending} onClick={() => void send(!open)}>
        {open ? 'Close dealing in' : 'Open dealing in'}
      </Button>
    </section>
  )
}
