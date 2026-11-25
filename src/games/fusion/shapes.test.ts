import { describe, expect, it } from 'vitest'
import {
  bestDisguise,
  countsLine,
  isLegacyState,
  listNames,
  lockedTotal,
  plural,
  pointsFor,
  readPublic,
  readView,
  revealedCount,
  scoringLine,
  showingIndex,
  strapWords,
  type FusionPublicPicture,
  type FusionPublicState,
  type FusionReveal,
} from './shapes'

const RULES = { seconds: 30, showSeconds: 6, perPerson: 1, bothBonus: 1 }

const reveal = (patch: Partial<FusionReveal> = {}): FusionReveal => ({
  people: ['ana', 'bo'],
  names: ['Ana', 'Bo'],
  both: 9,
  one: 6,
  none: 6,
  voters: 21,
  originals: ['s/g/ana.jpg', null],
  step: 1,
  at: 5_000,
  ...patch,
})

const picture = (n: number, revealed: FusionReveal | null = null): FusionPublicPicture => ({
  n,
  key: `p${n}`,
  label: `#${n}`,
  image: null,
  revealed,
})

const state = (patch: Partial<FusionPublicState> = {}): FusionPublicState => ({
  phase: 'lobby',
  pictures: Array.from({ length: 12 }, (_, i) => picture(i + 1)),
  rules: RULES,
  showing: null,
  current: null,
  top: [],
  ...patch,
})

