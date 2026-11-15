// The TV shown in a tab of the host's own browser (docs/engine-v2.md, 7.2 and
// 7.3), for when no second device can be paired: the host page's "Show the TV
// here" opens /tv/<join code>?mirror=1, and the host casts that tab or moves it
// to the TV. The tab says so over a BroadcastChannel (same browser only, nothing
// goes over the network), so the control room can say "TV open in this browser"
// instead of "No TV paired yet".
//
// A hidden tab's timers can slow to once a minute, so a beat counts for 90 s;
// closing a tab says goodbye at once, and the host page asks on opening, so it
// never waits for the next beat.
import { useEffect, useState } from 'react'

export const TV_TAB_BEAT_MS = 4_000
export const TV_TAB_FRESH_MS = 90_000

type Message = { kind: 'open'; tab: string } | { kind: 'closed'; tab: string } | { kind: 'hello' }

export const tvTabChannel = (joinCode: string) => `hurra:tv-tab:${joinCode}`

/** The window name the host page opens the TV in, so a second click returns to the same tab. */
export const tvTabWindow = (joinCode: string) => `hurra-tv-${joinCode}`

/** In the TV tab: announce it now, every few seconds and whenever a host page asks; say goodbye on close. Returns the cleanup. */
export function announceTvTab(joinCode: string): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {}
  const channel = new BroadcastChannel(tvTabChannel(joinCode))
  const tab = Math.random().toString(36).slice(2)
  const open = () => channel.postMessage({ kind: 'open', tab } satisfies Message)
  const close = () => channel.postMessage({ kind: 'closed', tab } satisfies Message)
  channel.onmessage = (event: MessageEvent<Message>) => {
    if (event.data?.kind === 'hello') open()
  }
  open()
  const timer = setInterval(open, TV_TAB_BEAT_MS)
  const hasWindow = typeof window !== 'undefined'
  if (hasWindow) window.addEventListener('pagehide', close)
  return () => {
    clearInterval(timer)
    if (hasWindow) window.removeEventListener('pagehide', close)
    close()
    channel.close()
  }
}

/** On the host page: onChange(true) while a TV tab of this party is open in this browser, false once none is. Returns the cleanup. */
export function watchTvTab(joinCode: string, onChange: (open: boolean) => void, now: () => number = Date.now): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {}
  const channel = new BroadcastChannel(tvTabChannel(joinCode))
  const seen = new Map<string, number>()
  let open = false
  const update = () => {
    const next = seen.size > 0
    if (next !== open) {
      open = next
      onChange(next)
    }
  }
  channel.onmessage = (event: MessageEvent<Message>) => {
    const message = event.data
    if (message?.kind === 'open') seen.set(message.tab, now())
    else if (message?.kind === 'closed') seen.delete(message.tab)
    else return
    update()
  }
  channel.postMessage({ kind: 'hello' } satisfies Message)
  const timer = setInterval(() => {
    for (const [tab, at] of seen) if (now() - at > TV_TAB_FRESH_MS) seen.delete(tab)
    update()
  }, TV_TAB_BEAT_MS)
  return () => {
    clearInterval(timer)
    channel.close()
  }
}

/** The TV page: announce this tab while `enabled` (a host's own browser). */
export function useAnnounceTvTab(joinCode: string, enabled: boolean) {
  useEffect(() => (enabled ? announceTvTab(joinCode) : undefined), [joinCode, enabled])
}

/** The host page: whether a TV tab of this party is open in this browser. */
export function useTvTabOpen(joinCode: string): boolean {
  const [open, setOpen] = useState(false)
  useEffect(() => watchTvTab(joinCode, setOpen), [joinCode])
  return open
}
