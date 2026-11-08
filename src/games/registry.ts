import { elimination } from '@/games/elimination'
import { inPerson } from '@/games/in-person'
import type { GameModule } from '@/games/types'

// Every game's screens. Register new games here and their logic in logic.ts
// (registry.test.ts checks the two lists match).
export const gameModules: GameModule[] = [inPerson, elimination]

export const getGameModule = (type: string) => gameModules.find((m) => m.logic.type === type)
