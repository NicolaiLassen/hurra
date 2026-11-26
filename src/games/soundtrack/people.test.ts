// Who sits Lydspor out, as typed names (people.ts): matched by name, with ids
// from settings saved before names read as their guest's name. Every name here
// is invented.
import { describe, expect, it } from 'vitest'
import { sameNames, sitOutNames, sittingOut } from './people'

const id = (n: number) => `f1c7a000-0000-4000-8000-${String(n).padStart(12, '0')}`
const players = [
  { id: id(1), name: 'Ana Maria' },
  { id: id(2), name: 'Bo' },
  { id: id(3), name: 'Søren' },
]
const guests = [...players, { id: id(4), name: 'Zelda' }]

describe('sitOutNames', () => {
  it("reads a guest's id as their name, drops an id on no list, and keeps typed names once each", () => {
    expect(sitOutNames([id(4), id(2), ' quentin ', 'Quentin', id(9)], guests, players)).toEqual(['Zelda', 'Bo', 'quentin'])
  })
})

describe('sittingOut', () => {
  it('matches the guests here by name, whatever the case, accents or spaces', () => {
    expect([...sittingOut(['anamaria', 'SOREN', 'Quentin'], players)].sort()).toEqual([id(1), id(3)].sort())
  })

  it('still sits out the player an old id names', () => {
    expect([...sittingOut([id(2)], players)]).toEqual([id(2)])
    expect(sittingOut([id(4)], players).size).toBe(0)
  })
})

describe('sameNames', () => {
  it('compares two lists by name, whatever their order and spelling', () => {
    expect(sameNames(['Bo', 'Ana Maria'], ['anamaria', ' bo'])).toBe(true)
    expect(sameNames(['Bo'], ['Bo', 'Zelda'])).toBe(false)
  })
})
