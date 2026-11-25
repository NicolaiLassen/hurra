// Lydspor's small phone hooks: the database clock re-read on a timer, and the
// keyboard rule that keeps a song's heading and both fields in view.
import { useEffect, useRef, useState, type RefObject } from 'react'
import { keyboardScroll } from './model'

/** Now by the database clock, re-read every `ms` while `active`. */
export function useNow(serverNow: () => number, ms: number, active = true): number {
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

/** How long after a field takes the focus the rule runs again, once the keyboard is up. */
const SETTLE_MS = 350

/**
 * With the keyboard up (spec 4.3 and 4.6.1): whenever a field inside `keep`
 * takes the focus, whenever the visible viewport resizes, and whenever
 * `shift` changes (something mounted above, such as the new song's banner),
 * scrolls the least it can so `keep`'s bottom sits 12 px above the keyboard,
 * never so far that `top` goes higher than 12 px from the top. Without `top`,
 * the element just before `keep` (an opened board row); a top that is hidden
 * (that row on a narrow phone) gives way to `keep` itself.
 */
export function useKeyboardKeep(keep: RefObject<HTMLElement | null>, top?: RefObject<HTMLElement | null>, shift?: unknown) {
  const again = useRef<() => void>(() => undefined)
  // iOS Safari has no scroll anchoring: a banner mounted above would push the fields behind the keyboard.
  useEffect(() => {
    again.current()
  }, [shift])
  useEffect(() => {
    let frame = 0
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const run = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const block = keep.current
        const focus = document.activeElement
        if (!block || !(focus instanceof HTMLElement) || !block.contains(focus)) return
        const above = top ? top.current : block.previousElementSibling
        const head = above instanceof HTMLElement && above.getClientRects().length > 0 ? above : block
        const viewport = window.visualViewport
        const a = head.getBoundingClientRect()
        const b = block.getBoundingClientRect()
        const f = focus.getBoundingClientRect()
        const down = keyboardScroll({
          top: a.top,
          bottom: b.bottom,
          focusTop: f.top,
          focusBottom: f.bottom,
          viewTop: viewport?.offsetTop ?? 0,
          viewHeight: viewport?.height ?? window.innerHeight,
        })
        if (down !== 0) window.scrollBy(0, down)
      })
    }
    const onFocusIn = (event: FocusEvent) => {
      if (!(event.target instanceof Node) || !keep.current?.contains(event.target)) return
      run()
      const timer = setTimeout(() => {
        timers.delete(timer)
        run()
      }, SETTLE_MS)
      timers.add(timer)
    }
    document.addEventListener('focusin', onFocusIn)
    window.visualViewport?.addEventListener('resize', run)
    again.current = run
    return () => {
      again.current = () => undefined
      cancelAnimationFrame(frame)
      for (const timer of timers) clearTimeout(timer)
      document.removeEventListener('focusin', onFocusIn)
      window.visualViewport?.removeEventListener('resize', run)
    }
  }, [top, keep])
}
