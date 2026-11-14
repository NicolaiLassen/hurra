import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FusionPublicPicture } from '@/games/fusion/logic'
import {
  bestDisguise,
  candidatesFor,
  choiceOf,
  countsLine,
  firstTime,
  fitTiles,
  nameOf,
  outcomeOf,
  pickSignature,
  publicOf,
  revealPoints,
  takesVotes,
  togglePick,
  totalVotes,
} from '@/games/fusion/view'
import type { Player, PromptState } from '@/lib/types'

const player = (id: string, name = id): Player => ({ id, name, code: 'ABCDE', profile: {}, created_at: 0 })

const picture = (n: number, revealed: FusionPublicPicture['revealed'] = null): FusionPublicPicture => ({
  n,
  key: `p${n}`,
  label: `#${n}`,
  image: null,
  revealed,
})

const prompt = (key: string, closed = false): PromptState => ({
  game_id: 'g',
  key,
  spec: { kind: 'choice', options: 'players', min: 2, max: 2, exclude_self: true },
  opened_at: 0,
  closes_at: null,
  closed_at: closed ? 1 : null,
  revealed_at: null,
})

describe('votes', () => {
  it('reads a two-person vote and nothing else', () => {
    expect(choiceOf({ choice: ['a', 'b'] })).toEqual(['a', 'b'])
    expect(choiceOf({ choice: ['a'] })).toBeNull()
    expect(choiceOf({ value: 3 })).toBeNull()
    expect(choiceOf(undefined)).toBeNull()
  })

  it('compares picks whatever their order', () => {
    expect(pickSignature(['b', 'a'])).toBe(pickSignature(['a', 'b']))
    expect(pickSignature(null)).toBe('')
  })

  it('picks two at most, a third replacing the oldest', () => {
    expect(togglePick([], 'a')).toEqual(['a'])
    expect(togglePick(['a'], 'b')).toEqual(['a', 'b'])
    expect(togglePick(['a', 'b'], 'c')).toEqual(['b', 'c'])
    expect(togglePick(['a', 'b'], 'a')).toEqual(['b'])
  })

  it('knows which pictures still take votes', () => {
    expect(takesVotes('voting', picture(1), [prompt('p1')])).toBe(true)
    expect(takesVotes('voting', picture(1), [])).toBe(true)
    expect(takesVotes('voting', picture(1), [prompt('p1', true)])).toBe(false)
    expect(takesVotes('locked', picture(1), [prompt('p1')])).toBe(false)
    const revealed = picture(1, { people: ['a', 'b'], both: 0, one: 0, none: 0, voters: 0 })
    expect(takesVotes('voting', revealed, [prompt('p1')])).toBe(false)
  })
})

describe('finding people', () => {
  it('lists everyone but yourself, by name, filtered by a search', () => {
    const players = [player('1', 'Mads'), player('2', 'Anna'), player('3', 'Søren'), player('me', 'Me')]
    expect(candidatesFor(players, 'me', '').map((p) => p.name)).toEqual(['Anna', 'Mads', 'Søren'])
    expect(candidatesFor(players, 'me', 'sor').map((p) => p.name)).toEqual(['Søren'])
    expect(candidatesFor(players, 'me', 'me')).toEqual([])
  })

  it('names players, falling back to the name a reveal kept', () => {
    expect(nameOf([player('1', 'Mads')], '1')).toBe('Mads')
    expect(nameOf([], '1', 'Anna')).toBe('Anna')
    expect(nameOf([], '1')).toBe('A guest')
  })
})

