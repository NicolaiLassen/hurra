import { useEffect, useState } from 'react'

/**
 * This device's clock, re-read every `ms` while `running`: for the time left
 * on a pairing or transfer code, whose expiry is by this device's clock too
 * (queries.ts takes it before the call, so it is never later than the real one).
 */
export function useNow(ms = 1000, running = true): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!running) return
    const tick = () => setNow(Date.now())
    const timer = setInterval(tick, ms)
    // Catch up at once after a pause, e.g. when a dialog opens again.
    const first = setTimeout(tick, 0)
    return () => {
      clearInterval(timer)
      clearTimeout(first)
    }
  }, [ms, running])
  return now
}
