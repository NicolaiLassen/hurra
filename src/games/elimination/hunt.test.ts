// Last one standing's words on a guest's phone: where you stand, how many are
// left, and the latest knockout at the time the game saved it, as a clock time.
import { describe, expect, it } from 'vitest'
import { clockTime } from '@/components/phone/text'
import { huntHeading, huntLine } from '@/games/elimination/hunt'
import type { EliminationPublicState } from '@/games/elimination/logic'
import type { Player } from '@/lib/types'

const players: Player[] = ['Ana', 'Bo', 'Clara', 'Frida'].map((name) => ({ id: name.toLowerCase(), name, code: name, profile: {}, created_at: 0 }))
const AT = Date.UTC(2026, 10, 28, 21, 41)
const EARLIER = AT - 20 * 60_000
const live: EliminationPublicState = {
  alive: ['ana', 'bo'],
  out: ['frida', 'clara'],
  winner: null,
  outBy: { frida: { by: 'clara', method: 'tag' }, clara: { by: 'bo', method: 'catch' } },
  knockoutCounts: { clara: 1, bo: 1 },
  // Newest first.
  feed: [
    { by: 'bo', target: 'clara', method: 'catch', task: null, at: AT },
    { by: 'clara', target: 'frida', method: 'tag', task: 'Get someone to hum a tune', at: EARLIER },
  ],
}

describe("the hunt's section on a phone", () => {
  it('says where you stand', () => {
    expect(huntHeading({ status: 'alive', task: 'x', knockouts: 0 }, live)).toBe("You're still in.")
    expect(huntHeading({ status: 'out', by: 'bo', method: 'catch', task: 'x', knockouts: 0 }, live)).toBe("You're out.")
    expect(huntHeading({ status: 'winner', knockouts: 3 }, live)).toBe("You're the last one standing.")
    expect(huntHeading(undefined, live)).toBe('Dealing tasks…')
    expect(huntHeading(null, live)).toBe('You watch this round.')
  })

  it('counts who is left and names the latest knockout at its clock time, never "min ago"', () => {
    const line = huntLine(players, live, { status: 'alive', task: 'x', knockouts: 0 }, 'ana')
    expect(line).toBe(`2 of 4 left. Bo caught Clara at ${clockTime(AT)}.`)
    expect(line).toMatch(/at \d\d:\d\d\.$/)
    expect(line).not.toMatch(/ago|just now/)
  })

  it('says nobody is out before the first knockout', () => {
    const fresh: EliminationPublicState = { ...live, alive: ['ana', 'bo', 'clara', 'frida'], out: [], outBy: {}, knockoutCounts: {}, feed: [] }
    expect(huntLine(players, fresh, { status: 'alive', task: 'x', knockouts: 0 }, 'ana')).toBe('4 of 4 left. Nobody is out yet.')
  })

  it("tells a guest who is out who got them, and when", () => {
    expect(huntLine(players, live, { status: 'out', by: 'clara', method: 'tag', task: 'x', knockouts: 0 }, 'frida')).toBe(
      `Clara got you at ${clockTime(EARLIER)}. 2 of 4 left.`,
    )
    const over = { ...live, alive: ['bo'], out: ['frida', 'clara', 'ana'], winner: 'bo' }
    expect(huntLine(players, over, { status: 'out', by: 'bo', method: 'catch', task: 'x', knockouts: 0 }, 'clara')).toBe(
      `Bo caught you at ${clockTime(AT)}. Bo won.`,
    )
  })

  it('names the winner once the round is won, and says nothing without a state', () => {
    expect(huntLine(players, { ...live, alive: ['bo'], winner: 'bo' }, null, 'ana')).toBe('Bo won.')
    expect(huntLine(players, null, undefined, 'ana')).toBeNull()
  })
})
