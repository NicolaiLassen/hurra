import { describe, expect, it } from 'vitest'
import { ARRIVE_LATEST_MS, ARRIVE_MS, arriveIn, LEADERS_FROM_PX, revealOriginals } from './reveal'
import type { FusionPublicPicture, FusionPublicState, FusionReveal } from './shapes'

const REVEAL: FusionReveal = {
  people: ['ana', 'bo'],
  names: ['Ana', 'Bo'],
  both: 1,
  one: 0,
  none: 0,
  voters: 1,
  originals: ['s/g/ana.jpg', null],
  step: 1,
  at: 1,
}
const picture = (n: number, revealed: FusionReveal | null = null): FusionPublicPicture => ({ n, key: `p${n}`, label: `#${n}`, image: null, revealed })
const state = (patch: Partial<FusionPublicState>): FusionPublicState => ({
  phase: 'wall',
  pictures: [picture(1, REVEAL), picture(2)],
  rules: { seconds: 30, showSeconds: 6, perPerson: 1, bothBonus: 1 },
  showing: null,
  current: null,
  top: [],
  expected: [],
  ...patch,
})

describe('the reveal on the TV', () => {
  it("hands over the two people's own photos only while their picture is revealed", () => {
    const current = { n: 1, step: 1, key: 'p1', openedAt: 0, endsAt: 30_000, revealedAt: 31_250 }
    expect(revealOriginals(state({ phase: 'reveal', current }))).toEqual(['s/g/ana.jpg', null])
    // On the wall afterwards, or while another picture is asked, none are loaded: the reveal's are dropped.
    expect(revealOriginals(state({ phase: 'wall' }))).toBeNull()
    expect(revealOriginals(state({ phase: 'asking', current: { ...current, n: 2, key: 'p2', revealedAt: null } }))).toBeNull()
    expect(revealOriginals(null)).toBeNull()
  })

  it('brings each person in at their beat once their photo is ready, or late while it loads, never later', () => {
    const [first, second] = ARRIVE_MS
    expect(first).toBeLessThan(second)
    // Ready, none or failed: at the beat, which has passed or not.
    for (const status of ['ready', 'none', 'failed'] as const) {
      expect(arriveIn(status, 0, first)).toBe(first)
      expect(arriveIn(status, 300, second)).toBe(second - 300)
      expect(arriveIn(status, 5_000, first)).toBe(0)
    }
    // Still loading: at the latest moment, so a slow photo never holds the reveal up.
    expect(arriveIn('loading', 0, first)).toBe(ARRIVE_LATEST_MS)
    expect(arriveIn('loading', 1_500, first)).toBe(ARRIVE_LATEST_MS - 1_500)
    expect(arriveIn('loading', ARRIVE_LATEST_MS + 1, first)).toBe(0)
  })

  it('keeps the sharpest eyes for stages with room: not 720p with two band lines', () => {
    // The stage heights of docs/identity.md, The TV's frame (and 52 px more with an empty band).
    for (const height of [860, 800, 732, 718, 666, 606, 556, 504]) expect(height >= LEADERS_FROM_PX, String(height)).toBe(true)
    expect(444 >= LEADERS_FROM_PX).toBe(false)
  })
})
