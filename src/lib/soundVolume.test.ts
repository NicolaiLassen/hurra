import { describe, expect, it } from 'vitest'
import { DEFAULT_SOUND_VOLUME, SOUND_VOLUME_STEPS, soundVolumeGain, soundVolumeOf } from './soundVolume'

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
    const gains = SOUND_VOLUME_STEPS.map(soundVolumeGain)
    for (let i = 1; i < gains.length; i++) expect(gains[i]).toBeGreaterThan(gains[i - 1])
    expect(soundVolumeGain(-20)).toBe(0)
    expect(soundVolumeGain(400)).toBe(1)
    expect(soundVolumeGain(Number.NaN)).toBe(1)
  })
})

describe('the steps', () => {
  it('run from off to full volume, the default, in rising order', () => {
    expect(SOUND_VOLUME_STEPS[0]).toBe(0)
    expect(SOUND_VOLUME_STEPS.at(-1)).toBe(DEFAULT_SOUND_VOLUME)
    expect([...SOUND_VOLUME_STEPS].sort((a, b) => a - b)).toEqual(SOUND_VOLUME_STEPS)
    expect(SOUND_VOLUME_STEPS).toEqual([0, 25, 50, 75, 100])
  })
})
