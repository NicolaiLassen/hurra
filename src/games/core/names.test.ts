import { describe, expect, it } from 'vitest'
import { cleanName, looksLikeId, nameFromSetting, nameKey, sameName, uniqueNames } from './names'

describe('nameKey', () => {
  it('folds case, accents, Nordic letters and every space', () => {
    expect(nameKey('Ana Maria')).toBe('anamaria')
    expect(nameKey('  ana   MARÍA ')).toBe('anamaria')
    expect(nameKey('Søren')).toBe('soren')
    expect(nameKey('Åse')).toBe('ase')
    expect(nameKey('Æbbe')).toBe('aebbe')
    expect(nameKey('Ｌｕｋａ')).toBe('luka')
  })

  it('keeps a hyphen, so Anne-Marie and Anne Marie stay two spellings', () => {
    expect(nameKey('Anne-Marie')).toBe('anne-marie')
    expect(sameName('Anne-Marie', 'Anne Marie')).toBe(false)
  })
})

describe('sameName', () => {
  it('matches by the folded key and never matches an empty name', () => {
    expect(sameName('Mads', ' mads ')).toBe(true)
    expect(sameName('Mads', 'Mads Holm')).toBe(false)
    expect(sameName('', '')).toBe(false)
    expect(sameName('   ', '')).toBe(false)
  })
})

describe('cleanName', () => {
  it('trims and keeps one space between words', () => {
    expect(cleanName('  Ana   Maria ')).toBe('Ana Maria')
  })
})

describe('nameFromSetting', () => {
  const id = (n: number) => `f1c7a000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const guests = [
    { id: id(1), name: 'Zelda' },
    { id: id(2), name: 'Bo' },
  ]
  const players = [{ id: id(3), name: 'Ana  Maria' }]

  it("turns a saved guest's id into their name, from the guest list or the players", () => {
    expect(nameFromSetting(id(1), guests, players)).toBe('Zelda')
    expect(nameFromSetting(id(3), guests, players)).toBe('Ana Maria')
  })

  it('keeps a typed name, cleaned', () => {
    expect(nameFromSetting(' Quentin ', guests, players)).toBe('Quentin')
  })

  it('gives null for an id on neither list', () => {
    expect(looksLikeId(id(9))).toBe(true)
    expect(nameFromSetting(id(9), guests, players)).toBeNull()
  })
})

describe('uniqueNames', () => {
  it('keeps the first spelling of each name and drops empty ones', () => {
    expect(uniqueNames(['Ana', 'bo', ' ana ', 'Bo', '', 'Søren', 'soren'])).toEqual(['Ana', 'bo', 'Søren'])
  })
})
