import { useEffect, useRef, useState } from 'react'

/** Now by the database clock, re-read every `ms` while `active`: for the last call's countdown. */
export function useClock(serverNow: () => number, ms = 250, active = true): number {
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
