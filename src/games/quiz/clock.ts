// Time and sound for the quiz's screens: the database clock re-read on a
// timer (games get `serverNow` through their props, never the live session),
// and each moment's sound played once.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { SoundName } from '@/games/core/sounds'
import { playSound } from '@/lib/sound'

/** Now by the database clock, re-read every `ms` while `active`. */
export function useServerTime(serverNow: () => number, ms = 250, active = true): number {
  // The parent may pass a new function on every render: read the latest one, but keep the timer.
  const clock = useRef(serverNow)
  useEffect(() => {
    clock.current = serverNow
  }, [serverNow])
  const [now, setNow] = useState(serverNow)
  useEffect(() => {
    if (!active) return
    const tick = () => setNow(clock.current())
    const first = setTimeout(tick, 0)
    const timer = setInterval(tick, ms)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [ms, active])
  return now
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

function subscribeMotion(onChange: () => void) {
  const media = typeof window !== 'undefined' ? window.matchMedia?.(REDUCED_MOTION) : undefined
  media?.addEventListener?.('change', onChange)
  return () => media?.removeEventListener?.('change', onChange)
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && (window.matchMedia?.(REDUCED_MOTION).matches ?? false)

/** The device asks for less motion. Without motion's own hook, which stays off guests' phones. */
export function useReducedMotionPreference(): boolean {
  return useSyncExternalStore(subscribeMotion, prefersReducedMotion, () => false)
}

/**
 * Plays a moment's sound once (docs/engine-v2.md, 3.5): remembered in
 * sessionStorage, so a reload or reopening a sheet never plays it again.
 */
export function playOnce(moment: string, sound: SoundName) {
  try {
    if (sessionStorage.getItem(moment)) return
    sessionStorage.setItem(moment, '1')
  } catch {
    // No storage (private mode): it may play again after a reload, which is fine.
  }
  void playSound(sound)
}

/** Plays `sound` once for `moment`; pass null for either while there is nothing (fresh) to play. */
export function useMomentSound(moment: string | null, sound: SoundName | null) {
  useEffect(() => {
    if (moment && sound) playOnce(moment, sound)
  }, [moment, sound])
}
