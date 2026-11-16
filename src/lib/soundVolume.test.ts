import { describe, expect, it } from 'vitest'
import { DEFAULT_SOUND_VOLUME, newestOnly, soundVolumeGain, soundVolumeOf, stillHeld } from './soundVolume'

const db = (gain: number) => 20 * Math.log10(gain)

describe('soundVolumeOf', () => {
  it('keeps a stored volume as a whole percentage from 0 to 100', () => {
    expect(soundVolumeOf(0)).toBe(0)
    expect(soundVolumeOf(25)).toBe(25)
    expect(soundVolumeOf(100)).toBe(100)
    expect(soundVolumeOf(33.4)).toBe(33)
    expect(soundVolumeOf(-5)).toBe(0)
    expect(soundVolumeOf(250)).toBe(100)
  })

  it('reads anything that is not a number as full volume: a snapshot from before the setting', () => {
    for (const value of [undefined, null, '50', Number.NaN, Number.POSITIVE_INFINITY, {}]) {
      expect(soundVolumeOf(value), String(value)).toBe(DEFAULT_SOUND_VOLUME)
    }
    expect(DEFAULT_SOUND_VOLUME).toBe(100)
  })
})

describe('soundVolumeGain', () => {
  it('is silent at 0 and as loud as the sound library at 100', () => {
    expect(soundVolumeGain(0)).toBe(0)
    expect(soundVolumeGain(100)).toBe(1)
  })

  it('makes each step sound as loud as its percentage: 50% is 10 dB down, 25% is 20 dB down', () => {
    const near = (gain: number, decibels: number) => expect(Math.abs(db(gain) - decibels)).toBeLessThan(0.1)
    near(soundVolumeGain(50), -10)
    near(soundVolumeGain(25), -20)
    near(soundVolumeGain(75), -4.2)
    // A linear gain would have been 6 dB down at 50%, which still sounds two thirds as loud.
    expect(soundVolumeGain(50)).toBeLessThan(0.5)
  })

  it('grows with every step and stays within 0 and 1, whatever it is given', () => {
    const gains = [0, 5, 25, 50, 75, 100].map(soundVolumeGain)
    for (let i = 1; i < gains.length; i++) expect(gains[i]).toBeGreaterThan(gains[i - 1])
    expect(soundVolumeGain(-20)).toBe(0)
    expect(soundVolumeGain(400)).toBe(1)
    expect(soundVolumeGain(Number.NaN)).toBe(1)
  })
})

describe('newestOnly, the slider\'s saves', () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('runs the newest waiting task after the running one, and skips the ones it replaced', async () => {
    const enqueue = newestOnly()
    const ran: string[] = []
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    let firstWasNewest: boolean | undefined
    enqueue(async (newest) => {
      ran.push('80%')
      await held
      firstWasNewest = newest()
    })
    await tick()
    enqueue(async () => void ran.push('60%'))
    enqueue(async () => void ran.push('30%'))
    release()
    await tick()
    expect(ran).toEqual(['80%', '30%'])
    expect(firstWasNewest).toBe(false)
  })

  it('tells a lone task it is the newest', async () => {
    const enqueue = newestOnly()
    let seen: boolean | undefined
    enqueue(async (newest) => void (seen = newest()))
    await tick()
    expect(seen).toBe(true)
  })

  it('keeps saving after a task that throws', async () => {
    const enqueue = newestOnly()
    const ran: string[] = []
    enqueue(async () => {
      throw new Error('offline')
    })
    await tick()
    enqueue(async () => void ran.push('next'))
    await tick()
    expect(ran).toEqual(['next'])
  })
})

describe("stillHeld, the slider's thumb while the snapshot catches up", () => {
  it('keeps an unsaved level while an older one arrives from an earlier save', () => {
    expect(stillHeld({ level: 20, settled: false }, 60)).toEqual({ level: 20, settled: false })
  })

  it('lets go once the snapshot has the level, saved or not', () => {
    expect(stillHeld({ level: 20, settled: false }, 20)).toBeNull()
    expect(stillHeld({ level: 20, settled: true }, 20)).toBeNull()
  })

  it('gives way to a newer level from another tab once the host\'s level saved', () => {
    expect(stillHeld({ level: 20, settled: true }, 45)).toBeNull()
  })

  it('holds nothing when nothing was set', () => {
    expect(stillHeld(null, 50)).toBeNull()
  })
})
