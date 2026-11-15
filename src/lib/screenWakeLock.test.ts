import { describe, expect, it, vi } from 'vitest'
import { keepScreenAwake, type VisibleDocument, type WakeLockApi } from './screenWakeLock'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function fakes(visible = true) {
  const listeners = new Set<() => void>()
  const doc = {
    visibilityState: visible ? 'visible' : 'hidden',
    addEventListener: (_type: string, fn: () => void) => void listeners.add(fn),
    removeEventListener: (_type: string, fn: () => void) => void listeners.delete(fn),
  } as unknown as VisibleDocument & { visibilityState: string }
  const releases: (() => void)[] = []
  const released = vi.fn()
  const wakeLock: WakeLockApi = {
    request: vi.fn(async () => {
      const onRelease: (() => void)[] = []
      const sentinel = {
        release: async () => {
          released()
          onRelease.forEach((fn) => fn())
        },
        addEventListener: (_type: 'release', fn: () => void) => void onRelease.push(fn),
      }
      // What the browser does when the tab hides: it releases the lock itself.
      releases.push(() => onRelease.forEach((fn) => fn()))
      return sentinel
    }),
  }
  const setVisible = (value: boolean) => {
    ;(doc as { visibilityState: string }).visibilityState = value ? 'visible' : 'hidden'
    if (!value) releases.splice(0).forEach((release) => release())
    listeners.forEach((fn) => fn())
  }
  return { doc, wakeLock, released, setVisible, listeners }
}

describe('keeping the TV screen awake', () => {
  it('takes the lock while the page shows, and releases it on cleanup', async () => {
    const { doc, wakeLock, released, listeners } = fakes()
    const stop = keepScreenAwake(wakeLock, doc)
    await flush()
    expect(wakeLock.request).toHaveBeenCalledWith('screen')
    stop()
    expect(released).toHaveBeenCalledTimes(1)
    expect(listeners.size).toBe(0)
  })

  it('waits for the page to show, and takes the lock again after the browser drops it', async () => {
    const { doc, wakeLock, setVisible } = fakes(false)
    const stop = keepScreenAwake(wakeLock, doc)
    await flush()
    expect(wakeLock.request).not.toHaveBeenCalled()
    setVisible(true)
    await flush()
    expect(wakeLock.request).toHaveBeenCalledTimes(1)
    setVisible(false)
    setVisible(true)
    await flush()
    expect(wakeLock.request).toHaveBeenCalledTimes(2)
    stop()
  })

  it('does nothing without the API, and survives a refusal', async () => {
    const { doc } = fakes()
    expect(() => keepScreenAwake(undefined, doc)()).not.toThrow()
    const refusing: WakeLockApi = { request: vi.fn(async () => Promise.reject(new Error('NotAllowedError'))) }
    const stop = keepScreenAwake(refusing, doc)
    await flush()
    expect(refusing.request).toHaveBeenCalledTimes(1)
    stop()
  })

  it('releases a lock that arrives after cleanup', async () => {
    const { doc, wakeLock, released } = fakes()
    const stop = keepScreenAwake(wakeLock, doc)
    stop()
    await flush()
    expect(released).toHaveBeenCalledTimes(1)
  })
})
