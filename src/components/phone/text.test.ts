import { describe, expect, it } from 'vitest'
import { cleanClaimCode, couldBeClaimCode, finishedLine, nameIn, pointsText, timeAgo, winnersText } from './text'

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

describe('timeAgo and pointsText', () => {
  it('reads like people talk', () => {
    expect(timeAgo(20_000)).toBe('just now')
    expect(timeAgo(60_000)).toBe('1 min ago')
    expect(timeAgo(12 * 60_000 + 59_000)).toBe('12 min ago')
    expect(timeAgo(125 * 60_000)).toBe('2 h ago')
    expect(pointsText(1)).toBe('1 point')
    expect(pointsText(0)).toBe('0 points')
    expect(pointsText(-1)).toBe('-1 point')
    expect(pointsText(7)).toBe('7 points')
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
