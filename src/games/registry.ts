import { elimination } from '@/games/elimination'
import { fusion } from '@/games/fusion'
import { inPerson } from '@/games/in-person'
import { quiz } from '@/games/quiz'
import { soundtrack } from '@/games/soundtrack'
import type { GameGuest } from '@/games/core/Game'
import type { GameModule, SetupStatus } from '@/games/types'
import type { SessionGame } from '@/lib/types'

// Every game's screens. Register new games here, their logic in logic.ts and
// their bots in bots.ts (registry.test.ts checks the three lists match).
export const gameModules: GameModule[] = [inPerson, elimination, quiz, fusion, soundtrack]

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

/** A game's settings as its round would start with them: the saved ones over its defaults, as the engine merges them. */
export function configOf(gameModule: GameModule, saved: Readonly<Record<string, unknown>> | null | undefined): Record<string, unknown> {
  return { ...(gameModule.logic.defaultConfig as Record<string, unknown>), ...(saved ?? {}) }
}

/**
 * A game's readiness before it starts (GameModule.setupStatus), from its saved
 * settings over its defaults. Null for a game without the hook, an unknown
 * type, and a hook that throws on settings it can't read: the row then shows
 * no line and its Start as always. A game without a settings editor is
 * always ready, since there is nothing the host could set up.
 */
export function setupStatusOf(
  gameType: string,
  saved: Readonly<Record<string, unknown>> | null | undefined,
  guests: readonly GameGuest[],
  modules: readonly GameModule[] = gameModules,
): SetupStatus | null {
  const gameModule = modules.find((m) => m.logic.type === gameType)
  if (!gameModule?.setupStatus) return null
  try {
    const status = gameModule.setupStatus(configOf(gameModule, saved), guests)
    if (!status || typeof status.line !== 'string') return null
    return { ready: status.ready === true || !gameModule.ConfigEditor, line: status.line }
  } catch {
    return null
  }
}

/** The game's own check of its settings (parseConfig), as the engine runs it at start: its words, or null when they would start. */
export function startProblemOf(gameModule: GameModule, config: Readonly<Record<string, unknown>>): string | null {
  try {
    gameModule.logic.parseConfig?.(config as Record<string, unknown>)
    return null
  } catch (error) {
    return error instanceof Error && error.message ? error.message : 'These settings would not start'
  }
}
