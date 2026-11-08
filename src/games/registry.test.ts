import { expect, it } from 'vitest'
import { gameLogic } from './logic'
import { gameModules } from './registry'

it('registers every game with both its logic and its screens', () => {
  expect(gameModules.map((m) => m.logic.type).sort()).toEqual([...gameLogic.keys()].sort())
})
