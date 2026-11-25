import type { AnyGame } from './core/Game'
import { EliminationGame } from './elimination/logic'
import { FusionGame } from './fusion/logic'
import { InPersonGame } from './in-person/logic'
import { QuizGame } from './quiz/logic'
import { SoundtrackGame } from './soundtrack/logic'

// Every game's logic, keyed by game type: what the engine runs. Register new
// games here, their screens in registry.ts and their bots in bots.ts
// (registry.test.ts checks the three lists match). Relative imports only: the
// Netlify function bundles this file.
const games: AnyGame[] = [new InPersonGame(), new EliminationGame(), new QuizGame(), new FusionGame(), new SoundtrackGame()]

export const gameLogic: ReadonlyMap<string, AnyGame> = new Map(games.map((game) => [game.type, game]))
