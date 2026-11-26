import { describe, expect, it } from 'vitest'
import type { GameGuest } from '@/games/core/Game'
import { DEFAULT_TASKS, type EliminationConfig } from './logic'
import { eliminationSetup, shorterThanDefaults } from './setup'

const guests = (count: number): GameGuest[] => Array.from({ length: count }, (_, i) => ({ id: `g${i}`, name: `Guest ${i}`, joined: i % 2 === 0 }))
const settings = (patch: Partial<EliminationConfig> = {}): EliminationConfig => ({ tasks: DEFAULT_TASKS, pointsPerTag: 1, pointsPerCatch: 1, dealInMinutes: 105, ...patch })

describe('Last one standing’s readiness', () => {
  it('is ready with its tasks, and says whether there is one for every guest', () => {
    const tasks = Array.from({ length: 64 }, (_, i) => `Get someone to do thing ${i + 1}`)
    expect(eliminationSetup(settings({ tasks }), guests(70))).toEqual({ ready: true, line: '64 tasks for 70 guests, so some get the same task' })
    expect(eliminationSetup(settings({ tasks }), guests(12))).toEqual({ ready: true, line: '64 tasks, enough for all 12 guests' })
    expect(eliminationSetup(settings({ tasks }), guests(1))).toEqual({ ready: true, line: '64 tasks, enough for the one guest' })
    expect(eliminationSetup(settings({ tasks }), [])).toEqual({ ready: true, line: '64 tasks to deal' })
    expect(eliminationSetup(settings(), guests(24))).toEqual({ ready: true, line: `${DEFAULT_TASKS.length} tasks, enough for all 24 guests` })
  })

  it('says the default list’s size beside a shorter saved list, so the host finds the reset', () => {
    expect(DEFAULT_TASKS).toHaveLength(60)
    const tasks = Array.from({ length: 30 }, (_, i) => `Get someone to do thing ${i + 1}`)
    expect(eliminationSetup(settings({ tasks }), guests(24))).toEqual({ ready: true, line: '30 tasks, enough for all 24 guests; the default list has 60' })
    expect(eliminationSetup(settings({ tasks: tasks.slice(0, 12) }), guests(16))).toEqual({
      ready: true,
      line: '12 tasks for 16 guests, so some get the same task; the default list has 60',
    })
    expect(eliminationSetup(settings({ tasks: tasks.slice(0, 12) }), [])).toEqual({ ready: true, line: '12 tasks to deal; the default list has 60' })
    expect(shorterThanDefaults(tasks)).toBe(true)
    expect(shorterThanDefaults(DEFAULT_TASKS)).toBe(false)
    expect(shorterThanDefaults([...tasks, ...tasks, 'One more'])).toBe(false)
    // Nothing to reset from: an empty list is "No tasks yet".
    expect(shorterThanDefaults([' ', ''])).toBe(false)
  })

  it('counts only the tasks with words', () => {
    expect(eliminationSetup(settings({ tasks: ['Get someone to wave', ' ', ''] }), guests(2)).line).toBe(
      '1 task for 2 guests, so some get the same task; the default list has 60',
    )
  })

  it('says what the start would refuse', () => {
    expect(eliminationSetup(settings({ tasks: [] }), guests(4))).toEqual({ ready: false, line: 'No tasks yet' })
    expect(eliminationSetup(settings({ tasks: ['x'.repeat(201)] }), guests(4))).toEqual({ ready: false, line: 'Task 1 is longer than 200 characters' })
    expect(eliminationSetup(settings({ pointsPerTag: 500 }), guests(4))).toEqual({ ready: false, line: 'Points per tag must be a whole number from 0 to 100' })
  })
})
