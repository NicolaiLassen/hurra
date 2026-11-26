import { describe, expect, it } from 'vitest'
import { aheadLine, commentary, hasLeader, saidText, wonLine } from '@/components/tv/boardLines'
import { clockTime } from '@/components/tv/clock'
import type { SessionGame } from '@/lib/types'

const AT = Date.UTC(2026, 10, 28, 20, 40)

function game(id: string, patch: Partial<SessionGame> = {}): SessionGame {
  return {
    id,
    game_type: 'in-person',
    title: id,
    position: 0,
    status: 'finished',
    public_state: null,
    started_at: AT - 1_500_000,
    finished_at: AT,
    finished_by: 'host',
    winners: [],
    wake_at: null,
    archived_at: null,
    created_at: AT - 9_000_000,
    ...patch,
  }
}

const rows = [
  { player_id: 'bo', name: 'Bo', points: 14 },
  { player_id: 'ana', name: 'Ana', points: 12 },
  { player_id: 'clara', name: 'Clara', points: 11 },
  { player_id: 'luna', name: 'Luna', points: 9 },
]

describe('wonLine', () => {
  it('names the newest game the guest won, at its finish time', () => {
    const games = [
      game('Quiz', { winners: ['bo'], finished_at: AT - 3_600_000 }),
      game('Beer pong', { winners: ['bo', 'ana'] }),
      game('Darts', { winners: ['ana'], finished_at: AT + 60_000 }),
    ]
    expect(wonLine('bo', games)).toBe(`Won Beer pong at ${clockTime(AT)}`)
    expect(wonLine('bo', games, true)).toBe(`won Beer pong at ${clockTime(AT)}`)
  })

  it('says nothing for a guest who won nothing, or a game that was archived or is still on', () => {
    expect(wonLine('bo', [game('Beer pong', { winners: ['bo'], archived_at: AT }), game('Quiz', { status: 'active', finished_at: null, winners: ['bo'] })])).toBeNull()
  })
})

describe('aheadLine', () => {
  it('gives the lead over the next place', () => {
    expect(aheadLine(rows)).toBe('2 ahead of Ana')
    expect(aheadLine([rows[0], { ...rows[1], points: 9 }, { ...rows[2], points: 9 }])).toBe('5 ahead of Ana and Clara')
  })

  it('says who shares first', () => {
    expect(aheadLine([rows[0], { ...rows[1], points: 14 }, rows[2]])).toBe('Level with Ana')
  })

  it('says when nobody has scored yet', () => {
    expect(aheadLine(rows.map((row) => ({ ...row, points: 0 })))).toBe('Nobody has scored yet')
  })

  it('says nothing for a party of one', () => {
    expect(aheadLine([rows[0]])).toBeNull()
  })
})

describe('commentary', () => {
  it('names the two who climbed most', () => {
    const said = commentary({ title: 'Beer pong' }, { luna: 4, clara: 3, bo: 1, ana: -2 }, { luna: 6, clara: 5 }, rows)
    expect(saidText(said!)).toBe('Beer pong moved Luna up 4 places and Clara up 3.')
    expect(said).toContainEqual({ name: 'Luna' })
  })

  it('counts one place as one', () => {
    expect(saidText(commentary({ title: 'Quiz' }, { clara: 1 }, { clara: 2 }, rows)!)).toBe('Quiz moved Clara up 1 place.')
  })

  it('says who scored when nobody changed place, and nothing when nobody scored', () => {
    expect(saidText(commentary({ title: 'Darts' }, {}, { bo: 3 }, rows)!)).toBe('Darts gave Bo 3 points.')
    expect(saidText(commentary({ title: 'Darts' }, {}, { bo: 1, ana: 1 }, rows)!)).toBe('Darts gave Bo and Ana 1 point each.')
    expect(commentary({ title: 'Darts' }, {}, {}, rows)).toBeNull()
  })
})

describe('hasLeader', () => {
  const row = (name: string, points: number) => ({ player_id: name.toLowerCase(), name, points })

  it('has no leader before anyone has scored, however many are level on 0', () => {
    expect(hasLeader([])).toBe(false)
    expect(hasLeader([row('Ana', 0)])).toBe(false)
    expect(hasLeader([row('Ana', 0), row('Bo', 0), row('Mads', 0)])).toBe(false)
  })

  it('has a leader once anyone has a point', () => {
    expect(hasLeader([row('Bo', 1), row('Ana', 0)])).toBe(true)
    expect(hasLeader([row('Ana', 3), row('Bo', 3)])).toBe(true)
  })
})
