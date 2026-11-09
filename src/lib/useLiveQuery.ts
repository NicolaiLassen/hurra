import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type QueryState<T> = { data?: T; error?: Error }

/** A query's latest result; `retry` loads it again from scratch (e.g. after an error). */
export type LiveQuery<T> = QueryState<T> & { retry: () => void }

export type LiveQueryOptions = {
  /** Reload this often (ms) while mounted, e.g. the host's party list. */
  pollMs?: number
  /**
   * Reload whenever this changes, keeping what is on screen until the new
   * answer lands: for one-off reads that follow the live snapshot, such as
   * snapshot.recap.published_at or snapshot.now.
   */
  revision?: string | number | null
}

/**
 * @deprecated v1's Postgres Changes watches. v2 publishes no table to
 * Realtime (docs/engine-v2.md, 2.10), so they are ignored; kept only so v1
 * pages compile until their owners port them (10.1).
 */
export type Watch = { table: string; filter?: string }

/** Waits before retrying a failed load: 1s, 2s, 5s, then every 10s. */
const BACKOFF_MS = [1000, 2000, 5000, 10_000]

/**
 * Loads data with `fetcher`, and loads it again when the tab becomes visible,
 * when the device comes back online (phones drop their connection while
 * asleep), every `pollMs`, and whenever `revision` changes. Live party data
 * comes from the LiveSessionProvider (useLive.tsx); this is for one-off reads.
 *
 * - One request at a time: reloads asked for meanwhile queue one more load,
 *   so an older response can never land after a newer one.
 * - Errors only show while there's no data yet. A failed reload keeps what's
 *   on screen and retries by itself with backoff.
 *
 * `fetcher` must be memoised with useCallback: a new function means a new
 * query, which starts empty, so one party's data never shows for another.
 */
export function useLiveQuery<T>(fetcher: () => Promise<T>, options?: LiveQueryOptions): LiveQuery<T>
/** @deprecated The watches are ignored: pass `{ pollMs }` instead. */
export function useLiveQuery<T>(fetcher: () => Promise<T>, legacyWatches: readonly Watch[]): LiveQuery<T>
export function useLiveQuery<T>(fetcher: () => Promise<T>, second?: LiveQueryOptions | readonly Watch[]): LiveQuery<T> {
  const options: LiveQueryOptions = second === undefined || Array.isArray(second) ? {} : (second as LiveQueryOptions)
  const pollMs = options.pollMs
  const revision = options.revision ?? null
  const [attempt, setAttempt] = useState(0)
  // Results are kept with the query they answer, so a new query never shows the old one's data.
  const query = useMemo(() => ({ fetcher, attempt }), [fetcher, attempt])
  const [state, setState] = useState<QueryState<T> & { query?: typeof query }>({})
  const reload = useRef<() => void>(() => {})

  useEffect(() => {
    let cancelled = false
    let inFlight = false
    let queued = false
    let failures = 0
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let pollTimer: ReturnType<typeof setTimeout> | undefined

    const load = () => {
      if (cancelled) return
      if (inFlight) {
        queued = true
        return
      }
      inFlight = true
      clearTimeout(retryTimer)
      clearTimeout(pollTimer)
      query
        .fetcher()
        .then(
          (data) => {
            if (cancelled) return
            failures = 0
            setState({ query, data })
            if (pollMs !== undefined && pollMs > 0) pollTimer = setTimeout(load, pollMs)
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
    reload.current = load
    load()

    const onVisible = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', load)

    return () => {
      cancelled = true
      clearTimeout(retryTimer)
      clearTimeout(pollTimer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', load)
    }
  }, [query, pollMs])

  // A new revision reloads the same query: what is on screen stays until the answer lands.
  const loadedRevision = useRef(revision)
  useEffect(() => {
    if (loadedRevision.current === revision) return
    loadedRevision.current = revision
    reload.current()
  }, [revision])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  const current = state.query === query ? state : {}
  return { data: current.data, error: current.error, retry }
}
