import { describe, expect, it } from 'vitest'
import { guestsOf, listCounts, matchNames, nameInLine, namesFromText, sortNames, wasListed } from '@/lib/guestList'
import type { Player } from '@/lib/types'

const player = (id: string, name: string): Player => ({ id, name, code: 'ABCDE', profile: {}, created_at: 0 })

describe('namesFromText', () => {
  it('reads one name per line, trimmed, without blank lines or list marks, in order', () => {
    const text = ' Ana \r\n\n- Bo\n* Cy\n• Dee\n· Eve\n1. Fay\n12) Gus\n   \nMads Holm\n-Ina'
    expect(namesFromText(text)).toEqual({
      names: ['Ana', 'Bo', 'Cy', 'Dee', 'Eve', 'Fay', 'Gus', 'Mads Holm', '-Ina'],
      repeats: 0,
      repeated: [],
      over: 0,
      rest: [],
    })
  })

  it('counts repeats by the folded name, says which, and keeps them for the database to skip', () => {
    expect(namesFromText('Søren\nsoren\nANA\nana\nAna')).toEqual({
      names: ['Søren', 'soren', 'ANA', 'ana', 'Ana'],
      repeats: 3,
      repeated: [
        { name: 'Søren', lines: 2 },
        { name: 'ANA', lines: 3 },
      ],
      over: 0,
      rest: [],
    })
  })

  it('reads a Markdown table: the first cell of each row, no header row, no separator row, no notes in brackets', () => {
    const table = [
      '## Coming',
      '',
      '| Name | Note / plus one |',
      '|---|:---:|',
      '| Ana Holm (cousin) | |',
      '| Bo Lund | coming late |',
      '| Mads Kjær | |',
      '| | |',
    ].join('\n')
    expect(namesFromText(table).names).toEqual(['Ana Holm', 'Bo Lund', 'Mads Kjær'])
    // Without its header and separator rows (a few rows copied from the middle) it reads the same.
    expect(namesFromText('| Bo Lund | coming late |\n| Mads Kjær | |').names).toEqual(['Bo Lund', 'Mads Kjær'])
  })

  it('reads rows copied from a rendered table or a sheet: the first column, and no header line', () => {
    expect(namesFromText('Name\tNote\nAna Holm (cousin)\t\nBo Lund\tcoming late\nMads Kjær').names).toEqual([
      'Ana Holm',
      'Bo Lund',
      'Mads Kjær',
    ])
    // A first line that is only a header word, in English or Danish.
    expect(namesFromText('Navn\nAna\nBo').names).toEqual(['Ana', 'Bo'])
    expect(namesFromText('Gæster:\nAna').names).toEqual(['Ana'])
    // Only the first line can be a header: a guest called Name later on stays.
    expect(namesFromText('Ana\nName').names).toEqual(['Ana', 'Name'])
  })

  it('reads one line as a name: the first cell, no list mark, no note at the end; a name that is only a note stays', () => {
    expect(nameInLine('| 1. Ana | x |')).toBe('Ana')
    expect(nameInLine('Bo (Ana’s plus one)')).toBe('Bo')
    expect(nameInLine('(Ana)')).toBe('(Ana)')
    expect(nameInLine('Mads (Holm) Kjær')).toBe('Mads (Holm) Kjær')
    expect(nameInLine('---')).toBe('---')
  })

  it('takes at most 100 names and keeps the rest for another Add', () => {
    const lines = Array.from({ length: 130 }, (_, i) => `Guest ${i + 1}`).join('\n')
    const pasted = namesFromText(lines)
    expect(pasted.names).toHaveLength(100)
    expect(pasted.names.at(-1)).toBe('Guest 100')
    expect(pasted.over).toBe(30)
    expect(pasted.rest).toHaveLength(30)
    expect([pasted.rest[0], pasted.rest.at(-1)]).toEqual(['Guest 101', 'Guest 130'])
    expect(namesFromText('')).toEqual({ names: [], repeats: 0, repeated: [], over: 0, rest: [] })
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
    // Ana and Bo took listed names (joined after their rows were made), Zelda is still expected.
    expect(listCounts({ players, guests })).toEqual({ here: 2, expected: 1, total: 3, listed: 3 })
  })

  it('tells a listed name from one the guest typed: typed joins joined the moment their row was made', () => {
    expect(wasListed({ joined_at: null, created_at: 3 })).toBe(true)
    expect(wasListed({ joined_at: 9, created_at: 3 })).toBe(true)
    expect(wasListed({ joined_at: 3, created_at: 3 })).toBe(false)
    const typed = [
      { id: 'a', name: 'Ana', joined_at: 1, created_at: 1 },
      { id: 'b', name: 'Bo', joined_at: 2, created_at: 2 },
    ]
    expect(listCounts({ players, guests: typed })).toEqual({ here: 2, expected: 0, total: 2, listed: 0 })
  })

  it('falls back to the players as joined guests when the snapshot has no list (a phone, a TV, an older database)', () => {
    expect(guestsOf({ players, guests: null })).toEqual([
      { id: 'a', name: 'Ana', joined: true },
      { id: 'b', name: 'Bo', joined: true },
    ])
    expect(listCounts({ players })).toEqual({ here: 2, expected: 0, total: 2, listed: 0 })
  })
})
