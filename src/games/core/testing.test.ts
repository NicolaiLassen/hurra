import { describe, expect, it } from 'vitest'
import { answersOf, jsonbKeyOrder, jsonbRoundTrip, seededRandom, testInfo } from './testing'

describe('jsonbRoundTrip', () => {
  it('puts object keys in jsonb order: shorter keys first, then bytewise', () => {
    // What Postgres gives back for {"bo": 3, "ana": 2, "zed": 1, "a": 0}.
    expect(Object.keys(jsonbRoundTrip({ bo: 3, ana: 2, zed: 1, a: 0 }))).toEqual(['a', 'bo', 'ana', 'zed'])
    // UTF-8 bytes, not UTF-16 code units: "é" is two bytes, so it sorts after "zz".
    expect(Object.keys(jsonbRoundTrip({ é: 1, zz: 2, b: 3 }))).toEqual(['b', 'zz', 'é'])
    expect(jsonbKeyOrder('B', 'a')).toBeLessThan(0)
  })

  it('reorders nested objects and keeps array order', () => {
    const value = jsonbRoundTrip({ list: [{ zz: 1, a: 2 }, 3], inner: { bb: 1, c: 2 } })
    expect(JSON.stringify(value)).toBe('{"list":[{"a":2,"zz":1},3],"inner":{"c":2,"bb":1}}')
  })

  it('drops undefined object fields and keeps plain data as it is', () => {
    const value = jsonbRoundTrip({ a: undefined, b: null, c: 'Ana 🎉', d: [1, 'x', true], e: -0 })
    expect(value).toEqual({ b: null, c: 'Ana 🎉', d: [1, 'x', true], e: 0 })
    expect('a' in value).toBe(false)
  })

  it('refuses in strict mode what jsonb refuses or changes', () => {
    const refused: [string, unknown][] = [
      ['undefined in an array', [1, undefined]],
      ['NaN', { n: NaN }],
      ['Infinity', { n: Infinity }],
      ['a Set', { s: new Set([1]) }],
      ['a Map', { m: new Map() }],
      ['a Date', { d: new Date(0) }],
      ['a function', { f: () => 1 }],
      ['a NUL character', { t: 'a\u0000b' }],
      ['a NUL in a key', { 'a\u0000': 1 }],
      ['a lone surrogate', { t: '🎉'.slice(0, 1) }],
      ['a bigint', { b: 1n }],
    ]
    for (const [what, value] of refused) expect(() => jsonbRoundTrip(value), what).toThrow(TypeError)
  })

  it('in loose mode does what JSON.stringify does', () => {
    expect(jsonbRoundTrip({ n: NaN, a: [undefined, () => 1], d: new Date(0) }, { strict: false })).toEqual({
      n: null,
      a: [null, null],
      d: '1970-01-01T00:00:00.000Z',
    })
  })
})

describe('answersOf', () => {
  it('builds answers in arrival order, timed from the opening', () => {
    expect(answersOf(1000, [['bo', { choice: ['1'] }, 900], ['ana', { choice: ['0'] }, 300]])).toEqual([
      { playerId: 'ana', answer: { choice: ['0'] }, firstAt: 1300, at: 1300, ms: 300, changes: 0 },
      { playerId: 'bo', answer: { choice: ['1'] }, firstAt: 1900, at: 1900, ms: 900, changes: 0 },
    ])
  })
})

describe('testInfo and seededRandom', () => {
  it('gives round 1 with no prompts and a fixed clock', () => {
    const info = testInfo({ x: 1 }, ['ana'])
    expect(info).toMatchObject({ round: 1, now: 1000, prompts: {}, answers: {}, config: { x: 1 } })
    expect(info.players).toEqual([{ id: 'ana', name: 'ana', profile: {} }])
  })

  it('is deterministic', () => {
    const a = seededRandom(3)
    const b = seededRandom(3)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })
})
