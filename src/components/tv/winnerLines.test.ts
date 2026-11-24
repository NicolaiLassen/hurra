import { describe, expect, it } from 'vitest'
import { saidText } from '@/components/tv/boardLines'
import { cheer, firstName, lastOneDeck, nightLine, nightRanks, wonDeck } from '@/components/tv/winnerLines'

const scores = [
  { player_id: 'ana', name: 'Ana', points: 27 },
  { player_id: 'bo', name: 'Bo', points: 31 },
  { player_id: 'clara', name: 'Clara', points: 22 },
  { player_id: 'dee', name: 'Dee', points: 22 },
]

describe('cheer', () => {
  it('cheers the winners by first name, with the one exclamation mark', () => {
    expect(cheer(['Bo'])).toBe('Hurra for Bo!')
    expect(cheer(['Marie-Louise Christensen', 'Bo'])).toBe('Hurra for Marie-Louise and Bo!')
    expect(firstName('  Christoffer Bjørnskov ')).toBe('Christoffer')
  })
})

describe('nightRanks', () => {
  it('ranks the night highest first, ties sharing a place', () => {
    expect(nightRanks(scores).map((row) => `${row.rank} ${row.name}`)).toEqual(['1 Bo', '2 Ana', '3 Clara', '3 Dee'])
  })
})

describe('nightLine', () => {
  const line = (winners: string[], points: Record<string, number>, rows = scores) => saidText(nightLine('Last one standing', winners, rows, points))

  it("gives the winner's points and lead", () => {
    expect(line(['bo'], { bo: 10 })).toBe('Last one standing gave Bo 10 points and a 4 point lead over Ana.')
    expect(nightLine('Last one standing', ['bo'], scores, { bo: 10 })).toContainEqual({ name: 'Ana' })
  })

  it('says who shares first', () => {
    const level = scores.map((row) => (row.player_id === 'ana' ? { ...row, points: 31 } : row))
    expect(line(['bo'], { bo: 1 }, level)).toBe('Last one standing gave Bo 1 point and a share of first with Ana.')
  })

  it("gives a winner further down the night's place", () => {
    expect(line(['clara'], { clara: 5 })).toBe('Last one standing gave Clara 5 points. Clara is 3rd for the night.')
    expect(line(['ana'], {})).toBe('Ana is 2nd for the night.')
  })

  it('names several winners', () => {
    expect(line(['clara', 'dee'], { clara: 2, dee: 2 })).toBe('Last one standing gave Clara and Dee 2 points each.')
    expect(line(['clara', 'dee'], { clara: 2 })).toBe('Last one standing went to Clara and Dee.')
  })

  it('says nothing for winners who have left the party', () => {
    expect(nightLine('Quiz', ['gone'], scores, {})).toEqual([])
  })
})

describe('the decks', () => {
  it('say what the winner won with', () => {
    expect(wonDeck('Beer pong', ['freja'], { freja: 7 })).toBe('Won Beer pong with 7 points.')
    expect(wonDeck('Beer pong', ['freja'], {})).toBe('Won Beer pong.')
    expect(wonDeck('Beer pong', ['freja', 'noah'], { freja: 7 })).toBe('Won Beer pong together.')
    expect(lastOneDeck(7)).toBe('The last one in, with 7 knockouts.')
    expect(lastOneDeck(1)).toBe('The last one in, with 1 knockout.')
    expect(lastOneDeck(0)).toBe('The last one in.')
  })
})
