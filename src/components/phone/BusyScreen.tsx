import { useLayoutEffect, useRef } from 'react'
import { useLoaderHold } from '@/lib/loader'

/**
 * The calm busy state (docs/engine-v2.md, 5.9): "Lots of guests arriving, one
 * moment" under the app's hopping confetti, while the sign-in waits out a rate
 * limit. It sits over the loader (#splash, z-index 60) and keeps it up, and its
 * confetti hops in step with the loader's, so nothing jumps when it comes or
 * goes. Join, Play and the TV page show it instead of an error notice.
 */
export default function BusyScreen() {
  useLoaderHold()
  const confetti = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    // The loader's confetti has been hopping since it appeared: start where it is.
    const source = document.querySelector('#splash .confetti-loader > span')?.getAnimations?.()[0]?.currentTime
    if (typeof source !== 'number') return
    for (const piece of confetti.current?.children ?? []) {
      for (const animation of piece.getAnimations()) animation.currentTime = source
    }
  }, [])

  return (
    <div role="status" aria-live="polite" className="fixed inset-0 z-[61] grid place-items-center bg-background p-4">
      <div className="relative">
        <div ref={confetti} className="confetti-loader" aria-hidden>
          <span />
          <span />
          <span />
          <span />
        </div>
        <p className="absolute top-full left-1/2 mt-8 w-[min(18rem,80vw)] -translate-x-1/2 text-center text-muted-foreground duration-500 animate-in fade-in-0 motion-reduce:animate-none">
          Lots of guests arriving, one moment
        </p>
      </div>
    </div>
  )
}
