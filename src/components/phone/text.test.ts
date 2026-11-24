import { describe, expect, it } from 'vitest'
import { cleanClaimCode, couldBeClaimCode, finishedLine, nameIn, ordinal, placeOf, pointsText, winnersText } from './text'

const players = [
  { id: 'a', name: 'Ana' },
  { id: 'b', name: 'Bo' },
  { id: 'c', name: 'Cy' },
  { id: 'd', name: 'Di' },
  { id: 'e', name: 'Ed' },
  { id: 'me', name: 'Sofie' },
]

describe('who won', () => {
  it('names the winners, with "You" first when this phone won', () => {
    expect(finishedLine({ title: 'Quiz', winners: ['a'] }, players, 'me')).toBe('Ana won Quiz')
    expect(finishedLine({ title: 'Quiz', winners: ['me'] }, players, 'me')).toBe('You won Quiz')
    expect(finishedLine({ title: 'Quiz', winners: ['a', 'me'] }, players, 'me')).toBe('You and Ana won Quiz')
    expect(winnersText(['a', 'b', 'c', 'd', 'e'], players, 'me')).toBe('Ana, Bo, Cy and 2 more')
  })

  it('says the game is over when nobody won', () => {
    expect(finishedLine({ title: 'Beer pong', winners: [] }, players, 'me')).toBe('Beer pong is over')
    expect(winnersText([], players, 'me')).toBeNull()
  })

  it('names someone who left the party "A guest"', () => {
    expect(nameIn(players, 'gone')).toBe('A guest')
    expect(finishedLine({ title: 'Quiz', winners: ['gone'] }, players, 'me')).toBe('A guest won Quiz')
  })
})

describe('pointsText', () => {
  it('reads like people talk', () => {
    expect(pointsText(1)).toBe('1 point')
    expect(pointsText(0)).toBe('0 points')
    expect(pointsText(-1)).toBe('-1 point')
    expect(pointsText(7)).toBe('7 points')
  })
})

describe('your place tonight', () => {
  const row = (player_id: string, name: string, points: number) => ({ player_id, name, points })
  const night = [
    row('ana', 'Ana', 12),
    row('felix', 'Felix', 9),
    row('luna', 'Luna', 9),
    row('me', 'Sofie', 8),
    row('bo', 'Bo', 8),
    row('cy', 'Cy', 2),
  ]

  it('says your place, your points and who is next above you, ties in words', () => {
    // Two guests tied just above: "1 behind Felix and Luna".
    expect(placeOf(night.filter((r) => r.player_id !== 'bo'), 'me')).toEqual({ rank: 4, points: 8, line: '1 behind Felix and Luna' })
  })

  it('names who you are level with, then who is next above', () => {
    // Level with Bo, both after the three above: competition ranks, so both are 4th.
    expect(placeOf(night, 'me')).toEqual({ rank: 4, points: 8, line: 'Level with Bo, 1 behind Felix and Luna' })
    expect(placeOf(night, 'bo')?.rank).toBe(4)
    expect(placeOf(night, 'felix')).toEqual({ rank: 2, points: 9, line: 'Level with Luna, 3 behind Ana' })
  })

  it('at the top: alone ahead of the next ones, or level with them', () => {
    expect(placeOf(night, 'ana')).toEqual({ rank: 1, points: 12, line: '3 ahead of Felix and Luna' })
    const tiedTop = [row('ana', 'Ana', 5), row('me', 'Sofie', 5), row('bo', 'Bo', 5), row('cy', 'Cy', 1)]
    expect(placeOf(tiedTop, 'me')).toEqual({ rank: 1, points: 5, line: 'Level with Ana and Bo at the top' })
  })

  it('shortens a long tie, and says so before anyone has scored', () => {
    const crowd = ['Ana', 'Bo', 'Cy', 'Di', 'Ed'].map((name) => row(name.toLowerCase(), name, 3))
    expect(placeOf([...crowd, row('me', 'Sofie', 3), row('top', 'Mads', 6)], 'me')?.line).toBe('Level with Ana, Bo, Cy and 2 more, 3 behind Mads')
    expect(placeOf([row('me', 'Sofie', 0), row('bo', 'Bo', 0)], 'me')).toEqual({ rank: null, points: 0, line: 'Nobody has scored yet' })
    expect(placeOf([row('me', 'Sofie', 2)], 'me')).toEqual({ rank: 1, points: 2, line: 'Nobody else here yet' })
    expect(placeOf(night, 'gone')).toBeNull()
  })

  it('reads places as people say them', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th',
    ])
  })
})

describe('codes from the host', () => {
  it('cleans what a guest types: capitals and digits, at most 6', () => {
    expect(cleanClaimCode(' ab-cd ef9 ')).toBe('ABCDEF')
    expect(cleanClaimCode('k7m2p9')).toBe('K7M2P9')
    expect(cleanClaimCode('')).toBe('')
  })

  it('tells a party code that could be a host code: 6 characters, no I, O, 0 or 1', () => {
    expect(couldBeClaimCode('K7M2P9')).toBe(true)
    expect(couldBeClaimCode('HURRA30')).toBe(false)
    expect(couldBeClaimCode('K7M2PO')).toBe(false)
    expect(couldBeClaimCode('K7M2P1')).toBe(false)
    expect(couldBeClaimCode('K7M2P')).toBe(false)
  })
})