describe('reveals', () => {
  const scoring = { perPerson: 1, bothBonus: 2 }

  it('says what a reveal meant for you', () => {
    const revealed = picture(3, { people: ['a', 'b'], both: 1, one: 0, none: 0, voters: 1 })
    expect(outcomeOf(revealed, 'me', 2, scoring)).toBe('You got both (+4)')
    expect(outcomeOf(revealed, 'me', 1, scoring)).toBe('You got 1 of 2 (+1)')
    expect(outcomeOf(revealed, 'me', 0, scoring)).toBe('You got 0 of 2')
    expect(outcomeOf(revealed, 'me', undefined, scoring)).toBe("You didn't vote on this one")
    expect(outcomeOf(revealed, 'a', undefined, scoring)).toBe("That's you! No points on your own picture.")
    expect(outcomeOf(revealed, 'me', 1, undefined)).toBe('You got 1 of 2 (+1)')
  })

  it('counts the points of a reveal', () => {
    expect(revealPoints(2, scoring)).toBe(4)
    expect(revealPoints(undefined, scoring)).toBe(0)
    expect(revealPoints(2, undefined)).toBe(2)
  })

  it('sums up the votes', () => {
    expect(countsLine({ people: ['a', 'b'], both: 14, one: 9, none: 15, voters: 38 })).toBe('14 of 38 got both, 9 got one')
    expect(countsLine({ people: ['a', 'b'], both: 14, one: 9, none: 15, voters: 38 }, true)).toBe('14 of 38 got both')
    expect(countsLine({ people: ['a', 'b'], both: 3, one: 0, none: 0, voters: 3 })).toBe('3 of 3 got both')
    expect(countsLine({ people: ['a', 'b'], both: 0, one: 0, none: 0, voters: 0 })).toBe('Nobody voted on it')
    expect(totalVotes({ p1: 31, p2: 12 })).toBe(43)
    expect(totalVotes({})).toBe(0)
  })

  it('finds the best disguise, only when it fooled most of the room', () => {
    const easy = picture(1, { people: ['a', 'b'], both: 30, one: 5, none: 5, voters: 40 })
    const hard = picture(2, { people: ['c', 'd'], both: 3, one: 10, none: 27, voters: 40 })
    const empty = picture(3, { people: ['e', 'f'], both: 0, one: 0, none: 0, voters: 0 })
    expect(bestDisguise([easy, hard, empty, picture(4)])?.n).toBe(2)
    expect(bestDisguise([easy])).toBeNull()
    expect(bestDisguise([picture(1)])).toBeNull()
  })
})

describe('publicOf', () => {
  it('treats anything without pictures as no public state yet', () => {
    expect(publicOf(null)).toBeNull()
    expect(publicOf({})).toBeNull()
    expect(publicOf('x')).toBeNull()
    const state = { phase: 'locked', pictures: [picture(1)], top: [{ playerId: 'a', points: 2 }], lastReveal: { n: 1, at: 5 } }
    expect(publicOf(state)).toEqual(state)
  })

  it('fills in what sample data leaves out', () => {
    expect(publicOf({ pictures: [picture(1)] })).toEqual({ phase: 'voting', pictures: [picture(1)], top: [], lastReveal: null })
  })
})

describe('fitTiles', () => {
  it('gives a few pictures big tiles in one row', () => {
    const fit = fitTiles(4, 1400, 800, { aspect: 0.8, gap: 20 })
    expect(fit).toMatchObject({ columns: 4, rows: 1 })
    expect(fit.tileHeight).toBeLessThanOrEqual(800)
    expect(fit.tileWidth * 4 + 3 * 20).toBeLessThanOrEqual(1400)
  })

  it('fits forty pictures on a 1080p stage beside the rail', () => {
    const fit = fitTiles(40, 1400, 760, { aspect: 0.8, gap: 12 })
    expect(fit.columns * fit.rows).toBeGreaterThanOrEqual(40)
    expect(fit.rows * fit.tileHeight + (fit.rows - 1) * 12).toBeLessThanOrEqual(760 + 0.001)
    expect(fit.columns * fit.tileWidth + (fit.columns - 1) * 12).toBeLessThanOrEqual(1400 + 0.001)
    expect(fit.tileWidth).toBeGreaterThan(100)
  })

  it('keeps the aspect ratio', () => {
    const fit = fitTiles(12, 1600, 900, { aspect: 0.8, gap: 16 })
    expect(fit.tileWidth / fit.tileHeight).toBeCloseTo(0.8)
  })

  it('copes with nothing to lay out', () => {
    expect(fitTiles(0, 1000, 800).tileWidth).toBe(0)
    expect(fitTiles(5, 0, 0).tileWidth).toBe(0)
  })
})

describe('firstTime', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is true once per key in a tab', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    })
    expect(firstTime('reveal:1')).toBe(true)
    expect(firstTime('reveal:1')).toBe(false)
    expect(firstTime('reveal:2')).toBe(true)
  })

  it('says true when storage is unavailable', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
    })
    expect(firstTime('reveal:1')).toBe(true)
  })
})
