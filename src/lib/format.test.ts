import { describe, expect, it } from 'vitest'
import { foldName, formatPoints, withRanks } from '@/lib/format'

describe('foldName', () => {
  it('folds accents and Nordic letters for search', () => {
    expect(foldName('Søren')).toBe('soren')
    expect(foldName('Åse')).toBe('ase')
    expect(foldName('Æble Ørn')).toBe('aeble orn')
    expect(foldName('  José ')).toBe('jose')
  })

  it('finds names stored as typed: full-width and math letters match plain ones', () => {
    expect(foldName('Ｌｕｋａ')).toBe('luka')
    expect(foldName('\u{1d400}\u{1d427}\u{1d41a}')).toBe('ana')
    expect(foldName('Bo™').includes(foldName('bo'))).toBe(true)
  })
})

describe('formatPoints and withRanks', () => {
  it('signs gains and shares ranks on ties', () => {
    expect(formatPoints(3)).toBe('+3')
    expect(formatPoints(0)).toBe('0')
    expect(formatPoints(-2)).toBe('-2')
    expect(withRanks([{ points: 9 }, { points: 5 }, { points: 5 }, { points: 1 }]).map((r) => r.rank)).toEqual([1, 2, 2, 4])
  })
})
