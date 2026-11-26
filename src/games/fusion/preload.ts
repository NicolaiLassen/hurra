// Participant fusion's pictures on the TV (spec 8.2): what to decode when, and
// the pictures' shape. A picture's image reaches the TV only once it is asked
// (its path is in the public state from then on), so the TV loads it at that
// moment, at high priority, while the suspense runs (usePictures.ts); a
// placeholder stands in until it is in. Full images are decoded only where
// they show, so 40 decoded portraits never sit in memory at once. Pure, so it
// is tested (preload.test.ts).
import type { FusionPublicState } from '@/games/fusion/shapes'
import { DEFAULT_ASPECT } from '@/games/fusion/wall'

/** How many thumbnails load at once, then how many full images. */
export const THUMBS_AT_ONCE = 4
export const FULLS_AT_ONCE = 2

/**
 * The pictures (by number) whose full image should be decoded now: the one
 * asked or revealed, and nothing else. On the wall, the next picture is a
 * placeholder whose image nobody has yet. Only pictures with an image.
 */
export function decodeSet(pub: FusionPublicState): number[] {
  if ((pub.phase !== 'asking' && pub.phase !== 'reveal') || !pub.current) return []
  const n = pub.current.n
  return pub.pictures.some((p) => p.n === n && p.image !== null) ? [n] : []
}

/** The middle value (the mean of the two middle ones for an even count), or null for none. */
export function median(values: readonly number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/** The wall's tile shape: the pictures' median (width over height), from 0.6 to 1.5; 4:5 until any are in. */
export function wallAspect(aspects: readonly number[]): number {
  const middle = median(aspects)
  return middle === null ? DEFAULT_ASPECT : clamp(middle, 0.6, 1.5)
}

/** The frame's shape while a picture is asked and at its reveal: the wall's, portrait or square only (0.6 to 1.0). */
export function frameAspect(aspects: readonly number[]): number {
  return clamp(wallAspect(aspects), 0.6, 1)
}

/** Runs `tasks` with at most `limit` running at once; stops starting new ones once `stopped()` says so. */
export async function runQueue(tasks: readonly (() => Promise<unknown>)[], limit: number, stopped: () => boolean): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < tasks.length && !stopped()) {
      const task = tasks[next++]
      try {
        await task()
      } catch {
        // One picture that fails to load doesn't hold up the others.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, worker))
}