describe('readPublic', () => {
  it('is null without a state or its pictures', () => {
    for (const raw of [null, undefined, 1, 'x', [], {}, { pictures: 'x' }, { phase: 'lobby' }]) expect(readPublic(raw)).toBeNull()
  })

  it('reads a new state as it is, after a JSON round trip', () => {
    const pub = state({
      phase: 'asking',
      pictures: [picture(1, reveal()), { ...picture(2), image: 's/g/a.jpg' }, picture(3)],
      current: { n: 2, step: 2, key: 'p2', openedAt: 10_000, endsAt: 40_000, revealedAt: null },
      top: [
        { playerId: 'cy', points: 3, rank: 1 },
        { playerId: 'dee', points: 3, rank: 1 },
        { playerId: 'eve', points: 1, rank: 3 },
      ],
    })
    expect(readPublic(JSON.parse(JSON.stringify(pub)))).toEqual(pub)
    const showing = state({ phase: 'showing', showing: { startedAt: 1_000, endsAt: 73_000 } })
    expect(readPublic(JSON.parse(JSON.stringify(showing)))).toEqual(showing)
  })

  it('reads a round of the background version, voting or locked, as the lobby', () => {
    const old = {
      phase: 'locked',
      pictures: [
        { n: 1, key: 'p1', label: '#1', image: null, revealed: { people: ['ana', 'bo'], names: ['Ana', 'Bo'], both: 1, one: 0, none: 0, voters: 1 } },
        { n: 2, key: 'p2', label: '#2', image: null, revealed: null },
      ],
      top: [{ playerId: 'cy', points: 2 }],
      lastReveal: { n: 1, at: 5_000 },
      scoring: { perPerson: 2, bothBonus: 1 },
    }
    const pub = readPublic(old)!
    expect(pub.phase).toBe('lobby')
    expect(pub.rules).toEqual({ seconds: 30, showSeconds: 6, perPerson: 2, bothBonus: 1 })
    expect(pub.pictures[0].revealed).toEqual({
      people: ['ana', 'bo'],
      names: ['Ana', 'Bo'],
      both: 1,
      one: 0,
      none: 0,
      voters: 1,
      originals: [null, null],
      step: 1,
      at: null,
    })
    expect(pub.top).toEqual([{ playerId: 'cy', points: 2, rank: 1 }])
    expect(pub.showing).toBeNull()
    expect(pub.current).toBeNull()
    expect(readPublic({ ...old, phase: 'voting' })!.phase).toBe('lobby')
  })

  it('reads a finished round of the background version: no scoring, names or ranks', () => {
    const pub = readPublic({
      phase: 'done',
      pictures: [
        { n: 1, revealed: { people: ['ana', 'bo'], both: 1, one: 0, none: 0, voters: 2 } },
        { n: 2, revealed: { people: ['cy', 'dee'], both: 0, one: 2, none: 0, voters: 2 } },
        { n: 3, revealed: null },
      ],
      top: [
        { playerId: 'eve', points: 4 },
        { playerId: 'fin', points: 4 },
        { playerId: 'gus', points: 1 },
        { playerId: 7, points: 9 },
      ],
      lastReveal: { n: 2, at: 9_000 },
    })!
    expect(pub.phase).toBe('done')
    expect(pub.rules).toEqual({ seconds: 30, showSeconds: 6, perPerson: 1, bothBonus: 0 })
    expect(pub.pictures.map((p) => p.key)).toEqual(['p1', 'p2', 'p3'])
    expect(pub.pictures.map((p) => p.label)).toEqual(['#1', '#2', '#3'])
    expect(pub.pictures[0].revealed!.names).toEqual(['A guest', 'A guest'])
    expect(pub.pictures.map((p) => p.revealed?.step ?? null)).toEqual([1, 2, null])
    expect(pub.top).toEqual([
      { playerId: 'eve', points: 4, rank: 1 },
      { playerId: 'fin', points: 4, rank: 1 },
      { playerId: 'gus', points: 1, rank: 3 },
    ])
  })

  it('fills in missing steps in the order the pictures were revealed, then by number', () => {
    const r = (at: number | null) => ({ people: ['a', 'b'], both: 0, one: 0, none: 0, voters: 0, ...(at === null ? {} : { at }) })
    const pub = readPublic({ phase: 'wall', pictures: [{ revealed: r(null) }, { revealed: r(9_000) }, { revealed: r(3_000) }, { revealed: r(null) }] })!
    expect(pub.pictures.map((p) => p.revealed!.step)).toEqual([3, 2, 1, 4])
    const mixed = readPublic({ phase: 'wall', pictures: [{ revealed: { ...r(1), step: 2 } }, { revealed: r(2) }, { revealed: { ...r(3), step: 1 } }] })!
    expect(mixed.pictures.map((p) => p.revealed!.step)).toEqual([2, 3, 1])
  })

  it('cleans each picture: numbers, keys, labels, images and broken reveals', () => {
    const pub = readPublic({
      pictures: [
        { n: 0, key: 4, label: null, image: '' },
        null,
        { n: 7, key: 'p7', label: 'Viking', image: 's/g/v.jpg', revealed: { people: ['a'] } },
        { revealed: { people: ['a', 'b'], names: ['A'], both: -1, one: 'x', none: Infinity, voters: 2, at: 'soon', step: 1.5 } },
      ],
    })!
    expect(pub.pictures.slice(0, 3)).toEqual([
      { n: 1, key: 'p1', label: '#1', image: null, revealed: null },
      { n: 2, key: 'p2', label: '#2', image: null, revealed: null },
      { n: 7, key: 'p7', label: 'Viking', image: 's/g/v.jpg', revealed: null },
    ])
    expect(pub.pictures[3].revealed).toEqual({
      people: ['a', 'b'],
      names: ['A guest', 'A guest'],
      both: 0,
      one: 0,
      none: 0,
      voters: 2,
      originals: [null, null],
      step: 1,
      at: null,
    })
  })

  it("reads the two people's own photos as paths or nulls, [null, null] where none were saved", () => {
    const read = (originals: unknown) => readPublic({ pictures: [{ revealed: { ...reveal(), originals } }] })!.pictures[0].revealed?.originals
    expect(read(['s/g/a.jpg', 's/g/b.jpg'])).toEqual(['s/g/a.jpg', 's/g/b.jpg'])
    expect(read([null, 's/g/b.jpg'])).toEqual([null, 's/g/b.jpg'])
    expect(read(['s/g/a.jpg'])).toEqual(['s/g/a.jpg', null])
    expect(read(['', 7])).toEqual([null, null])
    expect(read(undefined)).toEqual([null, null])
    expect(read('s/g/a.jpg')).toEqual([null, null])
  })

  it('reads a showing without its times, or a picture asked without one, as the wall', () => {
    expect(readPublic({ ...state(), phase: 'showing', showing: { startedAt: 1 } })!.phase).toBe('wall')
    expect(readPublic({ ...state(), phase: 'showing' })!.showing).toBeNull()
    expect(readPublic({ ...state(), phase: 'asking', current: null })!.phase).toBe('wall')
    expect(readPublic({ ...state(), phase: 'asking', current: { n: 99, openedAt: 1, endsAt: 2 } })!.phase).toBe('wall')
    expect(readPublic({ ...state(), phase: 'reveal', current: { n: 2, openedAt: 1 } })!).toMatchObject({ phase: 'wall', current: null })
    // A showing or a current picture outside its phases is dropped.
    expect(readPublic({ ...state(), phase: 'wall', showing: { startedAt: 1, endsAt: 2 }, current: { n: 1, openedAt: 1, endsAt: 2 } })).toMatchObject({
      showing: null,
      current: null,
    })
  })

  it('fills a current picture’s key and step when they are missing', () => {
    const pub = readPublic({ ...state({ pictures: [picture(1, reveal()), picture(2)] }), phase: 'asking', current: { n: 2, openedAt: 1, endsAt: 2 } })!
    expect(pub.current).toEqual({ n: 2, step: 2, key: 'p2', openedAt: 1, endsAt: 2, revealedAt: null })
    const revealed = readPublic({
      ...state({ pictures: [picture(1, reveal({ step: 1 })), picture(2, reveal({ step: 2 }))] }),
      phase: 'reveal',
      current: { n: 1, openedAt: 1, endsAt: 2, revealedAt: 3 },
    })!
    expect(revealed.current).toEqual({ n: 1, step: 1, key: 'p1', openedAt: 1, endsAt: 2, revealedAt: 3 })
  })
})

