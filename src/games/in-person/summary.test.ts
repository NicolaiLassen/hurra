import { describe, expect, it } from 'vitest'
import { finishedLeaders, nameList, pointsLabel, pointsOf, runningFor, scorers, topScorers } from './summary'

const ana = { id: 'ana', name: 'Ana' }
const bo = { id: 'bo', name: 'Bo' }
const cy = { id: 'cy', name: 'Cy' }
const players = [ana, bo, cy]

describe('pointsOf', () => {
  it("reads a player's points, and 0 for anything else", () => {
    expect(pointsOf({ ana: 3 }, 'ana')).toBe(3)
    expect(pointsOf({ ana: -2 }, 'ana')).toBe(-2)
    expect(pointsOf({}, 'ana')).toBe(0)
    // Inherited keys are never points.
    expect(pointsOf({}, 'toString')).toBe(0)
    expect(pointsOf({}, '__proto__')).toBe(0)
    expect(pointsOf({ ana: Number.NaN }, 'ana')).toBe(0)
  })
})

describe('topScorers', () => {
  it('finds the top, all tied ones, in the order of the players', () => {
    expect(topScorers({ bo: 5, ana: 2 }, players)).toEqual({ players: [bo], points: 5 })
    expect(topScorers({ cy: 4, ana: 4, bo: 1 }, players)).toEqual({ players: [ana, cy], points: 4 })
  })

  it('finds nobody when nobody has more than 0', () => {
    expect(topScorers({}, players)).toBeNull()
    expect(topScorers({ ana: 0, bo: -1 }, players)).toBeNull()
    expect(topScorers({ ana: 3 }, [])).toBeNull()
  })

  it('only counts the players it is given', () => {
    expect(topScorers({ gone: 9, ana: 1 }, players)).toEqual({ players: [ana], points: 1 })
  })
})

describe('finishedLeaders', () => {
  it('names the crowned winners, with their points', () => {
    expect(finishedLeaders(['bo'], { bo: 5, ana: 2 }, players)).toEqual({ players: [bo], points: 5 })
    expect(finishedLeaders(['cy', 'ana'], { ana: 4, cy: 4 }, players)).toEqual({ players: [ana, cy], points: 4 })
  })

  it('keeps the crowned result when points come in after the end', () => {
    expect(finishedLeaders(['bo'], { bo: 5, cy: 8 }, players)).toEqual({ players: [bo], points: 5 })
  })

  it('falls back to the points as they stand when no crowned winner is left with points', () => {
    // The winner left the party.
    expect(finishedLeaders(['gone'], { ana: 2, bo: 3 }, players)).toEqual({ players: [bo], points: 3 })
    // The host took the winner's points back after the end.
    expect(finishedLeaders(['ana'], { ana: 0, cy: 1 }, players)).toEqual({ players: [cy], points: 1 })
    // Nobody was crowned and nobody scored.
    expect(finishedLeaders([], {}, players)).toBeNull()
  })

  it('drops a crowned player who no longer tops the crowned ones', () => {
    expect(finishedLeaders(['ana', 'bo'], { ana: 4, bo: 1 }, players)).toEqual({ players: [ana], points: 4 })
  })
})

describe('scorers', () => {
  it('lists everyone with points, most first, ties in player order', () => {
    expect(scorers({ cy: 2, ana: 2, bo: 5 }, players)).toEqual([
      { ...bo, points: 5 },
      { ...ana, points: 2 },
      { ...cy, points: 2 },
    ])
    expect(scorers({ ana: 0, bo: -1 }, players)).toEqual([{ ...bo, points: -1 }])
  })
})

describe('words', () => {
  it('lists names the way a sentence does', () => {
    expect(nameList([])).toBe('')
    expect(nameList(['Ana'])).toBe('Ana')
    expect(nameList(['Ana', 'Bo'])).toBe('Ana and Bo')
    expect(nameList(['Ana', 'Bo', 'Cy'])).toBe('Ana, Bo and Cy')
    expect(nameList(['Ana', 'Bo', 'Cy', 'Dee', 'Eve'])).toBe('Ana, Bo, Cy and 2 more')
    expect(nameList(['Ana', 'Bo', 'Cy'], 2)).toBe('Ana, Bo and 1 more')
  })

  it('counts points in words', () => {
    expect(pointsLabel(1)).toBe('1 point')
    expect(pointsLabel(7)).toBe('7 points')
    expect(pointsLabel(-1)).toBe('-1 point')
    expect(pointsLabel(0)).toBe('0 points')
  })

  it('says how long a round has run', () => {
    expect(runningFor(-5_000)).toBe('Just started')
    expect(runningFor(59_999)).toBe('Just started')
    expect(runningFor(60_000)).toBe('1 min')
    expect(runningFor(59 * 60_000)).toBe('59 min')
    expect(runningFor(60 * 60_000)).toBe('1 h')
    expect(runningFor(65 * 60_000)).toBe('1 h 5 min')
  })
})
