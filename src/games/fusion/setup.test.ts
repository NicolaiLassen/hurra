import { describe, expect, it } from 'vitest'
import type { GameGuest } from '@/games/core/Game'
import type { FusionConfig, FusionPicture } from './logic'
import { fusionSetup } from './setup'

const guests: GameGuest[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id, i) => ({ id, name: `Guest ${id}`, joined: i < 6 }))
const ids = guests.map((g) => g.id)

/** A picture with its image, its two people and both their own photos, unless it says otherwise. */
const picture = (n: number, patch: Partial<FusionPicture> = {}): FusionPicture => ({
  label: '',
  image: `s/g/fusion-${n}.jpg`,
  people: [ids[n % ids.length], ids[(n + 1) % ids.length]],
  originals: [`s/g/original-${n}-1.jpg`, `s/g/original-${n}-2.jpg`],
  ...patch,
})

const settings = (pictures: FusionPicture[], patch: Partial<FusionConfig> = {}): FusionConfig => ({
  pictures,
  pointsPerPerson: 1,
  bonusForBoth: 0,
  seconds: 30,
  showSeconds: 6,
  ...patch,
})

const eight = (change: (n: number) => Partial<FusionPicture> = () => ({})) => Array.from({ length: 8 }, (_, i) => picture(i + 1, change(i + 1)))

describe('fusion’s readiness', () => {
  it('is ready once every picture has its image and its two people, and says so with the own photos', () => {
    expect(fusionSetup(settings(eight()), guests)).toEqual({ ready: true, line: '8 pictures, all with their people and own photos' })
  })

  it('counts the own photos still missing as optional', () => {
    const some = eight((n) => (n === 2 ? { originals: undefined } : n === 5 ? { originals: [null, 's/g/o.jpg'] } : {}))
    expect(fusionSetup(settings(some), guests)).toEqual({ ready: true, line: '8 pictures, all with their people. Own photos (optional): 13 of 16' })
  })

  it('names the pictures still without their two people', () => {
    const missing = eight((n) => (n === 3 ? { people: undefined } : n === 7 ? { people: ['a', ''] as unknown as [string, string] } : {}))
    expect(fusionSetup(settings(missing), guests)).toEqual({ ready: false, line: '6 of 8 pictures ready: 2 need both their people' })
    const one = eight((n) => (n === 1 ? { people: ['a', 'a'] } : {}))
    expect(fusionSetup(settings(one), guests)).toEqual({ ready: false, line: '7 of 8 pictures ready: 1 needs both its people' })
  })

  it('names a picture whose person left the guest list, and one without its image', () => {
    const left = eight((n) => (n === 4 ? { people: ['a', 'gone'] } : n === 6 ? { image: undefined } : {}))
    expect(fusionSetup(settings(left), guests)).toEqual({
      ready: false,
      line: '6 of 8 pictures ready: 1 names someone no longer on the guest list, 1 needs an image',
    })
  })

  it('takes people still expected on the guest list', () => {
    const expected = eight((n) => (n === 1 ? { people: ['g', 'h'] } : {}))
    expect(fusionSetup(settings(expected), guests).ready).toBe(true)
  })

  it('says when there are no pictures, and what the start would refuse in the timing', () => {
    expect(fusionSetup(settings([]), guests)).toEqual({ ready: false, line: 'No pictures yet' })
    expect(fusionSetup(settings(eight(), { seconds: 5 }), guests)).toEqual({ ready: false, line: 'The time to guess must be 10 to 90 seconds' })
  })

  it('reads settings saved before a field existed without throwing', () => {
    expect(fusionSetup({} as FusionConfig, guests)).toEqual({ ready: false, line: 'No pictures yet' })
    expect(fusionSetup(settings([{ label: '' }]), []).line).toBe('0 of 1 picture ready: 1 needs both its people, 1 needs an image')
  })
})