describe('readView', () => {
  it('is null without a view', () => {
    for (const raw of [null, undefined, 3, 'x', []]) expect(readView(raw)).toBeNull()
  })

  it('reads the background version’s view: points and hits only', () => {
    expect(readView({ points: 3, hits: { 1: 2, 2: 0 } })).toEqual({ points: 3, rank: null, hits: { 1: 2, 2: 0 }, inPicture: false })
  })

  it('keeps only what it knows', () => {
    expect(readView({ points: 'x', rank: 0, hits: { 1: 3, 2: 1, 3: '2', 4: -1 }, inPicture: 'yes' })).toEqual({
      points: 0,
      rank: null,
      hits: { 2: 1 },
      inPicture: false,
    })
    expect(readView({ points: 7, rank: 2, hits: [], inPicture: true })).toEqual({ points: 7, rank: 2, hits: {}, inPicture: true })
  })
})

describe('isLegacyState', () => {
  it('knows a saved state of the background version by its phase', () => {
    expect(isLegacyState({ phase: 'voting', key: {} })).toBe(true)
    expect(isLegacyState({ phase: 'locked' })).toBe(true)
    for (const phase of ['lobby', 'showing', 'wall', 'asking', 'reveal', 'done']) expect(isLegacyState({ phase })).toBe(false)
    expect(isLegacyState(null)).toBe(false)
    expect(isLegacyState('voting')).toBe(false)
  })
})

describe('showingIndex', () => {
  const showing = state({ phase: 'showing', showing: { startedAt: 10_000, endsAt: 10_000 + 12 * 6_000 } })

  it('is null outside the showing', () => {
    expect(showingIndex(state(), 10_000)).toBeNull()
    expect(showingIndex(state({ phase: 'wall' }), 10_000)).toBeNull()
  })

  it('counts pictures from the start, each its seconds, and holds the last one', () => {
    expect(showingIndex(showing, 0)).toBe(0)
    expect(showingIndex(showing, 10_000)).toBe(0)
    expect(showingIndex(showing, 15_999)).toBe(0)
    expect(showingIndex(showing, 16_000)).toBe(1)
    expect(showingIndex(showing, 10_000 + 11 * 6_000)).toBe(11)
    expect(showingIndex(showing, 10_000 + 12 * 6_000)).toBe(11)
    expect(showingIndex(showing, 10_000 + 99 * 6_000)).toBe(11)
  })
})

