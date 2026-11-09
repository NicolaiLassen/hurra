import { elimination } from '@/games/elimination'
import { fusion } from '@/games/fusion'
import { inPerson } from '@/games/in-person'
import { quiz } from '@/games/quiz'
import type { GameModule } from '@/games/types'

// Every game's screens. Register new games here, their logic in logic.ts and
// their bots in bots.ts (registry.test.ts checks the three lists match).
export const gameModules: GameModule[] = [inPerson, elimination, quiz, fusion]

export const getGameModule = (type: string) => gameModules.find((m) => m.logic.type === type)
