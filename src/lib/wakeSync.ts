// Timer syncs (docs/engine-v2.md, 4.5 and 5.10): the only code that sends them.
// A game that moves on by itself (the quiz's countdown, its leaderboard 7 s
// after a reveal) publishes when it wants a sync as session_games.wake_at. The
// TV sends one 250 ms after it, the host page 1.5 s after it as a backup, by
// the corrected server clock. Phones never send syncs. Early or repeated syncs
// save nothing, and racing ones are settled by the engine's version check.
import { useEffect, useMemo, useState } from 'react'
import { GameCallError, type EngineResponse } from '@/lib/gameApi'
import { callGame } from '@/lib/queries'
import type { SessionGame } from '@/lib/types'
import { useLive } from '@/lib/useLive'

export type WakeFailure = { gameId: string; failures: number; message: string }

/** At most one sync per game in this long. */
const MIN_GAP_MS = 2000
/** A sync answered `skipped` while wake_at is unchanged is tried once more, this much later (clock skew). */
const SKIP_RETRY_MS = 2000
/** After a failure: 2 s, 5 s, 10 s, then every 30 s, until a sync succeeds or wake_at changes. */
const BACKOFF_MS = [2000, 5000, 10_000, 30_000]
/** Failures in a row before a game is reported. */
const REPORT_AFTER = 3

type Timer = ReturnType<typeof setTimeout>

type GameTimer = {
  // Per game, kept across wake_at changes.
  inFlight: boolean
  lastSentAt: number
  // Per wake_at, reset when it changes.
  wakeAt: number
  /** A backoff or skip retry, by the server clock; otherwise the sync is due at wakeAt + delayMs. */
  retryAt: number | null
  skipRetried: boolean
  failures: number
  message: string
  /** Synced, skipped twice or refused: nothing more until wake_at changes. */
  halted: boolean
  timer?: Timer
}

/** No answer, a busy game or a server fault: worth trying again. Any other refusal (404, not_running, 403) is final. */
function worthRetrying(error: unknown): boolean {
  if (!(error instanceof GameCallError)) return true
  if (error.status === 0 || error.status >= 500) return true
  if (error.status === 409 && error.code === 'busy') return true
  // A token being refreshed, a rate limit, a gateway timeout.
  return error.status === 401 || error.status === 408 || error.status === 429
}

/** The scheduling rules of 4.5 as a plain object with injected time, so they are unit-tested with fake timers. */
export function createWakeScheduler(options: {
  delayMs: number
  /** serverNow */
  now: () => number
  /** A sync through callGame. */
  call: (gameId: string) => Promise<EngineResponse>
  /** refresh() */
  onSynced: () => void
  /** Games with 3 or more failures in a row; called whenever that list changes. */
  onFailing: (failing: WakeFailure[]) => void
}): { update(games: SessionGame[]): void; stop(): void } {
  const { delayMs, now, call, onSynced, onFailing } = options
  const games = new Map<string, GameTimer>()
  let reported = '[]'

  function report() {
    const failing = [...games]
      .filter(([, t]) => t.failures >= REPORT_AFTER)
      .map(([gameId, t]) => ({ gameId, failures: t.failures, message: t.message }))
    const key = JSON.stringify(failing)
    if (key === reported) return
    reported = key
    onFailing(failing)
  }

  const dueAt = (t: GameTimer) => Math.max(t.retryAt ?? t.wakeAt + delayMs, t.lastSentAt + MIN_GAP_MS)

  function plan(gameId: string, t: GameTimer) {
    clearTimeout(t.timer)
    t.timer = undefined
    if (t.halted || t.inFlight) return
    t.timer = setTimeout(() => void fire(gameId, t), Math.max(0, dueAt(t) - now()))
  }

  async function fire(gameId: string, t: GameTimer) {
    t.timer = undefined
    if (games.get(gameId) !== t || t.halted || t.inFlight) return
    // The server clock may have moved since this was planned.
    if (now() < dueAt(t)) return plan(gameId, t)
    const wakeAt = t.wakeAt
    t.inFlight = true
    t.lastSentAt = now()
    let response: EngineResponse | undefined
    let error: unknown
    try {
      response = await call(gameId)
    } catch (caught) {
      error = caught ?? new Error('The sync failed')
    }
    t.inFlight = false
    if (games.get(gameId) !== t) return
    if (t.wakeAt !== wakeAt) {
      // A new wake_at arrived meanwhile: its own sync is planned from scratch.
      if (response) onSynced()
      return plan(gameId, t)
    }
    if (response) {
      t.failures = 0
      t.message = ''
      t.retryAt = null
      if (response.skipped && !t.skipRetried) {
        // Nothing was due yet by the server's clock: try once more a little later.
        t.skipRetried = true
        t.retryAt = now() + SKIP_RETRY_MS
      } else {
        t.halted = true
      }
      // A lost ping never stalls the screen that synced.
      onSynced()
    } else if (worthRetrying(error)) {
      t.failures++
      t.message = error instanceof Error ? error.message : String(error)
      t.retryAt = now() + BACKOFF_MS[Math.min(t.failures, BACKOFF_MS.length) - 1]
    } else {
      // 404, 409 not_running, 403: the game is gone, over, or not ours to sync.
      t.halted = true
      t.failures = 0
      t.retryAt = null
    }
    report()
    plan(gameId, t)
  }

  return {
    update(list) {
      const due = new Map<string, number>()
      for (const g of list) if (g.status === 'active' && g.archived_at === null && g.wake_at !== null) due.set(g.id, g.wake_at)
      for (const [gameId, t] of games) {
        if (due.has(gameId)) continue
        clearTimeout(t.timer)
        games.delete(gameId)
      }
      for (const [gameId, wakeAt] of due) {
        let t = games.get(gameId)
        if (!t) {
          t = { inFlight: false, lastSentAt: -Infinity, wakeAt, retryAt: null, skipRetried: false, failures: 0, message: '', halted: false }
          games.set(gameId, t)
        } else if (t.wakeAt !== wakeAt) {
          // A new wake_at replaces the old timer, and its failures.
          Object.assign(t, { wakeAt, retryAt: null, skipRetried: false, failures: 0, message: '', halted: false })
        }
        plan(gameId, t)
      }
      report()
    },
    stop() {
      for (const t of games.values()) clearTimeout(t.timer)
      games.clear()
      report()
    },
  }
}

const syncGame = (gameId: string) => callGame({ type: 'sync', gameId })

/** Mounts the scheduler on the nearest LiveSessionProvider. TV: 250. Host page: 1500. */
export function useWakeSync(options: { delayMs: number }): { failing: WakeFailure[] } {
  const { delayMs } = options
  const { snapshot, serverNow, refresh } = useLive()
  const [failing, setFailing] = useState<WakeFailure[]>([])
  const scheduler = useMemo(
    () => createWakeScheduler({ delayMs, now: serverNow, call: syncGame, onSynced: refresh, onFailing: setFailing }),
    [delayMs, serverNow, refresh],
  )
  // stop() only clears, so StrictMode's second setup (update after stop) plans again.
  useEffect(() => () => scheduler.stop(), [scheduler])
  const games = snapshot?.member ? snapshot.games : undefined
  useEffect(() => {
    scheduler.update(games ?? [])
  }, [scheduler, games])
  return { failing }
}
