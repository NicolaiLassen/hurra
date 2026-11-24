// The SDK's knockedOut hook (GameModule.knockedOut): a game says who it has
// knocked out, and the core marks them Out wherever it lists the party,
// through knockedOutIds, without naming any game.
import { describe, expect, it } from 'vitest'
import { elimination } from '@/games/elimination'
import { gameModules, knockedOutIds } from '@/games/registry'
import type { GameModule } from '@/games/types'
import type { SessionGame } from '@/lib/types'

const game = (patch: Partial<SessionGame>): SessionGame => ({
  id: 'g1',
  game_type: 'elimination',
  title: 'Last one standing',
  position: 0,
  status: 'active',
  public_state: null,
  started_at: 1,
  finished_at: null,
  finished_by: null,
  winners: [],
  wake_at: null,
  archived_at: null,
  created_at: 0,
  ...patch,
})

const hunt = { alive: ['ana', 'bo'], out: ['clara', 'dee'], winner: null, outBy: {}, knockoutCounts: {}, feed: [] }

describe('knockedOut', () => {
  it("is Last one standing's knocked-out guests, read from its public state", () => {
    expect(elimination.knockedOut?.(hunt)).toEqual(['clara', 'dee'])
    // A state from an older bundle, or none yet: nobody.
    expect(elimination.knockedOut?.(null as never)).toEqual([])
    expect(elimination.knockedOut?.({ ...hunt, out: 'clara' } as never)).toEqual([])
    expect(elimination.knockedOut?.({ ...hunt, out: ['clara', 7] } as never)).toEqual(['clara'])
  })

  it('is left out by the games that knock nobody out', () => {
    expect(gameModules.filter((m) => m.knockedOut).map((m) => m.logic.type)).toEqual(['elimination'])
  })

  it('marks the guests the live games knocked out', () => {
    expect([...knockedOutIds([game({ public_state: hunt })])]).toEqual(['clara', 'dee'])
  })

  it('marks nobody for a round that is over, archived or not started', () => {
    expect(knockedOutIds([game({ public_state: hunt, status: 'finished' })]).size).toBe(0)
    expect(knockedOutIds([game({ public_state: hunt, archived_at: 5 })]).size).toBe(0)
    expect(knockedOutIds([game({ public_state: hunt, status: 'pending' })]).size).toBe(0)
  })

  it("never lets a hook that throws take the list down", () => {
    const broken = { ...elimination, logic: { ...elimination.logic, type: 'broken' }, knockedOut: () => { throw new Error('old state') } } as unknown as GameModule
    const out = knockedOutIds([game({ id: 'g2', game_type: 'broken', public_state: {} }), game({ public_state: hunt })], [broken, elimination])
    expect([...out]).toEqual(['clara', 'dee'])
  })

  it('ignores games this build does not know', () => {
    expect(knockedOutIds([game({ game_type: 'bingo', public_state: hunt })]).size).toBe(0)
  })
})
