// The game mechanic verifier's shared parts (docs/developing.md, "The game
// mechanic verifier"): its own random source, what a run is, the invariants
// and how a game plugs into the driver. Every game's rules live in its own
// file beside this one, as an oracle that recomputes the scores from what the
// guests answered and the host did, never by calling the game's scoring.
import type { GameBot } from '../../src/games/core/bot'
import type { AnswerPayload, AnyGame, GamePlayer, PlayerId, Prompt } from '../../src/games/core/Game'
import type { Step } from '../../src/games/core/runtime'
import type { FakeParty } from '../../src/games/core/simulate'

/** What the verifier checks, in the order the report lists them. */
export const INVARIANTS = [
  'no-exception',
  'finishes-cleanly',
  'scores-match-oracle',
  'winners-match-oracle',
  'secrets-kept',
  'payouts-within-limits',
  'latecomers-dealt-fairly',
  'same-seed-same-result',
  'reloads-change-nothing',
  'old-saves-load',
] as const
export type Invariant = (typeof INVARIANTS)[number]

export const INVARIANT_WORDS: Record<Invariant, string> = {
  'no-exception': 'No exception, and only the refusals the rules explain',
  'finishes-cleanly': 'Finishes by itself or ends cleanly; no stuck timer; refuses moves once over',
  'scores-match-oracle': 'Scores, totals and views match the oracle after every save',
  'winners-match-oracle': 'Winners match the oracle',
  'secrets-kept': 'No secret in the public state, a prompt, the feed or another guest’s view before its moment',
  'payouts-within-limits': 'Payouts within their limits; the day’s scoreboard adds up',
  'latecomers-dealt-fairly': 'A latecomer gets the next undealt card while dealing in is open, never a second life',
  'same-seed-same-result': 'The same seed gives the same night',
  'reloads-change-nothing': 'Every table reloaded from JSON mid-round changes nothing',
  'old-saves-load': 'States saved by older versions load, play on and end',
}

/** A small, fast seeded random (mulberry32): the verifier's own choices, apart from the games' ctx.random. */
export class Rng {
  private s: number
  constructor(seed: number) {
    this.s = seed >>> 0
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  int(n: number): number {
    return Math.floor(this.next() * n)
  }
  between(min: number, max: number): number {
    return min + this.int(max - min + 1)
  }
  chance(p: number): boolean {
    return this.next() < p
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]
  }
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items]
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1)
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
  }
  /** A function for a bot's sight.random. */
  fn(): () => number {
    return () => this.next()
  }
}

export type Move =
  | { kind: 'action'; action: unknown; note?: string }
  | { kind: 'answer'; key: string; answer: AnswerPayload; note?: string }

export type HostStep = { action: unknown; close?: string[]; note?: string }

/** The membership changes a save picks up: leaves, then joins, as the engine runs them. */
export type Membership = { left: PlayerId[]; joined: PlayerId[] }

/** What happened in one engine call, for an oracle. */
export type Call =
  | { kind: 'start' }
  | { kind: 'end' }
  | { kind: 'sync' }
  | { kind: 'action'; playerId: PlayerId; action: unknown }
  | { kind: 'host'; action: unknown; close: string[] }

/** One game round as the oracle sees it, built by the game's adapter when the round starts. */
export interface Oracle {
  /** A guest's next move: from the game's bot, or the verifier's own. */
  guest(playerId: PlayerId): Move | null
  /** The host's next step: progress (often the bot's), a random valid step, or a stale one. */
  host(): HostStep | null
  /** An answer the database took. */
  answered(playerId: PlayerId, key: string, answer: AnswerPayload): void
  /** The database dropped everything the id had (removed or freed): its answers are gone at once. */
  dropped(playerId: PlayerId): void
  /**
   * An engine call came back. `membership` is what its save picks up (leaves,
   * then joins); it took effect only when the call committed.
   */
  after(call: Call, result: Step, membership: Membership, before: Snapshot): void
  /** Compares the game with the oracle; called after every engine call and at the end. */
  check(): void
  /** The round finished (by the game or the host): its winners. */
  finished(by: 'game' | 'host'): void
  /** The host gave points from the award page (score_events), with this round's game id or none. */
  awarded?(playerId: PlayerId, points: number, gameId: string | null): void
}

