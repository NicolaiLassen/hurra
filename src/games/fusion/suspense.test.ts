// The suspense of a picture asked, on the TV: the highlight's way to it, its
// slowing, the ticks, and which TV plays it.
import { describe, expect, it } from 'vitest'
import { SUSPENSE_MS } from './shapes'
import { beatAt, FLIP_AT, FRESH_OPEN_MS, GROW_AT, HOP_MS, hopPath, hopPathFrom, IN_AT, litAt, playsSuspense, PULSE_AT, TICK_GAP_MS, tickTimes } from './suspense'

const twelve = Array.from({ length: 12 }, (_, i) => i + 1)

describe('the beats', () => {
  it('hop, grow, pulse, flip, then the picture is in, all inside the time the logic keeps for it', () => {
    expect(beatAt(0)).toBe('hop')
    expect(beatAt(GROW_AT - 1)).toBe('hop')
    expect(beatAt(GROW_AT)).toBe('grow')
    expect(beatAt(PULSE_AT)).toBe('pulse')
    expect(beatAt(FLIP_AT)).toBe('flip')
    expect(beatAt(IN_AT)).toBe('in')
    // About 2 to 3 seconds in all, and the countdown starts once it is over.
    expect(IN_AT).toBeGreaterThanOrEqual(2000)
    expect(IN_AT).toBeLessThanOrEqual(SUSPENSE_MS)
    expect(SUSPENSE_MS).toBeLessThanOrEqual(3000)
  })
})

describe('hopPath', () => {
  it('ends on the picture asked at HOP_MS, going forward through the pictures still to come', () => {
    const path = hopPath([4, 5, 6, 7, 8, 9, 10, 11, 12], 4)
    expect(path.at(-1)).toEqual({ n: 4, at: HOP_MS })
    expect(path[0].at).toBe(0)
    // Forward, wrapping round the wall: 4 is the last stop.
    expect(path.map((hop) => hop.n)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 4].slice(-path.length))
  })

  it('slows down: every hop lasts longer than the one before', () => {
    const path = hopPath(twelve, 7)
    const gaps = path.slice(1).map((hop, i) => hop.at - path[i].at)
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThanOrEqual(gaps[i - 1])
    expect(gaps[0]).toBeLessThan(80)
    expect(gaps.at(-1)).toBeGreaterThan(250)
  })

  it('sweeps a big wall in strides, and hops round two pictures more than once', () => {
    const forty = Array.from({ length: 40 }, (_, i) => i + 1)
    const wide = hopPath(forty, 40)
    expect(wide).toHaveLength(10)
    expect(wide[0].n).toBe(4)
    expect(wide.at(-1)!.n).toBe(40)
    expect(hopPath([3, 8], 8).map((hop) => hop.n)).toEqual([3, 8, 3, 8, 3, 8])
  })

  it('lights the last picture to come at once', () => {
    expect(hopPath([12], 12)).toEqual([{ n: 12, at: 0 }])
    // The picture asked is among the candidates even when left out.
    expect(hopPath([], 5)).toEqual([{ n: 5, at: 0 }])
  })

  it('is the same on every TV: no randomness, only the pictures', () => {
    expect(hopPath(twelve, 9)).toEqual(hopPath([...twelve].reverse(), 9))
  })
})

describe('hopPathFrom', () => {
  it('squeezes the hops into what is left for a TV that caught the ask late, still landing at HOP_MS', () => {
    const path = hopPath(twelve, 4)
    const late = hopPathFrom(path, 500)
    expect(late.map((hop) => hop.n)).toEqual(path.map((hop) => hop.n))
    expect(late[0].at).toBe(500)
    expect(late.at(-1)!.at).toBe(HOP_MS)
    expect(hopPathFrom(path, HOP_MS + 100)).toEqual([{ n: 4, at: HOP_MS + 100 }])
    expect(hopPathFrom(path, 0)).toEqual(path)
  })
})

describe('litAt', () => {
  it('is the hop the highlight is on, and nothing before the first', () => {
    const path = hopPath(twelve, 4)
    expect(litAt(path, -1)).toBeNull()
    expect(litAt(path, 0)).toBe(path[0].n)
    expect(litAt(path, HOP_MS)).toBe(4)
    expect(litAt(path, GROW_AT - 1)).toBe(4)
  })
})

describe('tickTimes', () => {
  it('ticks on the landing, and never two ticks closer than the pop lasts', () => {
    const ticks = tickTimes(hopPath(twelve, 4))
    expect(ticks.at(-1)).toBe(HOP_MS)
    expect(ticks.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < ticks.length; i++) expect(ticks[i] - ticks[i - 1]).toBeGreaterThanOrEqual(TICK_GAP_MS)
    expect(tickTimes([{ n: 1, at: 0 }])).toEqual([0])
    expect(tickTimes([])).toEqual([])
  })
})

describe('playsSuspense', () => {
  it('plays on a TV that was up as the ask came in, or opened right as it did; never once it is over', () => {
    expect(playsSuspense(900, true)).toBe(true)
    expect(playsSuspense(SUSPENSE_MS, true)).toBe(false)
    // A TV that opens in the middle shows how it ends.
    expect(playsSuspense(FRESH_OPEN_MS - 1, false)).toBe(true)
    expect(playsSuspense(FRESH_OPEN_MS, false)).toBe(false)
    expect(playsSuspense(1500, false)).toBe(false)
    // A TV whose clock runs a little ahead sees the ask in the future: it waits for it.
    expect(playsSuspense(-1200, false)).toBe(true)
  })
})
