// The Netlify functions' service client and sign-in check, shared by
// /api/game and /api/lydspor-ai. Runs with the secret key, server side only.
import { createClient, isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js'

// One service client per instance: it caches the JWKS, so tokens are verified
// locally (getClaims) without a call to Auth.
let cached: { url: string; key: string; db: SupabaseClient } | null = null

export function serviceClient(url: string, key: string): SupabaseClient {
  if (!cached || cached.url !== url || cached.key !== key) {
    cached = { url, key, db: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) }
  }
  return cached.db
}

/** The signed-in user's id; null for no token or an invalid one; undefined when the keys couldn't be fetched. */
export async function verify(db: SupabaseClient, req: Request): Promise<string | null | undefined> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  try {
    const { data, error } = await db.auth.getClaims(token)
    if (error) return isAuthRetryableFetchError(error) ? undefined : null
    const sub = data?.claims.sub
    return typeof sub === 'string' && sub !== '' ? sub : null
  } catch (error) {
    console.error('Checking the sign-in failed', error)
    return undefined
  }
}
