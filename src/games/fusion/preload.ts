// Participant fusion's pictures on the TV (spec 8.2): what to decode when, and
// the pictures' shape. The TV warms every image from the moment its view
// mounts (usePictures.ts), so the showing never waits and never blinks; it
// decodes full images only where they show soon, so 40 decoded portraits never
// sit in memory at once. Pure, so it is tested (preload.test.ts).
import { showingIndex, type FusionPublicState } from '@/games/fusion/shapes'
import { DEFAULT_ASPECT } from '@/games/fusion/wall'

/** How many thumbnails load at once, then how many full images. */
export const THUMBS_AT_ONCE = 4
export const FULLS_AT_ONCE = 2
/** The showing decodes the picture on show and this many after it. */
export const DECODE_AHEAD = 2

/**
 * The pictures (by number) whose full image should be decoded now: in the
 * showing, the one on show and the next two; while a picture is asked or
 * revealed, that one; on the wall, the lowest picture not yet revealed (the
 * host's next Ask, so it grows into the frame sharp); in the lobby, the first
 * two (the showing opens on them). Only pictures with an image.
 */
export function decodeSet(pub: FusionPublicState, now: number): number[] {
  const withImage = pub.pictures.filter((p) => p.image !== null)
  const numbers = (list: typeof withImage) => list.map((p) => p.n)
  switch (pub.phase) {
    case 'lobby':
      return numbers(pub.pictures.slice(0, DECODE_AHEAD).filter((p) => p.image !== null))
    case 'showing': {
      const index = showingIndex(pub, now) ?? 0
      return numbers(pub.pictures.slice(index, index + 1 + DECODE_AHEAD).filter((p) => p.image !== null))
    }
    case 'wall': {
      const next = withImage.find((p) => p.revealed === null)
      return next ? [next.n] : []
    }
    case 'asking':
    case 'reveal':
      return pub.current && withImage.some((p) => p.n === pub.current!.n) ? [pub.current.n] : []
    case 'done':
      return []
  }
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

/** The frame's shape in the showing, asking and the reveal: the wall's, portrait or square only (0.6 to 1.0). */
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
