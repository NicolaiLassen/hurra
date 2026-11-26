import { describe, expect, it } from 'vitest'
import type { GameGuest } from '@/games/core/Game'
import type { FusionConfig, FusionPicture } from './logic'
import { fusionSetup } from './setup'

// Six guests here and two still expected; the pictures name them as typed.
const NAMES = ['Ana', 'Bo', 'Cille', 'Dan', 'Emil', 'Frida', 'Gry', 'Hans']
const guests: GameGuest[] = NAMES.map((name, i) => ({ id: `0000000${i}-0000-4000-8000-00000000000${i}`, name, joined: i < 6 }))

/** A picture with its image, its two names and both their own photos, unless it says otherwise. */
const picture = (n: number, patch: Partial<FusionPicture> = {}): FusionPicture => ({
  label: '',
  image: `s/g/fusion-${n}.jpg`,
  people: [NAMES[n % NAMES.length], NAMES[(n + 1) % NAMES.length]],
  originals: [`s/g/original-${n}-1.jpg`, `s/g/original-${n}-2.jpg`],
  ...patch,
})

const settings = (pictures: FusionPicture[], patch: Partial<FusionConfig> = {}): FusionConfig => ({
  pictures,
  pointsPerPerson: 1,
  bonusForBoth: 0,
  seconds: 30,
  ...patch,
})

const eight = (change: (n: number) => Partial<FusionPicture> = () => ({})) => Array.from({ length: 8 }, (_, i) => picture(i + 1, change(i + 1)))

describe('fusion’s readiness', () => {
  it('is ready once every picture has its image and two names, and says so with the own photos', () => {
    expect(fusionSetup(settings(eight()), guests)).toEqual({ ready: true, line: '8 pictures, all with two names and own photos' })
  })

  it('counts the own photos still missing as optional', () => {
    const some = eight((n) => (n === 2 ? { originals: undefined } : n === 5 ? { originals: [null, 's/g/o.jpg'] } : {}))
    expect(fusionSetup(settings(some), guests)).toEqual({ ready: true, line: '8 pictures, all with two names. Own photos (optional): 13 of 16' })
  })

  it('names the pictures still without two names, and one with the same name twice', () => {
    const missing = eight((n) => (n === 3 ? { people: undefined } : n === 7 ? { people: ['Ana', ' '] } : {}))
    expect(fusionSetup(settings(missing), guests)).toEqual({ ready: false, line: '6 of 8 pictures ready: 2 need two names' })
    const same = eight((n) => (n === 1 ? { people: ['Ana', ' ANA '] } : {}))
    expect(fusionSetup(settings(same), guests)).toEqual({ ready: false, line: '7 of 8 pictures ready: 1 needs two different names' })
  })

  it('takes names still expected, and counts the names that match nobody, as the editor flags them, without holding the game back', () => {
    const expected = eight((n) => (n === 1 ? { people: ['gry', 'Häns'] } : {}))
    expect(fusionSetup(settings(expected), guests)).toEqual({ ready: true, line: '8 pictures, all with two names and own photos' })
    const strangers = eight((n) => (n === 2 ? { people: ['Ana', 'Zelda'] } : n === 4 ? { people: ['Tilde', 'Zelda'], originals: undefined } : {}))
    expect(fusionSetup(settings(strangers), guests)).toEqual({
      ready: true,
      line: '8 pictures, all with two names. 3 names match nobody here or on the guest list. Own photos (optional): 14 of 16',
    })
    const one = eight((n) => (n === 2 ? { people: ['Ana', 'Zelda'] } : n === 6 ? { image: undefined } : {}))
    expect(fusionSetup(settings(one), guests)).toEqual({
      ready: false,
      line: '7 of 8 pictures ready: 1 needs an image. 1 name matches nobody here or on the guest list',
    })
  })

  it('reads settings saved with guest ids as their names, and names a picture whose id left the guest list', () => {
    const ids = eight((n) => (n === 1 ? { people: [guests[0].id, guests[7].id] } : {}))
    expect(fusionSetup(settings(ids), guests).ready).toBe(true)
    const left = eight((n) => (n === 4 ? { people: [guests[0].id, '0000000f-0000-4000-8000-00000000000f'] } : n === 6 ? { image: undefined } : {}))
    expect(fusionSetup(settings(left), guests)).toEqual({
      ready: false,
      line: '6 of 8 pictures ready: 1 names someone no longer on the guest list, 1 needs an image',
    })
  })

  it('says when there are no pictures, and what the start would refuse in the timing', () => {
    expect(fusionSetup(settings([]), guests)).toEqual({ ready: false, line: 'No pictures yet' })
    expect(fusionSetup(settings(eight(), { seconds: 5 }), guests)).toEqual({ ready: false, line: 'The time to guess must be 10 to 90 seconds' })
  })

  it('reads settings saved before a field existed without throwing', () => {
    expect(fusionSetup({} as FusionConfig, guests)).toEqual({ ready: false, line: 'No pictures yet' })
    expect(fusionSetup(settings([{ label: '' }]), []).line).toBe('0 of 1 picture ready: 1 needs two names, 1 needs an image')
    // A save from while the round opened with a showing still reads.
    expect(fusionSetup({ ...settings(eight()), showSeconds: 6 } as FusionConfig, guests).ready).toBe(true)
  })
})
