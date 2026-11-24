// "Show the answers here": each phone remembers its choice in localStorage,
// and a phone whose storage is missing or throws keeps it for the page.
import { describe, expect, it } from 'vitest'
import { SHOW_ANSWERS_KEY, showAnswersStore } from '@/games/quiz/showAnswers'

/** A plain in-memory Storage. */
function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial))
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  }
}

const throwing = () => {
  throw new DOMException('The operation is insecure.', 'SecurityError')
}

describe('Show the answers here', () => {
  it('is off until the phone asks, then remembered in localStorage', () => {
    const storage = memoryStorage()
    const store = showAnswersStore(() => storage)
    expect(store.read()).toBe(false)
    store.write(true)
    expect(store.read()).toBe(true)
    expect(storage.items.get(SHOW_ANSWERS_KEY)).toBe('1')
    store.write(false)
    expect(store.read()).toBe(false)
    expect(storage.items.get(SHOW_ANSWERS_KEY)).toBe('0')
  })

  it('reads what an earlier visit saved: the next question, a reload', () => {
    const storage = memoryStorage({ [SHOW_ANSWERS_KEY]: '1' })
    expect(showAnswersStore(() => storage).read()).toBe(true)
    expect(showAnswersStore(() => memoryStorage({ [SHOW_ANSWERS_KEY]: 'yes please' })).read()).toBe(false)
  })

  it('works with no storage at all: off, and the choice held for this page', () => {
    const store = showAnswersStore(() => null)
    expect(store.read()).toBe(false)
    store.write(true)
    expect(store.read()).toBe(true)
  })

  it('never throws when reaching localStorage throws (a private window, blocked site data)', () => {
    const store = showAnswersStore(throwing)
    expect(() => store.read()).not.toThrow()
    expect(store.read()).toBe(false)
    expect(() => store.write(true)).not.toThrow()
    // Held in memory for this page instead.
    expect(store.read()).toBe(true)
  })

  it('keeps this page\'s choice when saving it throws (storage full), over the older one stored', () => {
    const storage = { ...memoryStorage({ [SHOW_ANSWERS_KEY]: '1' }), setItem: throwing }
    const store = showAnswersStore(() => storage)
    expect(store.read()).toBe(true)
    store.write(false)
    expect(store.read()).toBe(false)
  })

  it('tells the screens when the choice changes', () => {
    const store = showAnswersStore(() => memoryStorage())
    let heard = 0
    const stop = store.subscribe(() => void heard++)
    store.write(true)
    stop()
    store.write(false)
    expect(heard).toBe(1)
  })
})