export type Adapter = {
  type: string
  /** Settings for a round of this run. */
  settings(run: Run): Record<string, unknown>
  begin(run: Run): Oracle
  /** How many players the start needs; the driver lets guests join until there are this many. */
  minPlayers?: number
  /** The chance per second that the host ends the round, whatever it is doing. Default 0.0015. */
  endChance?: number
  /** How much more often than usual guests join, leave and have their names freed. Default 1. */
  churn?: number
}

/** The game as it was just before an engine call. */
export type Snapshot = {
  now: number
  state: unknown
  publicState: unknown
  present: PlayerId[]
  prompts: Prompt[]
}

/** One run: a game, a party size, a seed. What the adapters see and use. */
export type Run = {
  readonly game: string
  readonly size: number
  readonly seed: number
  readonly rng: Rng
  readonly party: FakeParty
  readonly gameId: string
  readonly logic: AnyGame
  readonly bot: GameBot
  /** The round, from 1. */
  round: number
  /** Notes a broken invariant (the first message per invariant is kept). */
  fail(invariant: Invariant, message: string): void
  /** A line for the trace a failure prints. */
  trace(line: string): void
  present(): GamePlayer[]
  /** Names on the guest list nobody has taken. */
  expected(): GamePlayer[]
  /** The frozen settings and state of the round now. */
  config<T>(): T
  state<T>(): T
  publicState<T>(): T
  views(): Record<PlayerId, unknown>
  scores(): Record<PlayerId, number>
  prompts(): Prompt[]
  /** A player's own answers this round. */
  answers(playerId: PlayerId): Record<string, AnswerPayload>
  nameOf(playerId: PlayerId): string
  /** The occupant number of an id: it goes up each time the id leaves, so a freed name's next guest is a new person. */
  epoch(playerId: PlayerId): number
  /**
   * True when nobody joined or left since the last save: then the screens'
   * ranks and top lists, which a save recomputes, can be compared.
   */
  fresh(): boolean
  /** Counts something that happened, for the report's coverage lines. */
  count(what: string, n?: number): void
}

/** Every string anywhere in a value, for the secrecy checks. */
export function stringsIn(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') out.add(value)
  else if (Array.isArray(value)) for (const item of value) stringsIn(item, out)
  else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      out.add(key)
      stringsIn(item, out)
    }
  }
  return out
}

/** Competition ranks (1, 2, 2, 4) by points, highest first. */
export function competitionRank(points: number, all: readonly number[]): number {
  return 1 + all.filter((other) => other > points).length
}

/** "a=1, b=2" for a scores record, sorted, for messages. */
export function show(record: Readonly<Record<string, number>>, names?: (id: string) => string): string {
  const entries = Object.entries(record)
    .filter(([, v]) => v !== 0)
    .sort(([a], [b]) => (a < b ? -1 : 1))
  return entries.length === 0 ? '{}' : entries.map(([k, v]) => `${names ? names(k) : k.slice(0, 4)}=${v}`).join(', ')
}

/** Two score records are the same, a missing id counting as 0. */
export function sameScores(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): boolean {
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) if ((a[id] ?? 0) !== (b[id] ?? 0)) return false
  return true
}

export const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n')

/**
 * A name folded for matching, written here on its own (not the games' nameKey):
 * case, accents, ø as o, æ as ae, ß as ss and spaces never matter.
 */
export function fold(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, '')
}

/** A typed name as the games keep it: trimmed, runs of spaces as one. */
export const tidyName = (name: string) => name.trim().replace(/\s+/g, ' ')
