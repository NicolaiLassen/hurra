// Helpers for unit-testing game plugins (docs/engine-v2.md, 3.4).
import type { Answer, AnswerPayload, GameInfo, GamePlayer, PlayerId } from './Game'

/**
 * Info with players named after their ids, round 1, no prompts, an empty
 * scoreboard and a fixed clock. The guest list is the players, all joined,
 * unless `overrides.guests` names expected guests too.
 */
export function testInfo<Config>(
  config: Config,
  playerIds: PlayerId[],
  overrides: Partial<GameInfo<Config>> = {},
): GameInfo<Config> {
  const players: readonly GamePlayer[] = overrides.players ?? playerIds.map((id) => ({ id, name: id, profile: {} }))
  return {
    gameId: 'game-1',
    round: 1,
    session: { id: 'session-1', name: 'Test party', data: {} },
    players,
    guests: players.map((p) => ({ id: p.id, name: p.name, joined: true })),
    scoreboard: {},
    config,
    now: 1_000,
    prompts: {},
    answers: {},
    ...overrides,
  }
}

/** A deterministic stand-in for Math.random. */
export function seededRandom(seed = 1): () => number {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

const encoder = new TextEncoder()

/** jsonb's key order: shorter keys first (in UTF-8 bytes), then bytewise. */
export function jsonbKeyOrder(a: string, b: string): number {
  const x = encoder.encode(a)
  const y = encoder.encode(b)
  if (x.length !== y.length) return x.length - y.length
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

/** Half of a surrogate pair with no partner, which jsonb refuses. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

function checkString(text: string, path: string) {
  if (text.includes('\u0000')) throw new TypeError(`${path}: jsonb can't store the NUL character`)
  if (LONE_SURROGATE.test(text)) throw new TypeError(`${path}: jsonb can't store a lone surrogate (half an emoji)`)
}

function describe(value: unknown) {
  if (value === undefined) return 'undefined'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'function') return 'a function'
  if (typeof value === 'bigint') return 'a bigint'
  if (typeof value === 'symbol') return 'a symbol'
  return (value as object).constructor?.name ?? 'an object'
}

/** Rebuilds the value in jsonb order, refusing what jsonb would refuse or change (strict). */
function rebuild(value: unknown, path: string, strict: boolean, inArray: boolean): unknown {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (strict) checkString(value, path)
    return value
  }
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return Object.is(value, -0) ? 0 : value
    if (strict) throw new TypeError(`${path}: jsonb can't store ${value}`)
    return null
  }
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    if (strict && (inArray || value !== undefined)) throw new TypeError(`${path}: jsonb can't store ${describe(value)}`)
    return inArray ? null : undefined
  }
  if (typeof value === 'bigint') throw new TypeError(`${path}: jsonb can't store a bigint`)
  if (Array.isArray(value)) return value.map((item, i) => rebuild(item, `${path}[${i}]`, strict, true))

  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) {
    if (strict) throw new TypeError(`${path}: jsonb can't store ${describe(value)}; use plain objects and arrays`)
    // As JSON.stringify would: its toJSON, or its own enumerable fields.
    const json = (value as { toJSON?: () => unknown }).toJSON
    if (typeof json === 'function') return rebuild(json.call(value), path, strict, inArray)
  }
  const record = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(record).sort(jsonbKeyOrder)) {
    if (strict) checkString(key, `${path} key ${JSON.stringify(key)}`)
    const item = rebuild(record[key], `${path}.${key}`, strict, false)
    if (item !== undefined) out[key] = item
  }
  return out
}

/**
 * The value as Postgres gives it back: object keys in jsonb order (shorter
 * keys first, then bytewise), undefined object fields dropped. strict (the
 * default) throws on undefined in arrays, NaN, Infinity, Set, Map, Date,
 * functions, NUL characters and lone surrogates, which jsonb refuses or changes.
 */
export function jsonbRoundTrip<T>(value: T, { strict = true }: { strict?: boolean } = {}): T {
  const out = rebuild(value, 'value', strict, false)
  // A top-level undefined is stored as JSON null.
  return (out === undefined ? null : out) as T
}

/** Builds info.answers entries in tests: [player, answer, ms after opening], in arrival order. */
export function answersOf(openedAt: number, entries: [PlayerId, AnswerPayload, number][]): Answer[] {
  return entries
    .map(([playerId, answer, ms]) => ({ playerId, answer, firstAt: openedAt + ms, at: openedAt + ms, ms, changes: 0 }))
    .sort((a, b) => a.ms - b.ms)
}
