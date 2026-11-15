import { describe, expect, it, vi } from 'vitest'
import { LATE_MS, soundDelay } from './clock'

vi.mock('@/lib/sound', () => ({ playSound: vi.fn() }))

// The tick-tock is due 1.6 s before a question's time runs out (TvView), so its bell lands on zero.
describe('a moment sound due at a set time', () => {
  it('waits until its time', () => {
    expect(soundDelay(10_000, 8_400)).toBe(1_600)
  })

  it('starts at once when it is due, or only a little late', () => {
    expect(soundDelay(10_000, 10_000)).toBe(0)
    expect(soundDelay(10_000, 10_000 + LATE_MS)).toBe(0)
  })

  it('stays quiet on a screen that opens too late for the moment to mean anything', () => {
    expect(soundDelay(10_000, 10_000 + LATE_MS + 1)).toBeNull()
  })
})
