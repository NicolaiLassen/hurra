// The TV's picture (docs/identity.md, The TV's frame): Standard, or Brighter
// for a TV that crushes dark tones, where the warm black, the panels on it and
// the secondary text sink into one black. Brighter is the same look with its
// dark end raised: src/index.css overrides those tokens under
// :root[data-tv-picture='bright'], which the TV page sets while it is open, so
// no component knows about it. Each TV remembers its picture in localStorage,
// behind try/catch (where storage fails, the page keeps it in memory), and a
// link can set it: /tv/HURRA30?picture=bright.
import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react'
import { useSearchParams } from 'react-router'

export type Picture = 'standard' | 'bright'

/** The localStorage key. 'bright' is Brighter; anything else, or nothing, is Standard. */
export const PICTURE_KEY = 'hurra:tv:picture'
/** The link's query parameter: ?picture=bright (or brighter) or ?picture=standard. */
export const PICTURE_PARAM = 'picture'
/** The attribute on the document's root that src/index.css lifts the palette under. */
export const PICTURE_ATTRIBUTE = 'data-tv-picture'

/** The picture a link asks for, or null when it asks for none (or for one that doesn't exist). */
export function pictureFromParam(value: string | null | undefined): Picture | null {
  const word = value?.trim().toLowerCase()
  if (word === 'bright' || word === 'brighter') return 'bright'
  if (word === 'standard') return 'standard'
  return null
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

/** The page's localStorage, or null without a window. Reading it may throw: callers guard it. */
const pageStorage = (): Storage | null => (typeof window === 'undefined' ? null : window.localStorage)

/**
 * The picture over one storage: `read` and `write`, which never throw. What
 * was last written also stays in memory, so a storage that throws or forgets
 * still keeps the picture for as long as the page is open.
 */
export function pictureStore(storage: () => Storage | null = pageStorage) {
  let memory: Picture | null = null
  const listeners = new Set<() => void>()

  function read(): Picture {
    // This page's own choice first: a storage that failed to save it may still hold an older one.
    if (memory !== null) return memory
    try {
      return storage()?.getItem(PICTURE_KEY) === 'bright' ? 'bright' : 'standard'
    } catch {
      return 'standard'
    }
  }

  function write(picture: Picture): void {
    if (picture === read()) return
    memory = picture
    try {
      storage()?.setItem(PICTURE_KEY, picture)
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

const store = pictureStore()

/** This TV's picture. The app never renders on a server, so a static render (the tests) reads the same. */
export function usePicture(): Picture {
  return useSyncExternalStore(store.subscribe, store.read, store.read)
}

/** The corner's toggle: Standard to Brighter and back, remembered on this TV. */
export function togglePicture(): void {
  store.write(store.read() === 'bright' ? 'standard' : 'bright')
}

/**
 * The TV page's root (/tv/:joinCode, the host's Show the TV here included):
 * a link's ?picture= is saved as this TV's picture and taken off the address,
 * so the corner's toggle has the last word after a reload; and the document's
 * root carries data-tv-picture while the page is open, set before the first
 * paint, so a Brighter TV never flashes the standard picture.
 */
export function useTvPicture(): Picture {
  const [search, setSearch] = useSearchParams()
  const asked = pictureFromParam(search.get(PICTURE_PARAM))
  const stored = usePicture()
  const picture = asked ?? stored

  useEffect(() => {
    if (!search.has(PICTURE_PARAM)) return
    if (asked) store.write(asked)
    setSearch(
      (current) => {
        const next = new URLSearchParams(current)
        next.delete(PICTURE_PARAM)
        return next
      },
      { replace: true },
    )
  }, [asked, search, setSearch])

  useLayoutEffect(() => {
    const root = document.documentElement
    if (picture === 'bright') root.setAttribute(PICTURE_ATTRIBUTE, 'bright')
    else root.removeAttribute(PICTURE_ATTRIBUTE)
    return () => root.removeAttribute(PICTURE_ATTRIBUTE)
  }, [picture])

  return picture
}
