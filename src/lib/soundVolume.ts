// The TV's sound effects volume (docs/engine-v2.md, 7.2 and 7.3): a setting of
// the party, 0 to 100, that the host picks in steps in the control room and
// only TV screens follow (paired TVs and the host's own TV tab), so a computer
// that plays the party music as well can keep Hurra's sounds under the music.
// Phones keep their own volume. Pure functions, so they're easy to test.

/** As loud as the sound library: a new party's setting, and the TV's before it reads one. */
export const DEFAULT_SOUND_VOLUME = 100

/** The steps the control room offers, in percent: 0 is off. */
export const SOUND_VOLUME_STEPS: readonly number[] = [0, 25, 50, 75, 100]

/**
 * A stored volume as a whole percentage from 0 to 100. Anything that isn't a
 * number (a snapshot from before the setting existed) is the default.
 */
export function soundVolumeOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SOUND_VOLUME
  return Math.min(100, Math.max(0, Math.round(value)))
}

/**
 * The gain, 0 to 1, that makes the effects sound as loud as the percentage
 * says. Loudness grows with about the 0.6th power of the amplitude (Stevens'
 * power law), so the gain is the share to the power of 5/3: 50% is 10 dB down
 * and sounds about half as loud, 25% is 20 dB down, and 0 is silent. A plain
 * linear gain would leave 50% sounding two thirds as loud as 100%.
 */
export function soundVolumeGain(volume: number): number {
  return (soundVolumeOf(volume) / 100) ** (5 / 3)
}
