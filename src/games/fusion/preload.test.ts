import { describe, expect, it } from 'vitest'
import { decodeSet, frameAspect, median, runQueue, wallAspect } from './preload'
import type { FusionPublicPicture, FusionPublicState, FusionReveal } from './shapes'

const RULES = { seconds: 30, perPerson: 1, bothBonus: 1 }
const REVEAL: FusionReveal = { names: ['Ana', 'Bo'], both: 1, one: 0, none: 0, voters: 1, originals: [null, null], step: 1, at: 1 }

/** A picture as the room sees it: asked (or revealed) pictures carry their image, the rest are placeholders with none. */
const picture = (n: number, patch: Partial<FusionPublicPicture> = {}): FusionPublicPicture => {
  const asked = patch.asked ?? patch.revealed != null
  return { n, key: `p${n}`, label: `#${n}`, asked, image: asked ? `s/g/${n}.jpg` : null, revealed: null, ...patch }
}

const state = (patch: Partial<FusionPublicState> = {}): FusionPublicState => ({
  phase: 'lobby',
  pictures: Array.from({ length: 12 }, (_, i) => picture(i + 1)),
  rules: RULES,
  current: null,
  top: [],
  ...patch,
})

const current = (n: number) => ({ n, step: 1, key: `p${n}`, openedAt: 0, startsAt: 2_800, endsAt: 32_800, revealedAt: null })

describe('decodeSet', () => {
  it('decodes nothing in the lobby or on the wall: the pictures to come are placeholders, their images unknown', () => {
    expect(decodeSet(state())).toEqual([])
    const pictures = Array.from({ length: 12 }, (_, i) => picture(i + 1, { revealed: i < 3 ? { ...REVEAL, step: i + 1 } : null }))
    expect(decodeSet(state({ phase: 'wall', pictures }))).toEqual([])
  })

  it('decodes the asked or revealed picture, and only that one, from the moment it is asked', () => {
    const asked = (n: number) => state({ pictures: Array.from({ length: 12 }, (_, i) => picture(i + 1, { asked: i + 1 === n })) })
    expect(decodeSet({ ...asked(6), phase: 'asking', current: current(6) })).toEqual([6])
    expect(decodeSet({ ...asked(6), phase: 'reveal', current: { ...current(6), revealedAt: 31_000 } })).toEqual([6])
  })

  it('decodes nothing once done, and never a picture without an image', () => {
    expect(decodeSet(state({ phase: 'done' }))).toEqual([])
    const pictures = [picture(1, { asked: true, image: null }), picture(2), picture(3, { asked: true, image: null }), picture(4)]
    expect(decodeSet(state({ phase: 'asking', pictures, current: current(3) }))).toEqual([])
    expect(decodeSet(state({ phase: 'asking', pictures, current: current(1) }))).toEqual([])
  })
})

describe("the pictures' shape", () => {
  it('takes the middle value', () => {
    expect(median([])).toBeNull()
    expect(median([0.8])).toBe(0.8)
    expect(median([1, 0.5, 0.8])).toBe(0.8)
    expect(median([0.6, 0.8, 1, 1.2])).toBe(0.9)
    expect(median([Number.NaN, -1, 0.75])).toBe(0.75)
  })

  it('gives the wall 4:5 until the thumbnails are in, then their middle shape from 0.6 to 1.5', () => {
    expect(wallAspect([])).toBe(0.8)
    expect(wallAspect([0.75, 0.75, 1])).toBe(0.75)
    expect(wallAspect([1.78, 1.78])).toBe(1.5)
    expect(wallAspect([0.3])).toBe(0.6)
  })

  it('keeps the frame portrait or square', () => {
    expect(frameAspect([])).toBe(0.8)
    expect(frameAspect([1.5, 1.5])).toBe(1)
    expect(frameAspect([0.4])).toBe(0.6)
  })
})

describe('runQueue', () => {
  it('runs every task, never more than the limit at once, past one that fails', async () => {
    let running = 0
    let most = 0
    const done: number[] = []
    const tasks = Array.from({ length: 9 }, (_, i) => async () => {
      running++
      most = Math.max(most, running)
      await new Promise((resolve) => setTimeout(resolve, 2))
      running--
      if (i === 3) throw new Error('a picture that fails')
      done.push(i)
    })
    await runQueue(tasks, 4, () => false)
    expect(most).toBe(4)
    expect(done.sort((a, b) => a - b)).toEqual([0, 1, 2, 4, 5, 6, 7, 8])
  })

  it('starts nothing new once stopped', async () => {
    let started = 0
    let stop = false
    const tasks = Array.from({ length: 6 }, () => async () => {
      started++
      await new Promise((resolve) => setTimeout(resolve, 1))
      stop = true
    })
    await runQueue(tasks, 2, () => stop)
    expect(started).toBe(2)
  })
})
