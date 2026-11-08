import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

export type Watch = { table: string; filter?: string }

type LiveState<T> = { data?: T; error?: Error }

/** A live query's latest result; `retry` loads it again from scratch (e.g. after an error). */
export type LiveQuery<T> = LiveState<T> & { retry: () => void }

/** Waits before retrying a failed load: 1s, 2s, 5s, then every 10s. */
const BACKOFF_MS = [1000, 2000, 5000, 10_000]

/**
 * Loads data with `fetcher` and reloads it whenever rows change in the watched
 * tables (Supabase Realtime, subscribed after the first successful load), once
 * the change feed is live (changes made while it was starting up aren't
 * delivered), when the tab becomes visible again and when the device comes back
 * online, since phones drop their socket while asleep.
 *
 * - One request at a time: changes that arrive meanwhile queue one more load,
 *   so an older response can never land after a newer one.
 * - Errors only show while there's no data yet. A failed reload keeps what's
 *   on screen and retries by itself with backoff.
 *
 * `fetcher` must be memoised with useCallback: a new function means a new query.
 * Realtime can't filter DELETE events, so deletes are watched table-wide.
 */
export function useLiveQuery<T>(fetcher: () => Promise<T>, watches: Watch[] = []): LiveQuery<T> {
  const watchKey = JSON.stringify(watches)
  const [attempt, setAttempt] = useState(0)
  // Results are kept with the query they answer, so a new id never shows the old one's data.
  const query = useMemo(() => ({ fetcher, watchKey, attempt }), [fetcher, watchKey, attempt])
  const [state, setState] = useState<LiveState<T> & { query?: typeof query }>({})

  useEffect(() => {
    let cancelled = false
    let inFlight = false
    let queued = false
    let failures = 0
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let channel: ReturnType<typeof supabase.channel> | null = null
    const parsed = JSON.parse(query.watchKey) as Watch[]

    const load = () => {
      if (cancelled) return
      if (inFlight) {
        queued = true
        return
      }
      inFlight = true
      clearTimeout(retryTimer)
      query
        .fetcher()
        .then(
          (data) => {
            if (cancelled) return
            failures = 0
            setState({ query, data })
            subscribe()
          },
          (error: unknown) => {
            if (cancelled) return
            const failed = error instanceof Error ? error : new Error(String(error))
            setState((s) => (s.query === query && s.data !== undefined ? s : { query, error: failed }))
            retryTimer = setTimeout(load, BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)])
            failures++
          },
        )
        .finally(() => {
          inFlight = false
          if (queued) {
            queued = false
            load()
          }
        })
    }
    load()

    const onVisible = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', load)

    // Subscribes after the first successful load, not before: a fetcher can sign
    // in (Join does), and a channel that joins before that keeps anon claims, so
    // row level security hides every change. The 'system ok' reload covers
    // changes made in between.
    function subscribe() {
      if (channel || cancelled || parsed.length === 0) return
      // Random suffix: React StrictMode remounts before the old channel is gone.
      channel = supabase.channel(`live:${Math.random().toString(36).slice(2)}`)
      for (const { table, filter } of parsed) {
        channel
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table, filter }, load)
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter }, load)
          .on('postgres_changes', { event: 'DELETE', schema: 'public', table }, load)
      }
      channel
        .on('system', {}, (msg: { extension?: string; status?: string }) => {
          if (msg.extension === 'postgres_changes' && msg.status === 'ok') load()
        })
        .subscribe()
    }

    return () => {
      cancelled = true
      clearTimeout(retryTimer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', load)
      if (channel) supabase.removeChannel(channel)
    }
  }, [query])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  const current = state.query === query ? state : {}
  return { data: current.data, error: current.error, retry }
}
