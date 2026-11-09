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
 */
export function useIssuedCode(issue: () => Promise<IssuedCode>): IssuedCodeState {
  const [state, setState] = useState<Omit<IssuedCodeState, 'renew'>>({ issued: null, error: null, pending: true })
  const latest = useRef(0)

  const run = useCallback(async () => {
    const ticket = ++latest.current
    setState((s) => ({ ...s, pending: true, error: null }))
    try {
      const issued = await issue()
      if (latest.current === ticket) setState({ issued, error: null, pending: false })
    } catch (error) {
      if (latest.current === ticket) setState({ issued: null, error: errorMessage(error), pending: false })
    }
  }, [issue])

  useEffect(() => {
    const timer = setTimeout(() => void run(), 0)
    return () => clearTimeout(timer)
  }, [run])

  const renew = useCallback(() => void run(), [run])
  return { ...state, renew }
}
