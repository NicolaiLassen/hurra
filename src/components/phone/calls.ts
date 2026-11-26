// The phone's `act` and `submit` for a game view (docs/engine-v2.md, 5.3, 6
// and 7.1). Moves go to the engine; answers and votes go straight to the
// database. Both reject with the server's own words and show no toast: the
// game's view shows the refusal. After a success they read the snapshot
// again, because a phone hears no ping for its own call.
import { GameControllerIcon, type Icon } from '@phosphor-icons/react'
import { createContext, useCallback, useContext } from 'react'
import { getGameModule } from '@/games/registry'
import type { PhoneSecret } from '@/games/types'
import { callGame, submitAnswer } from '@/lib/queries'
import type { AnswerPayload, SessionGame, SubmitResult } from '@/lib/types'
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
      if (fixture) return fixtureSubmit(answer, serverNow())
      const result = await submitAnswer(gameId, key, answer)
      refresh()
      return result
    },
    [fixture, gameId, refresh, serverNow],
  )

  return { act, submit }
}

/**
 * A fixture's answer (dev builds only): taken at once, or with `&submit=slow`
 * in the page's URL after 3 s, and with `&submit=refuse` refused after 1 s,
 * so the phone's sending state and its rollback can be seen.
 */
async function fixtureSubmit(answer: AnswerPayload, at: number): Promise<SubmitResult> {
  const mode = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('submit')
  if (mode === 'slow') await new Promise((resolve) => setTimeout(resolve, 3000))
  if (mode === 'refuse') {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    throw new Error('Too late, answers are closed')
  }
  return { accepted: true, answer, at, ms: 0 }
}

/** A game type's icon: the module's own, or the controller for a type this phone doesn't know. */
export const gameIconOf = (gameType: string): Icon => getGameModule(gameType)?.icon ?? GameControllerIcon

/** A game that runs in the background, beside whatever holds the TV (its logic's presentation). */
export const isBackgroundGame = (gameType: string) => getGameModule(gameType)?.logic.presentation === 'background'

/**
 * A live game's own words for its strap (GameModule.phoneStrap): "Question 3
 * of 10". Null when it has none, or can't read its public state.
 */
export function phoneStrapOf(game: SessionGame): string | null {
  try {
    return getGameModule(game.game_type)?.phoneStrap?.(game.public_state) ?? null
  } catch {
    return null
  }
}

/**
 * This player's secret in a live game (GameModule.phoneSecret: Last one
 * standing's task), from their own view. Null when it has none, or can't
 * read the view.
 */
export function phoneSecretOf(game: SessionGame, view: unknown): PhoneSecret | null {
  try {
    const secret = getGameModule(game.game_type)?.phoneSecret?.(view)
    return secret && typeof secret.text === 'string' && secret.text.trim() !== '' ? secret : null
  } catch {
    return null
  }
}
