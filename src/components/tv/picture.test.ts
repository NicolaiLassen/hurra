// The TV's picture (docs/identity.md, The TV's frame): Standard until the
// corner's toggle or a link asks for Brighter, then remembered on that TV in
// localStorage; a TV whose storage is missing or throws keeps it for the page.
import { createElement } from 'react'
import { prerender } from 'react-dom/static'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PictureButton } from '@/components/tv/Corner'
import { PICTURE_KEY, pictureFromParam, pictureStore, togglePicture } from '@/components/tv/picture'

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

/** The corner's picture button, rendered to static HTML. */
async function button(): Promise<string> {
  const { prelude } = await prerender(createElement(PictureButton))
  return new Response(prelude).text()
}

describe('a link that sets the picture', () => {
  it('asks for Brighter with ?picture=bright, and in any case', () => {
    expect(pictureFromParam('bright')).toBe('bright')
    expect(pictureFromParam('Brighter')).toBe('bright')
    expect(pictureFromParam(' BRIGHT ')).toBe('bright')
    expect(pictureFromParam('standard')).toBe('standard')
  })

  it('asks for nothing without the parameter, or with a picture that does not exist', () => {
    for (const value of [null, undefined, '', 'dim', '1', 'true']) expect(pictureFromParam(value), String(value)).toBeNull()
  })
})

describe('the picture on one TV', () => {
  it('is Standard until the TV asks, then remembered in localStorage', () => {
    const storage = memoryStorage()
    const store = pictureStore(() => storage)
    expect(store.read()).toBe('standard')
    store.write('bright')
    expect(store.read()).toBe('bright')
    expect(storage.items.get(PICTURE_KEY)).toBe('bright')
    store.write('standard')
    expect(store.read()).toBe('standard')
    expect(storage.items.get(PICTURE_KEY)).toBe('standard')
  })

  it('reads what an earlier visit saved: a reload, or the TV opened again tomorrow', () => {
    const storage = memoryStorage()
    pictureStore(() => storage).write('bright')
    expect(pictureStore(() => storage).read()).toBe('bright')
    expect(pictureStore(() => memoryStorage({ [PICTURE_KEY]: 'very bright' })).read()).toBe('standard')
  })

  it('works with no storage at all: Standard, and the choice held for this page', () => {
    const store = pictureStore(() => null)
    expect(store.read()).toBe('standard')
    store.write('bright')
    expect(store.read()).toBe('bright')
  })

  it('never throws when reaching localStorage throws (a private window, blocked site data)', () => {
    const store = pictureStore(throwing)
    expect(() => store.read()).not.toThrow()
    expect(store.read()).toBe('standard')
    expect(() => store.write('bright')).not.toThrow()
    expect(store.read()).toBe('bright')
  })

  it("keeps this page's choice when saving it throws (storage full), over the older one stored", () => {
    const storage = { ...memoryStorage({ [PICTURE_KEY]: 'bright' }), setItem: throwing }
    const store = pictureStore(() => storage)
    expect(store.read()).toBe('bright')
    store.write('standard')
    expect(store.read()).toBe('standard')
  })

  it('tells the screen when the picture changes, and only then', () => {
    const store = pictureStore(() => memoryStorage())
    let heard = 0
    const stop = store.subscribe(() => void heard++)
    store.write('standard')
    store.write('bright')
    store.write('bright')
    stop()
    store.write('standard')
    expect(heard).toBe(1)
  })
})

describe("the corner's toggle", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('switches Standard and Brighter, says which in its pressed state, and is remembered on the TV', async () => {
    const storage = memoryStorage()
    vi.stubGlobal('window', { localStorage: storage })

    const standard = await button()
    expect(standard).toContain('aria-label="Brighter picture"')
    expect(standard).toContain('aria-pressed="false"')

    togglePicture()
    expect(storage.items.get(PICTURE_KEY)).toBe('bright')
    const bright = await button()
    expect(bright).toContain('aria-label="Brighter picture"')
    expect(bright).toContain('aria-pressed="true"')
    // A reload reads it back.
    expect(pictureStore(() => storage).read()).toBe('bright')

    togglePicture()
    expect(storage.items.get(PICTURE_KEY)).toBe('standard')
    expect(await button()).toContain('aria-pressed="false"')
  })
})
