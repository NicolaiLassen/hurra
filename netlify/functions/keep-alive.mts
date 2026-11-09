// Supabase pauses free projects after a week without activity, which takes the
// party offline (host login and joining fail). A daily call keeps it awake.
// keep_alive() is the one function anon may run (docs/engine-v2.md, 4.6).
export default async () => {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) {
    console.error('Supabase keep-alive: VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set')
    return
  }
  try {
    const res = await fetch(`${url}/rest/v1/rpc/keep_alive`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: '{}',
    })
    console.log(`Supabase keep-alive: HTTP ${res.status}`)
  } catch (error) {
    console.error('Supabase keep-alive failed (is the project paused?)', error)
  }
}

export const config = { schedule: '@daily' }
