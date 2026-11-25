// Participant fusion's reveal on the TV (docs/identity.md, Participant fusion
// on the TV): when each of the two people's own photos comes in, and whether
// the sharpest eyes have room. Pure, so it is tested (reveal.test.ts).
import type { FusionPublicState } from '@/games/fusion/shapes'

/** Whether a person's own photo has loaded: 'none' when the picture has no photo of them. */
export type OriginalStatus = 'none' | 'loading' | 'ready' | 'failed'

/**
 * The beat after the reveal arrives before each person comes in, ms: the
 * picture moves to the middle first (half a second), then the first person
 * slides in from the left and the second from the right.
 */
export const ARRIVE_MS: readonly [number, number] = [700, 850]
/** A photo still loading by then comes in at last this long after the reveal, on its own surface, and fades in when it lands. */
export const ARRIVE_LATEST_MS = 2000
/** The sharpest eyes stand under the counts only on a stage at least this tall: 720p with two band lines (444 px) has no room. */
export const LEADERS_FROM_PX = 480
/** A person's photo stands this much smaller than the picture's height. */
export const SIDE_SHARE = 0.72

/** The two people's own photos of the picture revealed now, or null outside a reveal: they reach the TV no sooner. */
export function revealOriginals(pub: FusionPublicState | null): [string | null, string | null] | null {
  if (!pub || pub.phase !== 'reveal' || !pub.current) return null
  const n = pub.current.n
  return pub.pictures.find((p) => p.n === n)?.revealed?.originals ?? null
}

/**
 * How long until a person comes in, ms, `elapsed` ms after the reveal
 * mounted: at their beat once their photo has loaded (or they have none, or
 * it failed: then their profile photo or token stands in); while it loads,
 * at ARRIVE_LATEST_MS at the latest. 0 is now.
 */
export function arriveIn(status: OriginalStatus, elapsed: number, beat: number): number {
  const at = status === 'loading' ? ARRIVE_LATEST_MS : beat
  return Math.max(0, at - elapsed)
}
