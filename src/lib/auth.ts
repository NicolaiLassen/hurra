import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

let pendingSignIn: Promise<User> | null = null

/**
 * Returns the signed-in user, creating an anonymous one on the first visit.
 * Concurrent callers share one sign-in so a page load never creates two users.
 */
export function ensureSignedIn(): Promise<User> {
  pendingSignIn ??= signIn().finally(() => {
    pendingSignIn = null
  })
  return pendingSignIn
}

async function signIn(): Promise<User> {
  const { data, error } = await supabase.auth.getSession()
  // A failed refresh (say, waking up on bad Wi-Fi) is an error, not "no session":
  // signing in again would make a new anonymous user and orphan this guest's
  // player and points. The page shows Retry instead.
  if (error) throw new Error(error.message)
  if (data.session) return data.session.user

  const { data: created, error: signInError } = await supabase.auth.signInAnonymously()
  if (signInError || !created.user) throw new Error(signInError?.message ?? 'Could not sign in')
  return created.user
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
