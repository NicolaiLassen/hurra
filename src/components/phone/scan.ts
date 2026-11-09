import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'

/**
 * The `?scanned=<player code>` a camera scan of a player QR leads to (see
 * src/pages/PlayerCard.tsx), and `done` to drop it once it is used.
 */
export function useScannedCode(): { code: string | null; done: () => void } {
  const [params, setParams] = useSearchParams()
  const code = params.get('scanned')?.toUpperCase() || null
  const done = useCallback(
    () =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          next.delete('scanned')
          return next
        },
        { replace: true },
      ),
    [setParams],
  )
  return useMemo(() => ({ code, done }), [code, done])
}
