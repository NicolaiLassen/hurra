import { useCallback, useState } from 'react'

/** An element's content size, kept up to date with a ResizeObserver; 0 by 0 until it's measured. */
export function useElementSize<T extends HTMLElement = HTMLElement>() {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const ref = useCallback((el: T | null) => {
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, size] as const
}
