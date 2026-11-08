// Supabase pauses free-tier projects after a week without activity, which takes
// the app offline (host login and joining fail). A daily query keeps it awake.
export default async () => {
  const url = `${process.env.VITE_SUPABASE_URL}/rest/v1/sessions?select=id&limit=1`
  try {
    const res = await fetch(url, { headers: { apikey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '' } })
    console.log(`Supabase keep-alive: HTTP ${res.status}`)
  } catch (error) {
    console.error('Supabase keep-alive failed (is the project paused?)', error)
  }
}

export const config = { schedule: '@daily' }
