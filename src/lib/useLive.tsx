/* eslint-disable react-refresh/only-export-components -- the provider and the hooks that read it are one module (docs/engine-v2.md, 5.1) */
// One live session per page (docs/engine-v2.md, 5.4 and 5.6): the
// LiveSessionProvider joins the party's channels, reads the snapshot when
// pinged, and useLive() and useServerNow() read from it. Screens mount one provider; the
// award page mounts its own, beside or inside another, and they share channels.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createLiveSession, type LiveEnvironment, type LiveState, type Screen } from '@/lib/live'
import { PlayerPhotosProvider } from '@/lib/photos'
import { supabase } from '@/lib/supabase'
import type { Snapshot, Tallies } from '@/lib/types'
import type { LiveQuery } from '@/lib/useLiveQuery'

export type LiveValue = {
  /** For QueryGate: undefined while loading, null when the party doesn't exist, else the snapshot. */
  query: LiveQuery<Snapshot | null>
  snapshot: Snapshot | undefined
  tallies: Tallies
  connected: boolean
  pings: 'ok' | 'unhealthy'
  moved: boolean
  /** Now by the database clock: for every countdown and the 3-minute final screen. */
  serverNow: () => number
  /** Reads the snapshot again now, e.g. after this screen's own successful call (it gets no ping for it). */
  refresh: () => void
}

const LiveContext = createContext<LiveValue | null>(null)

const IDLE: LiveState = { tallies: {}, connected: false, pings: 'ok', moved: false }

const browserEnvironment: LiveEnvironment = {
  onVisible(listener) {
    const onChange = () => {
      if (document.visibilityState === 'visible') listener()
    }
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  },
  onOnline(listener) {
    window.addEventListener('online', listener)
    return () => window.removeEventListener('online', listener)
  },
}

export function LiveSessionProvider({
  sessionId,
  screen,
  playerId = null,
  fixture,
  children,
}: {
  sessionId: string
  screen: Screen
  playerId?: string | null
  /** Render this snapshot with no network (5.11): refresh does nothing, serverNow runs from fixture.now. */
  fixture?: Snapshot
  children: ReactNode
}) {
  const key = `${sessionId}|${screen}|${playerId ?? ''}`
  const [live, setLive] = useState<{ key: string; state: LiveState } | null>(null)
  const session = useRef<{ refresh(): void; serverNow(): number } | null>(null)
  const fixtureClock = useRef<{ fixture: Snapshot; startedAt: number } | null>(null)

  useEffect(() => {
    if (fixture) return
    const created = createLiveSession(
      supabase,
      { sessionId, screen, playerId, environment: browserEnvironment },
      (state) => setLive({ key, state }),
    )
    session.current = created
    return () => {
      created.close()
      if (session.current === created) session.current = null
    }
  }, [fixture, key, sessionId, screen, playerId])

  const serverNow = useCallback(() => {
    if (fixture) {
      // The fixture's clock starts at fixture.now and runs from the first time it is read.
      if (fixtureClock.current?.fixture !== fixture) fixtureClock.current = { fixture, startedAt: Date.now() }
      return fixture.now + (Date.now() - fixtureClock.current.startedAt)
    }
    return session.current?.serverNow() ?? Date.now()
  }, [fixture])
  const refresh = useCallback(() => session.current?.refresh(), [])

  const fixtureState = useMemo<LiveState | null>(
    () => (fixture ? { snapshot: fixture, tallies: fixture.tallies, connected: true, pings: 'ok', moved: fixture.moved === true } : null),
    [fixture],
  )
  const state = fixtureState ?? (live?.key === key ? live.state : IDLE)

  const value = useMemo<LiveValue>(() => {
    const snapshot = state.snapshot
    return {
      query: {
        data: snapshot === undefined ? undefined : snapshot.exists ? snapshot : null,
        error: snapshot === undefined ? state.error : undefined,
        retry: refresh,
      },
      snapshot,
      tallies: state.tallies,
      connected: state.connected,
      pings: state.pings,
      moved: state.moved,
      serverNow,
      refresh,
    }
  }, [state, serverNow, refresh])

  return (
    <LiveContext.Provider value={value}>
      <PlayerPhotosProvider players={state.snapshot?.players}>{children}</PlayerPhotosProvider>
    </LiveContext.Provider>
  )
}

/** The nearest provider's live session. Throws outside a provider. */
export function useLive(): LiveValue {
  const value = useContext(LiveContext)
  if (!value) throw new Error('useLive() needs a <LiveSessionProvider> above it')
  return value
}

/** Re-renders every `ms` (default 1000) with the current server time: countdowns, the final screen window. */
export function useServerNow(ms = 1000): number {
  const { serverNow } = useLive()
  const [now, setNow] = useState(serverNow)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    // Ticks on the server clock's whole intervals, so every screen's countdown moves at the same moment.
    const next = () => {
      timer = setTimeout(
        () => {
          setNow(serverNow())
          next()
        },
        ms - (serverNow() % ms) || ms,
      )
    }
    next()
    return () => clearTimeout(timer)
  }, [serverNow, ms])
  return now
}
