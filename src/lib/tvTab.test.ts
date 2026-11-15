import { afterEach, describe, expect, it, vi } from 'vitest'
import { announceTvTab, TV_TAB_BEAT_MS, TV_TAB_FRESH_MS, tvTabChannel, tvTabWindow, watchTvTab } from './tvTab'

// Node has BroadcastChannel, with the browser's semantics: messages arrive
// asynchronously at every other channel of the same name in the process.
const settle = () => new Promise((resolve) => setTimeout(resolve, 30))
const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((stop) => stop())
  vi.useRealTimers()
})

describe('the TV tab in a host browser', () => {
  it('names the channel and the window by the join code', () => {
    expect(tvTabChannel('HURRA30')).toBe('hurra:tv-tab:HURRA30')
    expect(tvTabWindow('HURRA30')).toBe('hurra-tv-HURRA30')
  })

  it('tells a host page that opens later at once, through its hello', async () => {
    cleanups.push(announceTvTab('ABC123'))
    const seen: boolean[] = []
    cleanups.push(watchTvTab('ABC123', (open) => seen.push(open)))
    await settle()
    expect(seen).toEqual([true])
  })

  it('says goodbye when the TV tab closes', async () => {
    const seen: boolean[] = []
    cleanups.push(watchTvTab('ABC123', (open) => seen.push(open)))
    const stop = announceTvTab('ABC123')
    await settle()
    stop()
    await settle()
    expect(seen).toEqual([true, false])
  })

  it('stays open while a second TV tab remains', async () => {
    const seen: boolean[] = []
    cleanups.push(watchTvTab('ABC123', (open) => seen.push(open)))
    const first = announceTvTab('ABC123')
    cleanups.push(announceTvTab('ABC123'))
    await settle()
    first()
    await settle()
    expect(seen).toEqual([true])
  })

  it('ignores other parties', async () => {
    const seen: boolean[] = []
    cleanups.push(watchTvTab('ABC123', (open) => seen.push(open)))
    cleanups.push(announceTvTab('OTHER1'))
    await settle()
    expect(seen).toEqual([])
  })

  it('forgets a tab that went quiet, after the freshness window', async () => {
    let now = 1_000_000
    const seen: boolean[] = []
    cleanups.push(watchTvTab('ABC123', (open) => seen.push(open), () => now))
    // A tab that announced once and then went silent (crashed), without a goodbye.
    const channel = new BroadcastChannel(tvTabChannel('ABC123'))
    channel.postMessage({ kind: 'open', tab: 'gone' })
    await settle()
    expect(seen).toEqual([true])
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    // The watcher's interval was created with real timers; a fresh watcher uses the fake ones.
    cleanups.splice(0).forEach((stop) => stop())
    const later: boolean[] = []
    cleanups.push(watchTvTab('ABC123', (open) => later.push(open), () => now))
    channel.postMessage({ kind: 'open', tab: 'gone' })
    await settle()
    expect(later).toEqual([true])
    now += TV_TAB_FRESH_MS - 1
    vi.advanceTimersByTime(TV_TAB_BEAT_MS)
    expect(later).toEqual([true])
    now += 2
    vi.advanceTimersByTime(TV_TAB_BEAT_MS)
    expect(later).toEqual([true, false])
    channel.close()
  })
})
