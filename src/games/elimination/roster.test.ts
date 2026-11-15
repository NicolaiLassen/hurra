import { describe, expect, it } from 'vitest'
import { listNames, type EliminationPublicState } from '@/games/elimination/logic'
import { knockoutLine, nameFrom, roundRoster, timeAgo, topHunters } from '@/games/elimination/roster'
import type { Player } from '@/lib/types'

const player = (id: string): Player => ({ id, name: id.toUpperCase(), code: id.toUpperCase(), profile: {}, created_at: 0 })

const publicState: EliminationPublicState = {
  alive: ['ana', 'cy', 'gone'],
  out: ['bo', 'dee'],
  winner: null,
  outBy: {},
  knockoutCounts: { cy: 1, gone: 3, ana: 2 },
  feed: [],
}

describe('what every screen counts', () => {
  it('counts only players still in the party, standing in deal order, then out', () => {
    // "gone" left the party since the game last saved; "late" joined after the deal.
    const players = ['bo', 'cy', 'ana', 'late', 'dee'].map(player)
    const roster = roundRoster(players, publicState)
    expect(roster.standing.map((p) => p.id)).toEqual(['ana', 'cy'])
    expect(roster.out.map((p) => p.id)).toEqual(['bo', 'dee'])
    expect(roster.total).toBe(4)
  })

  it('ranks the top hunters still in the party', () => {
    const players = ['ana', 'bo', 'cy'].map(player)
    expect(topHunters(publicState, players)).toEqual([
      ['ana', 2],
      ['cy', 1],
    ])
    expect(topHunters(publicState, players, 1)).toEqual([['ana', 2]])
  })

  it('names players, and someone who left', () => {
    const nameOf = nameFrom([player('ana')])
    expect(nameOf('ana')).toBe('ANA')
    expect(nameOf('gone')).toBe('Someone')
  })

  it('tells a knockout in words', () => {
    const nameOf = nameFrom([player('ana'), player('bo')])
    expect(knockoutLine({ by: 'bo', target: 'ana', method: 'tag', task: null, at: 0 }, nameOf)).toBe('BO got ANA')
    expect(knockoutLine({ by: 'bo', target: 'ana', method: 'catch', task: 'sing', at: 0 }, nameOf)).toBe('BO caught ANA')
    expect(knockoutLine({ by: 'gone', target: 'ana', method: 'tag', task: null, at: 0 }, nameOf)).toBe('Someone got ANA')
  })

  it('says how long ago something happened', () => {
    const now = 10 * 3_600_000
    expect(timeAgo(now, now)).toBe('just now')
    expect(timeAgo(now + 5_000, now)).toBe('just now') // a clock a little behind
    expect(timeAgo(now - 59_000, now)).toBe('just now')
    expect(timeAgo(now - 60_000, now)).toBe('1 min ago')
    expect(timeAgo(now - 59 * 60_000, now)).toBe('59 min ago')
    expect(timeAgo(now - 2 * 3_600_000, now)).toBe('2 h ago')
  })

  it('lists names the way a sentence does', () => {
    expect(listNames([])).toBe('')
    expect(listNames(['Ana'])).toBe('Ana')
    expect(listNames(['Ana', 'Bo'])).toBe('Ana and Bo')
    expect(listNames(['Ana', 'Bo', 'Cy'])).toBe('Ana, Bo and Cy')
    expect(listNames(['Ana', 'Bo', 'Cy', 'Dee', 'Eve'])).toBe('Ana, Bo, Cy and 2 more')
  })
})
