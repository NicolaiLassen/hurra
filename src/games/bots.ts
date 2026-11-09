import type { GameBot } from './core/bot'
import { bot as elimination } from './elimination/bot'
import { bot as fusion } from './fusion/bot'
import { bot as inPerson } from './in-person/bot'
import { bot as quiz } from './quiz/bot'

// Every game's rehearsal bot, keyed by game type (docs/engine-v2.md, 3.6), so
// the rehearsal plays every game without knowing its rules. Relative imports
// only: the rehearsal runs this file under Node.
export const gameBots: ReadonlyMap<string, GameBot> = new Map([
  ['in-person', inPerson],
  ['elimination', elimination],
  ['quiz', quiz],
  ['fusion', fusion],
])
