// The phone's `act` and `submit` for a game view (docs/engine-v2.md, 5.3, 6
// and 7.1). Moves go to the engine; answers and votes go straight to the
// database. Both reject with the server's own words and show no toast: the
// game's view shows the refusal. After a success they read the snapshot
// again, because a phone hears no ping for its own call.
import { GameControllerIcon, type Icon } from '@phosphor-icons/react'
import { createContext, useCallback, useContext } from 'react'
import { getGameModule } from '@/games/registry'
import { callGame, submitAnswer } from '@/lib/queries'
import type { AnswerPayload, SubmitResult } from '@/lib/types'
import { useLive } from '@/lib/useLive'

/**
 * True while the phone shows a fixture (dev builds, ?fixture=<scene>, 5.11):
 * calls pretend to succeed and nothing reaches the network.
 */
export const FixtureMode = createContext(false)

export function usePhoneCalls(gameId: string): {
  act: (action: unknown) => Promise<void>
  submit: (key: string, answer: AnswerPayload) => Promise<SubmitResult>
} {
  const { refresh, serverNow } = useLive()
  const fixture = useContext(FixtureMode)

  const act = useCallback(
    async (action: unknown) => {
      if (fixture) return
      // A `replayed` or `skipped` answer is a success too: the tap was saved once.
      await callGame({ type: 'action', gameId, action })
      refresh()
    },
    [fixture, gameId, refresh],
  )

  const submit = useCallback(
    async (key: string, answer: AnswerPayload): Promise<SubmitResult> => {
      if (fixture) return { accepted: true, answer, at: serverNow(), ms: 0 }
      const result = await submitAnswer(gameId, key, answer)
      refresh()
      return result
    },
    [fixture, gameId, refresh, serverNow],
  )

  return { act, submit }
}

/** A game type's icon: the module's own, or the controller for a type this phone doesn't know. */
export const gameIconOf = (gameType: string): Icon => getGameModule(gameType)?.icon ?? GameControllerIcon
