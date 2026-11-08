import { describe, expect, it } from 'vitest'
import { decideSound, REPEAT_GAP_MS, SOFT_QUIET_MS, strongestSound, type SoundSlot } from '@/lib/soundPolicy'

const slash: SoundSlot = { name: 'slash', priority: 3, startedAt: 1000, endsAt: 2000 }

describe('decideSound', () => {
  it('plays when nothing has played yet', () => {
    expect(decideSound({ name: 'coin', priority: 2 }, null, 0)).toBe('play')
  })

  it('skips the same sound while it plays or just after it started', () => {
    expect(decideSound({ name: 'slash', priority: 3 }, slash, 1500)).toBe('skip')
    const blip = { ...slash, endsAt: 1100 }
    expect(decideSound({ name: 'slash', priority: 3 }, blip, 1000 + REPEAT_GAP_MS - 1)).toBe('skip')
    expect(decideSound({ name: 'slash', priority: 3 }, blip, 1000 + REPEAT_GAP_MS)).toBe('play')
  })

  it('lets an equal or higher priority sound take over', () => {
    expect(decideSound({ name: 'gotcha', priority: 3 }, slash, 1200)).toBe('replace')
    expect(decideSound({ name: 'fanfare', priority: 5 }, slash, 1200)).toBe('replace')
  })

  it('skips a lower priority sound while another plays', () => {
    expect(decideSound({ name: 'coin', priority: 2 }, slash, 1200)).toBe('skip')
  })

  it('plays a different sound once the last one has ended', () => {
    expect(decideSound({ name: 'coin', priority: 2 }, slash, 2000)).toBe('play')
  })

  it('keeps soft sounds out of the way of anything recent', () => {
    expect(decideSound({ name: 'coin', priority: 2, soft: true }, slash, 1500)).toBe('skip')
    const short = { ...slash, endsAt: 1200 }
    expect(decideSound({ name: 'coin', priority: 2, soft: true }, short, 1000 + SOFT_QUIET_MS - 1)).toBe('skip')
    expect(decideSound({ name: 'coin', priority: 2, soft: true }, short, 1000 + SOFT_QUIET_MS)).toBe('play')
    expect(decideSound({ name: 'coin', priority: 2, soft: true }, null, 0)).toBe('play')
  })

  it('lets any other sound take over from a soft one that is playing', () => {
    const softCoin: SoundSlot = { name: 'coin', priority: 2, soft: true, startedAt: 1000, endsAt: 2000 }
    expect(decideSound({ name: 'pop', priority: 1 }, softCoin, 1200)).toBe('replace')
    // The same sound again is still a duplicate, so a coin never restarts on top of itself.
    expect(decideSound({ name: 'coin', priority: 2 }, softCoin, 1200)).toBe('skip')
  })
})

describe('strongestSound', () => {
  it('picks the highest priority sound of a batch', () => {
    expect(strongestSound(['coin', 'fanfare'])).toBe('fanfare')
    expect(strongestSound(['sad', 'coin'])).toBe('sad')
  })

  it('keeps the first one on a tie and ignores unknown names', () => {
    expect(strongestSound(['slash', 'gotcha'])).toBe('slash')
    expect(strongestSound([null, 'nope', 'pop'])).toBe('pop')
    expect(strongestSound([null, undefined])).toBeUndefined()
  })
})
