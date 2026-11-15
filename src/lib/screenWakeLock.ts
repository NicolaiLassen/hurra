// Keeps the screen awake while the TV page is visible (docs/engine-v2.md, 7.2):
// the TV runs all evening, and a laptop that dims or sleeps takes the TV (or its
// mirror) with it. Browsers drop the lock whenever the tab hides, so it is taken
// again each time the tab shows. Where the API is missing or refuses (battery
// saver, an insecure page), nothing happens and the screen may sleep as before.
import { useEffect } from 'react'

type Sentinel = { release(): Promise<void>; addEventListener(type: 'release', listener: () => void): void }
export type WakeLockApi = { request(type: 'screen'): Promise<Sentinel> }
export type VisibleDocument = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>

/** Holds a screen wake lock while `doc` is visible. Returns the cleanup, which releases it. */
export function keepScreenAwake(wakeLock: WakeLockApi | undefined, doc: VisibleDocument): () => void {
  if (!wakeLock) return () => {}
  let held: Sentinel | null = null
  let taking = false
  let stopped = false
  const take = async () => {
    if (stopped || taking || held || doc.visibilityState !== 'visible') return
    taking = true
    try {
      const sentinel = await wakeLock.request('screen')
      if (stopped) {
        void sentinel.release().catch(() => {})
        return
      }
      held = sentinel
      sentinel.addEventListener('release', () => {
        if (held === sentinel) held = null
      })
    } catch {
      // Refused: the screen may sleep, as it would without this.
    } finally {
      taking = false
    }
  }
  const onVisibility = () => void take()
  doc.addEventListener('visibilitychange', onVisibility)
  void take()
  return () => {
    stopped = true
    doc.removeEventListener('visibilitychange', onVisibility)
    if (held) void held.release().catch(() => {})
    held = null
  }
}

/** The TV page: keep the screen awake while it shows. */
export function useScreenWakeLock() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || typeof document === 'undefined') return
    return keepScreenAwake((navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock, document)
  }, [])
}
