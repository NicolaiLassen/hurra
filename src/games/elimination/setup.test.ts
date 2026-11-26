import { describe, expect, it } from 'vitest'
import type { GameGuest } from '@/games/core/Game'
import { DEFAULT_TASKS, type EliminationConfig } from './logic'
import { eliminationSetup } from './setup'

const guests = (count: number): GameGuest[] => Array.from({ length: count }, (_, i) => ({ id: `g${i}`, name: `Guest ${i}`, joined: i % 2 === 0 }))
const settings = (patch: Partial<EliminationConfig> = {}): EliminationConfig => ({ tasks: DEFAULT_TASKS, pointsPerTag: 1, pointsPerCatch: 1, dealInMinutes: 105, ...patch })

describe('Last one standing’s readiness', () => {
  it('is ready with its tasks, and says whether there is one for every guest', () => {
    const tasks = Array.from({ length: 12 }, (_, i) => `Get someone to do thing ${i + 1}`)
    expect(eliminationSetup(settings({ tasks }), guests(16))).toEqual({ ready: true, line: '12 tasks for 16 guests, so some get the same task' })
    expect(eliminationSetup(settings({ tasks }), guests(12))).toEqual({ ready: true, line: '12 tasks, enough for all 12 guests' })
    expect(eliminationSetup(settings({ tasks }), guests(1))).toEqual({ ready: true, line: '12 tasks, enough for the one guest' })
    expect(eliminationSetup(settings({ tasks }), [])).toEqual({ ready: true, line: '12 tasks to deal' })
  })

  it('counts only the tasks with words', () => {
    expect(eliminationSetup(settings({ tasks: ['Get someone to wave', ' ', ''] }), guests(2)).line).toBe('1 task for 2 guests, so some get the same task')
  })

  it('says what the start would refuse', () => {
    expect(eliminationSetup(settings({ tasks: [] }), guests(4))).toEqual({ ready: false, line: 'No tasks yet' })
    expect(eliminationSetup(settings({ tasks: ['x'.repeat(201)] }), guests(4))).toEqual({ ready: false, line: 'Task 1 is longer than 200 characters' })
    expect(eliminationSetup(settings({ pointsPerTag: 500 }), guests(4))).toEqual({ ready: false, line: 'Points per tag must be a whole number from 0 to 100' })
  })
})
