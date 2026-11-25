import { describe, expect, it } from 'vitest'
import { mainCardNews, sheetGivesWay } from './running'

describe("the main card's news", () => {
  it('is a new game on the main card or a new question on it', () => {
    expect(mainCardNews({ gameId: 'q', questionKey: 'q2' }, { gameId: 'q', questionKey: 'q3' })).toBe(true)
    expect(mainCardNews({ gameId: null, questionKey: null }, { gameId: 'q', questionKey: null })).toBe(true)
    expect(mainCardNews({ gameId: 'q', questionKey: 'q3' }, { gameId: 'q', questionKey: 'q3' })).toBe(false)
    // A question closing, or the card emptying, is not news.
    expect(mainCardNews({ gameId: 'q', questionKey: 'q3' }, { gameId: 'q', questionKey: null })).toBe(false)
    expect(mainCardNews({ gameId: 'q', questionKey: null }, { gameId: null, questionKey: null })).toBe(false)
  })
})

describe('a sheet left open', () => {
  const base = { news: true, covered: true, timed: true, scanning: false }

  it("gives way to a new timed question, so a guest who left the hunt's sheet open after a scan still answers the quiz", () => {
    expect(sheetGivesWay(base)).toBe(true)
  })

  it('stays for anything else: no news, no sheet, a question without a clock, or a scan still being handled', () => {
    expect(sheetGivesWay({ ...base, news: false })).toBe(false)
    expect(sheetGivesWay({ ...base, covered: false })).toBe(false)
    expect(sheetGivesWay({ ...base, timed: false })).toBe(false)
    expect(sheetGivesWay({ ...base, scanning: true })).toBe(false)
  })
})
