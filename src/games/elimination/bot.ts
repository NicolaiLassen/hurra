import type { GameBot } from '../core/bot'
import { dealingInNow, type EliminationAction, type EliminationPlayerView, type EliminationPublicState } from './logic'

/** About one call in 20, a guest still standing knocks someone out. */
export const KNOCKOUT_CHANCE = 1 / 20

/**
 * Last one standing in the rehearsal (docs/engine-v2.md, 3.6): a latecomer
 * with no view yet asks to be dealt in while dealing in is open, as the phone
 * does; while standing, now and then a guest tags or catches a random other
 * player still standing. Default settings and no host moves: the last
 * knockout finishes the game.
 */
export const bot: GameBot = {
  move(sight) {
    const view = sight.view as EliminationPlayerView | null
    const publicState = sight.publicState as Partial<EliminationPublicState> | null
    if (view === null && dealingInNow(publicState, sight.now)) return { kind: 'action', action: { type: 'join' } satisfies EliminationAction }
    if (view?.status !== 'alive' || sight.random() >= KNOCKOUT_CHANCE) return null
    const present = new Set(sight.players.map((p) => p.id))
    const others = (Array.isArray(publicState?.alive) ? publicState.alive : []).filter(
      (id) => id !== sight.playerId && present.has(id),
    )
    if (others.length === 0) return null
    const target = others[Math.floor(sight.random() * others.length)]
    const action: EliminationAction = { type: sight.random() < 0.5 ? 'tag' : 'catch', target }
    return { kind: 'action', action }
  },
}
