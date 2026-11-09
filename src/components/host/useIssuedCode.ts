import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from '@/components/host/hostCalls'

export type IssuedCode = { code: string; expiresAt: number }

export type IssuedCodeState = {
  issued: IssuedCode | null
  error: string | null
  pending: boolean
  /** Issues a fresh code: the old one stops working. */
  renew: () => void
}

/**
 * A one-time code the host shows someone (pairing a TV, moving a player to a
 * new phone), issued once when the component mounts and again on `renew`.
 * Only the newest request's answer is shown. The first issue waits a tick, so
 * StrictMode's mount, unmount and mount in development issues one code, not
 * two that race to be the valid one.
 *
 * With `revoke` (a stable function), closing cancels the code: the one on
 * screen when the component unmounts, and one that arrives after it did, so a
 * code nobody is looking at stops working at once. A used code revokes as a
 * no-op.
 */
export function useIssuedCode(issue: () => Promise<IssuedCode>, revoke?: (code: string) => Promise<unknown>): IssuedCodeState {
  const [state, setState] = useState<Omit<IssuedCodeState, 'renew'>>({ issued: null, error: null, pending: true })
  const latest = useRef(0)
  // Whether this is still on screen, and the code it shows: read when it closes.
  const live = useRef({ mounted: false, shown: null as string | null })

  const run = useCallback(async () => {
    const ticket = ++latest.current
    setState((s) => ({ ...s, pending: true, error: null }))
    try {
      const issued = await issue()
      if (!live.current.mounted) {
        // Closed while it was being issued: nobody saw it.
        void revoke?.(issued.code).catch(() => {})
        return
      }
      if (latest.current === ticket) {
        live.current.shown = issued.code
        setState({ issued, error: null, pending: false })
      }
    } catch (error) {
      if (latest.current === ticket) setState({ issued: null, error: errorMessage(error), pending: false })
    }
  }, [issue, revoke])

  useEffect(() => {
    const box = live.current
    box.mounted = true
    const timer = setTimeout(() => void run(), 0)
    return () => {
      clearTimeout(timer)
      box.mounted = false
      const shown = box.shown
      box.shown = null
      if (shown) void revoke?.(shown).catch(() => {})
    }
  }, [run, revoke])

  const renew = useCallback(() => void run(), [run])
  return { ...state, renew }
}
