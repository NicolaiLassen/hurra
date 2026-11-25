import { elimination } from '@/games/elimination'
import { fusion } from '@/games/fusion'
import { inPerson } from '@/games/in-person'
import { quiz } from '@/games/quiz'
import type { GameModule } from '@/games/types'
import type { SessionGame } from '@/lib/types'

// Every game's screens. Register new games here, their logic in logic.ts and
// their bots in bots.ts (registry.test.ts checks the three lists match).
export const gameModules: GameModule[] = [inPerson, elimination, quiz, fusion]

export const getGameModule = (type: string) => gameModules.find((m) => m.logic.type === type)

/** A game's colour on air (GameModule.accent): 'hunt' for the hunt's pink, else undefined. */
export const accentOf = (gameType: string | null | undefined) => (gameType ? getGameModule(gameType)?.accent : undefined)

/**
 * Loads every game's TV screens now (lazyScreen), for the TV as it opens: it
 * runs all evening, and a deploy meanwhile removes the files its app knows.
 */
export function preloadTvScreens() {
  for (const { TvView, FinalTvView } of gameModules) {
    TvView?.preload?.()
    FinalTvView?.preload?.()
  }
}

/**
 * Who the live games have knocked out (GameModule.knockedOut), so a list of
 * the party can mark them Out. Only live games count: once a round is over,
 * nobody is out of anything running. A hook that throws on a public state it
 * can't read (a save from an older bundle) marks nobody, so it can't take the
 * list down with it.
 */
export function knockedOutIds(games: readonly SessionGame[], modules: readonly GameModule[] = gameModules): ReadonlySet<string> {
  const out = new Set<string>()
  for (const game of games) {
    if (game.status !== 'active' || game.archived_at !== null) continue
    const knockedOut = modules.find((m) => m.logic.type === game.game_type)?.knockedOut
    if (!knockedOut) continue
    try {
      for (const id of knockedOut(game.public_state)) if (typeof id === 'string') out.add(id)
    } catch {
      // Unreadable: nobody is marked out by this game.
    }
  }
  return out
}
