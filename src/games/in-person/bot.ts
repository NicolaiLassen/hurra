import type { GameBot } from '../core/bot'

/**
 * The rehearsal's in-person round (docs/engine-v2.md, 3.6 and 8.2). Guests play
 * it in real life and never act on their phones, and the host only gives
 * points, which the rehearsal does through the ordinary award path (a host
 * award with this game's id). So the bot never moves and has no host moves.
 */
export const bot: GameBot = {
  move: () => null,
}