describe('strapWords', () => {
  const asked = { n: 6, step: 4, key: 'p6', openedAt: 1, endsAt: 2, revealedAt: null }

  it('says where the round is, phase by phase', () => {
    expect(strapWords(null)).toBe('Getting ready')
    expect(strapWords(state())).toBe('12 pictures, starting soon')
    expect(strapWords(state({ pictures: [picture(1)] }))).toBe('1 picture, starting soon')
    const showing = state({ phase: 'showing', showing: { startedAt: 0, endsAt: 72_000 } })
    expect(strapWords(showing, 13_000)).toBe('Showing 3 of 12')
    expect(strapWords(showing)).toBe('Showing 12 pictures')
    expect(strapWords(state({ phase: 'wall' }))).toBe('All 12 pictures')
    expect(strapWords(state({ phase: 'wall', pictures: [picture(1)] }))).toBe('1 picture')
    const four = state({ phase: 'wall', pictures: Array.from({ length: 12 }, (_, i) => picture(i + 1, i < 4 ? reveal({ step: i + 1 }) : null)) })
    expect(strapWords(four)).toBe('4 of 12 revealed')
    expect(strapWords(state({ phase: 'asking', current: asked }))).toBe('Picture 4 of 12')
    expect(strapWords(state({ phase: 'reveal', current: { ...asked, revealedAt: 3 } }), 5)).toBe('Picture 4 of 12')
    expect(strapWords(state({ phase: 'done' }))).toBe('Final result')
  })
})

describe('points and words', () => {
  it('scores each right person, plus the bonus for both', () => {
    expect(pointsFor(2, { perPerson: 2, bothBonus: 3 })).toBe(7)
    expect(pointsFor(1, { perPerson: 2, bothBonus: 3 })).toBe(2)
    expect(pointsFor(0, { perPerson: 2, bothBonus: 3 })).toBe(0)
    expect(pointsFor(2, { perPerson: 1, bothBonus: 0 })).toBe(2)
  })

  it('says how a picture scores', () => {
    expect(scoringLine(RULES)).toBe('1 point for each right person, plus 1 for both.')
    expect(scoringLine({ ...RULES, perPerson: 2, bothBonus: 0 })).toBe('2 points for each right person.')
    expect(scoringLine({ ...RULES, perPerson: 0, bothBonus: 3 })).toBe('3 points for getting both.')
    expect(scoringLine({ ...RULES, perPerson: 0, bothBonus: 0 })).toBe('No points this time, just the glory.')
  })

  it('says how the room did on a picture', () => {
    expect(countsLine(reveal())).toBe('9 of 21 got both, 6 got one.')
    expect(countsLine(reveal({ one: 0 }))).toBe('9 of 21 got both.')
    expect(countsLine(reveal({ both: 0 }))).toBe('Nobody got both. 6 got one.')
    expect(countsLine(reveal({ both: 0, one: 0 }))).toBe('Nobody got either of them.')
    expect(countsLine(reveal({ both: 0, one: 0, none: 0, voters: 0 }))).toBe('Nobody guessed this one.')
  })

  it('never tells the TV exactly how many may vote', () => {
    expect(lockedTotal(7, 24)).toBe(22)
    expect(lockedTotal(23, 24)).toBe(23)
    expect(lockedTotal(0, 1)).toBe(0)
    expect(lockedTotal(0, 0)).toBe(0)
  })

  it('counts revealed pictures', () => {
    expect(revealedCount(state())).toBe(0)
    expect(revealedCount(state({ pictures: [picture(1, reveal()), picture(2), picture(3, reveal())] }))).toBe(2)
  })

  it('lists names the way the room reads them', () => {
    expect(listNames([])).toBe('')
    expect(listNames(['Ana'])).toBe('Ana')
    expect(listNames(['Ana', 'Bo'])).toBe('Ana and Bo')
    expect(listNames(['Ana', 'Bo', 'Cy'])).toBe('Ana, Bo and Cy')
    expect(listNames(['Ana', 'Bo', 'Cy', 'Dee', 'Eve'])).toBe('Ana, Bo, Cy and 2 more')
    expect(plural(1, 'point')).toBe('1 point')
    expect(plural(3, 'point')).toBe('3 points')
  })
})

describe('bestDisguise', () => {
  it('is the revealed picture the fewest saw through, under half', () => {
    const pictures = [
      picture(1, reveal({ both: 5, voters: 10, step: 1 })),
      picture(2, reveal({ both: 1, voters: 10, step: 3 })),
      picture(3, reveal({ both: 1, voters: 10, step: 2 })),
      picture(4, reveal({ both: 0, voters: 0, step: 4 })),
      picture(5),
    ]
    // #2 and #3 tie: #3 was revealed first, as the recap counts it.
    expect(bestDisguise(pictures)?.n).toBe(3)
    expect(bestDisguise([picture(1, reveal({ both: 5, voters: 10 }))])).toBeNull()
    expect(bestDisguise([picture(1), picture(2, reveal({ both: 0, one: 0, voters: 0 }))])).toBeNull()
  })
})
