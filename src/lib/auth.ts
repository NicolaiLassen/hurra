import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

export const BUSY_MESSAGE = 'Lots of guests are arriving. Try again in a minute.'

/** How long a sign-in keeps retrying a rate-limited sign-in before it gives up. */
const BUSY_BUDGET_MS = 30_000

let pending: { promise: Promise<User>; listeners: Set<() => void>; busy: boolean } | null = null

/**
 * Returns the signed-in user, creating an anonymous one on the first visit.
 * Concurrent callers share one sign-in, so a page load never creates two users.
 *
 * Guests share the venue's one IP, so when the host says "scan now" the Auth
 * rate limit answers some of them HTTP 429. Then `onBusy` is called once (the
 * page shows "Lots of guests arriving, one moment") and the sign-in retries
 * with a growing jitter of 1 to 3 s for up to about 30 s, then throws
 * "Lots of guests are arriving. Try again in a minute."
 */
export function ensureSignedIn(options: { onBusy?: () => void } = {}): Promise<User> {
  if (!pending) {
    const listeners = new Set<() => void>()
    const state = { promise: undefined as unknown as Promise<User>, listeners, busy: false }
    state.promise = signIn(() => {
      if (state.busy) return
      state.busy = true
      for (const listener of listeners) listener()
    }).finally(() => {
      if (pending === state) pending = null
    })
    pending = state
  }
  const { onBusy } = options
  if (onBusy) {
    // A caller that joins a sign-in already waiting out a 429 hears so at once.
    if (pending.busy) onBusy()
    else pending.listeners.add(onBusy)
  }
  return pending.promise
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** HTTP 429 from Auth: the anonymous sign-in's rate limit. */
function rateLimited(error: { status?: number; code?: string } | null): boolean {
  return error?.status === 429 || error?.code === 'over_request_rate_limit'
}

async function signIn(onBusy: () => void): Promise<User> {
  const { data, error } = await supabase.auth.getSession()
  // A failed refresh (say, waking up on bad Wi-Fi) is an error, not "no session":
  // signing in again would make a new anonymous user and orphan this guest's
  // player and points. The page shows Retry instead.
  if (error) throw new Error(error.message)
  if (data.session) return data.session.user

  const started = Date.now()
  for (let attempt = 0; ; attempt++) {
    const { data: created, error: signInError } = await supabase.auth.signInAnonymously()
    if (!signInError && created.user) return created.user
    if (!rateLimited(signInError)) throw new Error(signInError?.message ?? 'Could not sign in')
    onBusy()
    // 1 to 1.5 s at first, growing to 1 to 3 s.
    const wait = 1000 + Math.random() * Math.min(2000, 500 * (attempt + 1))
    if (Date.now() - started + wait > BUSY_BUDGET_MS) throw new Error(BUSY_MESSAGE)
    await sleep(wait)
  }
}

export async function currentUser(): Promise<User | null> {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw new Error(error.message)
  return data.session?.user ?? null
}

export async function isHost(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_host')
  if (error) throw new Error(error.message)
  return data === true
}

/** Signs a host in with email and password. Another account is signed out again: "This account isn't a host". */
export async function signInHost(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  if (error) throw new Error(error.message)
  let host: boolean
  try {
    host = await isHost()
  } catch (checkError) {
    await supabase.auth.signOut()
    throw checkError
  }
  if (!host) {
    await supabase.auth.signOut()
    throw new Error("This account isn't a host")
  }
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut()
  if (error) throw new Error(error.message)
}
