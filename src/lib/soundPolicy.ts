import { SOUNDS, type SoundName } from '@/games/core/sounds'

// Which sound plays when two would overlap: one clean sound at a time.
// Pure functions of their arguments, so they're easy to test.

/** The same sound again within this many ms is a duplicate. */
export const REPEAT_GAP_MS = 300
/** A soft (background) sound waits this long after any other sound started. */
export const SOFT_QUIET_MS = 1500

/** The sound that played last: what it was, whether it was soft, and when it started and ends (ms). */
export type SoundSlot = { name: string; priority: number; soft?: boolean; startedAt: number; endsAt: number }

/**
 * What to do with a new sound, given the last one:
 * - 'play': nothing is in the way
 * - 'replace': fade out the sound that's playing and play this one instead
 * - 'skip': don't play it
 */
export function decideSound(
  next: { name: string; priority: number; soft?: boolean },
  last: SoundSlot | null,
  now: number,
): 'play' | 'replace' | 'skip' {
  if (!last) return 'play'
  const playing = now < last.endsAt
  const sinceStart = now - last.startedAt
  // Background sounds give way both ways: to anything playing or just played...
  if (next.soft) return playing || sinceStart < SOFT_QUIET_MS ? 'skip' : 'play'
  if (next.name === last.name && (playing || sinceStart < REPEAT_GAP_MS)) return 'skip'
  if (!playing) return 'play'
  // ...and any other sound takes over from a background one that's playing.
  return last.soft || next.priority >= last.priority ? 'replace' : 'skip'
}

const isKnown = (name: unknown): name is SoundName => typeof name === 'string' && name in SOUNDS

/** The highest-priority sound of a batch (the first one on a tie), or undefined if none is known. */
export function strongestSound(names: readonly unknown[]): SoundName | undefined {
  let best: SoundName | undefined
  for (const name of names) {
    if (isKnown(name) && (!best || SOUNDS[name].priority > SOUNDS[best].priority)) best = name
  }
  return best
}
