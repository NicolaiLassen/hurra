// Participant fusion's suspense on the TV (docs/identity.md, Participant
// fusion on the TV): when the host asks a picture, a highlight hops across the
// placeholders of the pictures still to come, slowing down with soft ticks,
// lands on the one asked, it grows to the middle, its "?" pulses once, and its
// fused face flips in with a whoosh. Then the countdown starts (the logic's
// SUSPENSE_MS puts it after all this, so nobody loses guessing time). Pure,
// so the timing is tested (suspense.test.ts); TvView draws what it says.
import { SUSPENSE_MS } from '@/games/fusion/shapes'

/** The hops, from the ask: the highlight's last hop lands on the picture asked at HOP_MS. */
export const HOP_MS = 1300
/** It rests on it a moment. */
export const LAND_MS = 200
/** It grows out of its tile to the middle of the stage. */
export const GROW_MS = 450
/** Its "?" pulses once. */
export const PULSE_MS = 300
/** Its face flips in, with the whoosh. */
export const FLIP_MS = 500

export const GROW_AT = HOP_MS + LAND_MS
export const PULSE_AT = GROW_AT + GROW_MS
export const FLIP_AT = PULSE_AT + PULSE_MS
/** The picture is in: it moves to its place beside "Who is in it?", and the countdown starts at SUSPENSE_MS. */
export const IN_AT = FLIP_AT + FLIP_MS

/** The most hops; fewer pictures to come hop round them more than once. */
const MAX_HOPS = 10
const MIN_HOPS = 6
/** Each hop takes this much longer than the one before. */
const SLOWING = 1.25
/** The ticks are the pop, which lasts about 0.63 s: ticks this far apart never cut each other off. */
export const TICK_GAP_MS = 650
/** A TV that opens this soon after the ask plays the suspense; later, it shows the picture asked as it ends. */
export const FRESH_OPEN_MS = 400

/** Where the suspense is, `elapsed` ms after the ask. */
export type Beat = 'hop' | 'grow' | 'pulse' | 'flip' | 'in'

export function beatAt(elapsed: number): Beat {
  if (elapsed < GROW_AT) return 'hop'
  if (elapsed < PULSE_AT) return 'grow'
  if (elapsed < FLIP_AT) return 'pulse'
  if (elapsed < IN_AT) return 'flip'
  return 'in'
}

/** One hop: the highlight is on picture `n` from `at` ms after the ask. */
export type Hop = { n: number; at: number }

/**
 * The highlight's way to the picture asked: forward through the pictures
 * still to come in the wall's order (wrapping round), a stride apart on a big
 * wall so it sweeps across all of it, each hop slower than the one before,
 * the last one landing on `target` at HOP_MS. The same on every TV: no
 * randomness, only the pictures. One picture to come: it lights at once.
 */
export function hopPath(candidates: readonly number[], target: number): Hop[] {
  const pool = [...new Set(candidates.includes(target) ? candidates : [...candidates, target])].sort((a, b) => a - b)
  if (pool.length <= 1) return [{ n: target, at: 0 }]
  const hops = Math.min(MAX_HOPS, Math.max(MIN_HOPS, pool.length))
  const stride = Math.max(1, Math.floor(pool.length / hops))
  const end = pool.indexOf(target)
  // The intervals grow by SLOWING and add up to HOP_MS.
  const steps = hops - 1
  const base = (HOP_MS * (SLOWING - 1)) / (SLOWING ** steps - 1)
  const path: Hop[] = []
  let at = HOP_MS
  // From `steps` strides before the target, forward to it.
  for (let k = steps; k >= 0; k--) {
    const index = (((end - k * stride) % pool.length) + pool.length) % pool.length
    path.push({ n: pool[index], at: 0 })
  }
  // Times from the end back: the last hop at HOP_MS, each one before it an interval earlier.
  for (let k = path.length - 1; k >= 0; k--) {
    path[k].at = Math.max(0, Math.round(at))
    at -= base * SLOWING ** (k - 1)
  }
  path[0].at = 0
  return path
}

/**
 * The same way, squeezed into what is left when the TV caught the ask
 * `from` ms late (the ping and the read take a moment): the hops keep their
 * order and their slowing, and still land at HOP_MS. Past HOP_MS, only the
 * landing.
 */
export function hopPathFrom(path: readonly Hop[], from: number): Hop[] {
  if (from <= 0) return [...path]
  const last = path[path.length - 1]
  if (from >= HOP_MS || path.length <= 1) return [{ n: last.n, at: Math.max(from, last.at) }]
  const scale = (HOP_MS - from) / HOP_MS
  return path.map((hop) => ({ n: hop.n, at: Math.round(from + hop.at * scale) }))
}

/** The picture the highlight is on `elapsed` ms after the ask, or null before the first hop. */
export function litAt(path: readonly Hop[], elapsed: number): number | null {
  let lit: number | null = null
  for (const hop of path) if (hop.at <= elapsed) lit = hop.n
  return lit
}

/**
 * When the ticks sound, ms after the ask: the landing always, and going back
 * from it each hop at least TICK_GAP_MS before the tick after it, so one pop
 * never cuts off the last (one sound plays at a time).
 */
export function tickTimes(path: readonly Hop[]): number[] {
  if (path.length === 0) return []
  const ticks = [path[path.length - 1].at]
  for (let k = path.length - 2; k >= 0; k--) {
    if (ticks[0] - path[k].at >= TICK_GAP_MS) ticks.unshift(path[k].at)
  }
  return ticks
}

/**
 * Whether a TV plays the suspense for a picture asked `elapsed` ms ago: when
 * it was up as the ask came in (`sawAsk`), or it opened right as it came;
 * never once it is over. A TV that opens in the middle shows how it ends.
 */
export function playsSuspense(elapsed: number, sawAsk: boolean): boolean {
  if (elapsed >= SUSPENSE_MS) return false
  return sawAsk || elapsed < FRESH_OPEN_MS
}
