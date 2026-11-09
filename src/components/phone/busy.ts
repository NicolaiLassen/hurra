// The calm busy state (docs/engine-v2.md, 5.9). Guests share the venue's one
// IP, so when the host says "scan now" the anonymous sign-in answers some of
// them HTTP 429. The sign-in then waits it out by itself, and the page shows
// "Lots of guests arriving, one moment" with the loader instead of an error.
import type { User } from '@supabase/supabase-js'
import { useCallback, useState } from 'react'
import { BUSY_MESSAGE, ensureSignedIn } from '@/lib/auth'

/**
 * Signs in (anonymously on a first visit). `busy` turns true once the sign-in
 * waits out the rate limit, and stays true: pages show the busy state while
 * they have nothing else to show.
 */
export function useBusySignIn(): { busy: boolean; signIn: () => Promise<User> } {
  const [busy, setBusy] = useState(false)
  const signIn = useCallback(() => ensureSignedIn({ onBusy: () => setBusy(true) }), [])
  return { busy, signIn }
}

/**
 * The sign-in gave up after about 30 s of waiting: still the calm state, never
 * the error notice. The page's query retries by itself with backoff.
 */
export const isBusyError = (error: Error | undefined) => error?.message === BUSY_MESSAGE
