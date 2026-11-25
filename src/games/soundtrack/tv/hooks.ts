// Small hooks for Lydspor's TV screens.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Now by the database clock, read again every `every` ms: for the last call's countdown. */
export function useNow(serverNow: () => number, every: number): number {
  const [now, setNow] = useState(serverNow)
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), every)
    return () => clearInterval(timer)
  }, [serverNow, every])
  return now
}

/**
 * Steps a layout down, from step 0 to `last`, while `tooBig` (a stable
 * function) says the element doesn't fit. Measured after layout and before
 * paint, so a bigger step is never seen, and again whenever the element's
 * room changes (a second line joins the band). It only steps down: key the
 * component on its content, so new content starts again from step 0.
 */
export function useStepDown<T extends HTMLElement>(last: number, tooBig: (el: T) => boolean) {
  const ref = useRef<T>(null)
  const [step, setStep] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && step < last && tooBig(el)) setStep(step + 1)
  }, [step, last, tooBig])
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (tooBig(el)) setStep((s) => Math.min(last, s + 1))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [last, tooBig])
  return [ref, step] as const
}

/** An element whose content runs past its box: taller than it, or a word wider than it. */
export const overflows = (el: HTMLElement) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1

/** Any element marked `data-fit-lines="n"` inside `el` that takes more than n lines, or has a word wider than its line. */
export const linesOver = (el: HTMLElement) =>
  Array.from(el.querySelectorAll<HTMLElement>('[data-fit-lines]')).some((line) => {
    const max = Number(line.dataset.fitLines)
    const height = parseFloat(getComputedStyle(line).lineHeight)
    return line.scrollWidth > line.clientWidth + 1 || (Number.isFinite(height) && line.getBoundingClientRect().height > max * height + 2)
  })
