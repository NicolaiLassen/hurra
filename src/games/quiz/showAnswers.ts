// "Show the answers here" (docs/identity.md, The quiz on a phone): during a
// question a phone shows only the four letters, and the question is on the
// TV. A guest who wants the question and the answers on their phone too opts
// in, and the phone remembers it in localStorage. Storage can be missing or
// throw (a private window, blocked site data): then the choice still holds
// for this tab, in memory, and the page never breaks over it.
import { useCallback, useSyncExternalStore } from 'react'

/** The localStorage key. '1' shows the answers; anything else, or nothing, shows letters only. */
export const SHOW_ANSWERS_KEY = 'hurra:quiz:show-answers'

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>

/** The page's localStorage, or null without a window. Reading it may throw: callers guard it. */
const pageStorage = (): Storage | null => (typeof window === 'undefined' ? null : window.localStorage)

/**
 * The opt-in over one storage: `read` and `write`, which never throw. What was
 * last written also stays in memory, so a storage that throws or forgets
 * still keeps the choice for as long as the page is open.
 */
export function showAnswersStore(storage: () => Storage | null = pageStorage) {
  let memory: boolean | null = null
  const listeners = new Set<() => void>()

  function read(): boolean {
    // This page's own choice first: a storage that failed to save it may still hold an older one.
    if (memory !== null) return memory
    try {
      return storage()?.getItem(SHOW_ANSWERS_KEY) === '1'
    } catch {
      return false
    }
  }

  function write(value: boolean): void {
    memory = value
    try {
      storage()?.setItem(SHOW_ANSWERS_KEY, value ? '1' : '0')
    } catch {
      // Full, blocked or missing: the memory above keeps it for this page.
    }
    for (const listener of listeners) listener()
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return { read, write, subscribe }
}

const store = showAnswersStore()

/** Whether this phone shows the question and the answers, and the setter that remembers it. */
export function useShowAnswers(): [boolean, (value: boolean) => void] {
  const shown = useSyncExternalStore(store.subscribe, store.read, () => false)
  const set = useCallback((value: boolean) => store.write(value), [])
  return [shown, set]
}
