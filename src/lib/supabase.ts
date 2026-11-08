import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!url || !key) {
  throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY. Copy .env.example to .env.local.')
}

// Without a session (e.g. for a minute after a failed token refresh) supabase-js
// sends the API key instead, so a read runs as anon and row level security
// answers "no rows": a party would look deleted. Every read here needs a
// signed-in user, so such a request fails instead (a 401, which the caller sees
// as an error), and live queries keep what's on screen and retry. Auth requests
// (sign-in, token refresh) and realtime are unaffected.
function signedInFetch(input: RequestInfo | URL, init?: RequestInit) {
  const target = input instanceof Request ? input.url : String(input)
  if (target.includes('/rest/v1/') && new Headers(init?.headers).get('Authorization') === `Bearer ${key}`) {
    // new Response, not Response.json: the static one is missing on iOS 16 Safari.
    return Promise.resolve(
      new Response(JSON.stringify({ message: 'Not signed in' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  }
  return fetch(input, init)
}

// supabase-js persists the auth session in localStorage. For players that's an
// anonymous user, which is what keeps a phone tied to its player across visits.
export const supabase = createClient(url, key, { global: { fetch: signedInFetch } })
