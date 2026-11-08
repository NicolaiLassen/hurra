import { useEffect } from 'react'

// The app's one loader: the #splash element in index.html, outside #root, so
// React never replaces it and the confetti keeps hopping through the handover.
// Screens ask for it with <Loading /> or useLoaderHold(); this module alone
// decides when it shows and hides.
//
// - First open: the splash is up from the first paint and stays until the first
//   screen has its data, and for at least one full wave of the four pieces
//   (1.2s hop, 0.36s stagger), counted from navigation start.
// - Later loads: nothing for the first 200ms, so quick ones don't flash; once
//   visible it stays at least 600ms. Both end with a short fade.
// - Safety net: a loader that's still up after 15s (say the database can't be
//   reached) says so and offers a reload.

const FIRST_OPEN_MIN_MS = 1500
const SHOW_DELAY_MS = 200
const SHOWN_MIN_MS = 600
const FADE_MS = 250
const SLOW_MS = 15_000

let holds = 0
/** When the loader became visible (performance.now(), so 0 is navigation start), or null while hidden. */
let shownAt: number | null = 0
let firstOpen = true
/** Set after the app's first render, once every first screen has had the chance to hold the loader. */
let started = false
let showTimer: ReturnType<typeof setTimeout> | undefined
let hideTimer: ReturnType<typeof setTimeout> | undefined
let slowTimer: ReturnType<typeof setTimeout> | undefined
let queued = false

const splash = () => (typeof document === 'undefined' ? null : document.getElementById('splash'))

function setSlow(slow: boolean) {
  const message = splash()?.querySelector<HTMLElement>('.splash-slow')
  if (message) message.hidden = !slow
}

splash()
  ?.querySelector('.splash-slow button')
  ?.addEventListener('click', () => window.location.reload())
// The safety net counts from the first paint, even if the app never gets to render.
if (splash()) slowTimer = setTimeout(() => setSlow(true), Math.max(0, SLOW_MS - performance.now()))

function show() {
  showTimer = undefined
  const el = splash()
  if (!el) return
  el.hidden = false
  el.dataset.state = 'shown'
  shownAt = performance.now()
  scheduleUpdate() // starts the safety net
}

function hide() {
  const el = splash()
  if (!el) return
  clearTimeout(slowTimer)
  slowTimer = undefined
  el.dataset.state = 'leaving'
  hideTimer = setTimeout(() => {
    hideTimer = undefined
    el.hidden = true
    setSlow(false)
    shownAt = null
    firstOpen = false
  }, FADE_MS)
}

function update() {
  queued = false
  const el = splash()
  if (!el) return
  if (holds > 0) {
    clearTimeout(hideTimer)
    hideTimer = undefined
    if (shownAt === null) {
      showTimer ??= setTimeout(show, SHOW_DELAY_MS)
      return
    }
    // Fading out already: come back.
    if (el.dataset.state === 'leaving') el.dataset.state = firstOpen ? 'boot' : 'shown'
    slowTimer ??= setTimeout(() => setSlow(true), Math.max(0, shownAt + SLOW_MS - performance.now()))
    return
  }
  clearTimeout(showTimer)
  showTimer = undefined
  if (shownAt === null || !started || el.dataset.state === 'leaving') return
  clearTimeout(hideTimer)
  const until = firstOpen ? FIRST_OPEN_MIN_MS : shownAt + SHOWN_MIN_MS
  hideTimer = setTimeout(hide, Math.max(0, until - performance.now()))
}

// Coalesced, so one screen handing over to the next in the same render never
// looks like "nothing is loading" for a moment.
function scheduleUpdate() {
  if (queued) return
  queued = true
  queueMicrotask(update)
}

/** Keeps the loader up until the returned release function is called. */
export function holdLoader(): () => void {
  holds++
  scheduleUpdate()
  let released = false
  return () => {
    if (released) return
    released = true
    holds--
    scheduleUpdate()
  }
}

/** Whether the loader is on screen (still up from the first open, or fading out). */
export const loaderShowing = () => shownAt !== null

/** Holds the loader while `waiting` is true, e.g. while a screen's first data is still loading. */
export function useLoaderHold(waiting = true) {
  useEffect(() => (waiting ? holdLoader() : undefined), [waiting])
}

/** Call once the app's first render is on screen; the splash leaves when nothing holds it. */
export function startLoader() {
  started = true
  scheduleUpdate()
}
