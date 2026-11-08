import type { AnyGame } from './core/Game'
import { EliminationGame } from './elimination/logic'
import { InPersonGame } from './in-person/logic'

// Every game's server-side logic, keyed by game type. Register new games here
// and their screens in registry.ts (a test checks the two lists match).
const games: AnyGame[] = [new InPersonGame(), new EliminationGame()]

export const gameLogic = new Map(games.map((game) => [game.type, game]))
