import { useLayoutEffect, useRef } from 'react'
import { previewEffectsVolume, setEffectsVolume } from '@/lib/sound'
import { DEFAULT_SOUND_VOLUME, soundVolumeOf } from '@/lib/soundVolume'

/**
 * The party's TV sound effects volume (docs/engine-v2.md, 7.2): applied when
 * the TV opens and on every change, before any sound of that render starts (a
 * layout effect runs before every passive one, where the sounds play). A
 * change while the TV shows also plays one short sound at the new level, so the
 * host hears it in the room; the level the TV opens with plays nothing. Leaving
 * the page puts the volume back, so a phone in the same tab keeps its own.
 */
export function useEffectsVolume(value: unknown): void {
  const volume = soundVolumeOf(value)
  const applied = useRef<number | null>(null)

  useLayoutEffect(() => {
    const changed = applied.current !== null && applied.current !== volume
    applied.current = volume
    setEffectsVolume(volume)
    if (changed) previewEffectsVolume()
  }, [volume])

  useLayoutEffect(() => () => setEffectsVolume(DEFAULT_SOUND_VOLUME), [])
}
