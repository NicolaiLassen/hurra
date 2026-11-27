import { describe, expect, it } from 'vitest'
import { cardChoice, rememberCardOpen } from './storage'

function memoryStorage() {
  const items = new Map<string, string>()
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) }
}

describe('live game cards', () => {
  it('have no choice of their own until the host opens or closes one', () => {
    const store = memoryStorage()
    expect(cardChoice('game-1', () => store)).toBeNull()
  })

  it('stay as the host left them after a reload, game by game', () => {
    const store = memoryStorage()
    rememberCardOpen('game-1', true, () => store)
    rememberCardOpen('game-2', false, () => store)
    expect(cardChoice('game-1', () => store)).toBe(true)
    expect(cardChoice('game-2', () => store)).toBe(false)
    expect(cardChoice('game-3', () => store)).toBeNull()
    rememberCardOpen('game-1', false, () => store)
    expect(cardChoice('game-1', () => store)).toBe(false)
  })

  it('fall back to the default and never throw where storage fails or is missing', () => {
    const broken = () => {
      throw new Error('blocked')
    }
    expect(cardChoice('game-1', broken)).toBeNull()
    expect(() => rememberCardOpen('game-1', true, broken)).not.toThrow()
    expect(cardChoice('game-1', () => null)).toBeNull()
  })
})
