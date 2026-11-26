// A latecomer's phone asks to be dealt in (docs/engine-v2.md, 8.1). The game
// deals a guest in when a save sees them join, but phones never sync, so a
// guest who joins between saves would wait for the next knockout. Instead the
// phone sends the game's `join` move once: that save deals them in, and the
// reply's refresh brings their task. A join that can't be dealt (closed, a
// freed name, over) is answered as skipped and changes nothing.
import { useCallback, useEffect, useState } from 'react'
import { dealingInNow, type EliminationAction, type EliminationPlayerView, type EliminationPublicState } from '@/games/elimination/logic'
import type { SessionGame } from '@/lib/types'

/** Rounds this page has asked to be dealt into: once each, whichever of the card and the full view mounts first. */
const asked = new Set<string>()

/** Whether this phone should ask: no task in this round yet, and the latest save says dealing in is open. */
export function wantsDealIn(
  view: EliminationPlayerView | null | undefined,
  publicState: EliminationPublicState | null | undefined,
  now: number,
): boolean {
  return (view === null || view?.status === 'spectator') && dealingInNow(publicState, now)
}

export type DealMeIn = {
  /** The phone has no view yet and is being dealt in: say so instead of "You watch this round". */
  waiting: boolean
  /** The move didn't get through (no answer): offer to try again. */
  failed: boolean
  retry: () => void
}

export function useDealMeIn({
  game,
  view,
  publicState,
  serverNow,
  act,
}: {
  game: SessionGame
  view: EliminationPlayerView | null | undefined
  publicState: EliminationPublicState | null
  serverNow: () => number
  act: (action: EliminationAction) => Promise<void>
}): DealMeIn {
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const want = game.status === 'active' && wantsDealIn(view, publicState, serverNow())
  const round = `${game.id}:${game.started_at ?? ''}`

  useEffect(() => {
    if (!want || asked.has(round)) return
    asked.add(round)
    act({ type: 'join' }).catch(() => {
      // Another tap may try again; a refusal needs no toast here.
      asked.delete(round)
      setFailed(true)
    })
  }, [want, round, act, attempt])

  const retry = useCallback(() => {
    setFailed(false)
    setAttempt((n) => n + 1)
  }, [])
  return { waiting: want && view === null && !failed, failed: want && failed, retry }
}
