import { describe, expect, it } from 'vitest'
import { guestsOf, listCounts, matchNames, namesFromText, sortNames } from '@/lib/guestList'
import type { Player } from '@/lib/types'

const player = (id: string, name: string): Player => ({ id, name, code: 'ABCDE', profile: {}, created_at: 0 })

describe('namesFromText', () => {
  it('reads one name per line, trimmed, without blank lines or list marks, in order', () => {
    const text = ' Ana \r\n\n- Bo\n* Cy\n• Dee\n· Eve\n1. Fay\n12) Gus\n   \nMads Holm\n-Ina'
    expect(namesFromText(text)).toEqual({
      names: ['Ana', 'Bo', 'Cy', 'Dee', 'Eve', 'Fay', 'Gus', 'Mads Holm', '-Ina'],
      repeats: 0,
      over: 0,
      rest: [],
    })
  })

  it('counts repeats by the folded name and keeps them for the database to skip', () => {
    expect(namesFromText('Søren\nsoren\nANA\nana\nAna')).toEqual({ names: ['Søren', 'soren', 'ANA', 'ana', 'Ana'], repeats: 3, over: 0, rest: [] })
  })

  it('takes at most 100 names and keeps the rest for another Add', () => {
    const lines = Array.from({ length: 130 }, (_, i) => `Guest ${i + 1}`).join('\n')
    const pasted = namesFromText(lines)
    expect(pasted.names).toHaveLength(100)
    expect(pasted.names.at(-1)).toBe('Guest 100')
    expect(pasted.over).toBe(30)
    expect(pasted.rest).toHaveLength(30)
    expect([pasted.rest[0], pasted.rest.at(-1)]).toEqual(['Guest 101', 'Guest 130'])
    expect(namesFromText('')).toEqual({ names: [], repeats: 0, over: 0, rest: [] })
  })
})

describe('sortNames and matchNames', () => {
  it('sorts the Danish way: case aside, and Æ, Ø and Å after Z', () => {
    expect(sortNames(['Åse', 'Zelda', 'ana', 'Ørn', 'Bo', 'Æbbe'])).toEqual(['ana', 'Bo', 'Zelda', 'Æbbe', 'Ørn', 'Åse'])
    expect(sortNames([{ name: 'Bo' }, { name: 'Ana' }]).map((g) => g.name)).toEqual(['Ana', 'Bo'])
  })

  it('finds names as the Players search does: folded, anywhere in the name', () => {
    const names = ['Søren', 'Ana', 'Mads Holm', 'Åse']
    expect(matchNames(names, 'soren')).toEqual(['Søren'])
    expect(matchNames(names, ' HOLM ')).toEqual(['Mads Holm'])
    expect(matchNames(names, 'ase')).toEqual(['Åse'])
    expect(matchNames(names, '')).toEqual(names)
    expect(matchNames(names, 'Zel')).toEqual([])
  })
})

describe('guestsOf and listCounts', () => {
  const players = [player('a', 'Ana'), player('b', 'Bo')]

  it('reads the host snapshot guest list, joined or still expected', () => {
    const guests = [
      { id: 'a', name: 'Ana', joined_at: 5, created_at: 1 },
      { id: 'b', name: 'Bo', joined_at: 6, created_at: 2 },
      { id: 'z', name: 'Zelda', joined_at: null, created_at: 3 },
    ]
    expect(guestsOf({ players, guests })).toEqual([
      { id: 'a', name: 'Ana', joined: true },
      { id: 'b', name: 'Bo', joined: true },
      { id: 'z', name: 'Zelda', joined: false },
    ])
    expect(listCounts({ players, guests })).toEqual({ here: 2, expected: 1, total: 3 })
  })

  it('falls back to the players as joined guests when the snapshot has no list (a phone, a TV, an older database)', () => {
    expect(guestsOf({ players, guests: null })).toEqual([
      { id: 'a', name: 'Ana', joined: true },
      { id: 'b', name: 'Bo', joined: true },
    ])
    expect(listCounts({ players })).toEqual({ here: 2, expected: 0, total: 2 })
  })
})
