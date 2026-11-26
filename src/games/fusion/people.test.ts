// Who is in a picture, as the host types it: the names suggested, where a
// typed name stands, and a setting saved with ids shown as names.
import { describe, expect, it } from 'vitest'
import { nameStatus, peopleNames, suggestedNames } from './people'

const guests = [
  { id: 'g1', name: 'Ana', joined: true },
  { id: 'g2', name: 'Zelda', joined: false },
  { id: 'g3', name: 'Åse', joined: false },
]
const players = [{ id: 'g1', name: 'Ana' }, { id: 'p9', name: 'bo' }]

describe('suggestedNames', () => {
  it('suggests everyone here and on the guest list, each once, the way they joined, A to Z the Danish way', () => {
    expect(suggestedNames(guests, players)).toEqual(['Ana', 'bo', 'Zelda', 'Åse'])
  })
})

describe('nameStatus', () => {
  it('says whether a typed name is a guest here, one on the list not here yet, or on no list, whatever its case and spaces', () => {
    expect(nameStatus(' ana ', guests, players)).toBe('here')
    expect(nameStatus('BO', guests, players)).toBe('here')
    expect(nameStatus('zelda', guests, players)).toBe('expected')
    expect(nameStatus('Tilde', guests, players)).toBe('unknown')
    expect(nameStatus('  ', guests, players)).toBe('empty')
  })
})

describe('peopleNames', () => {
  it("shows a setting saved with guests' ids as their names, typed names as typed, and an id on no list as a guest who left", () => {
    expect(peopleNames(['g1', 'g2'], guests, players)).toEqual(['Ana', 'Zelda'])
    expect(peopleNames(['Ana', 'Tilde'], guests, players)).toEqual(['Ana', 'Tilde'])
    expect(peopleNames(['f1c7a000-0000-4000-8000-000000000099', ''], guests, players)).toEqual(['A guest who left', ''])
    expect(peopleNames(undefined, guests, players)).toEqual(['', ''])
  })
})
