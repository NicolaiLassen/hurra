/* eslint-disable react-refresh/only-export-components -- the provider and the hooks that read it are one module (docs/engine-v2.md, 5.1) */
// One live session per page (docs/engine-v2.md, 5.4 and 5.6): the
// LiveSessionProvider joins the party's channels, reads the snapshot when
// pinged, and every hook below reads from it. Screens mount one provider; the
// award page mounts its own, beside or inside another, and they share channels.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createLiveSession, type LiveEnvironment, type LiveState, type Screen } from '@/lib/live'
import { gamePointsOf, myAnswersOf, promptsOf, talliesOf } from '@/lib/stage'
import { supabase } from '@/lib/supabase'
import type {
  AnswerPayload,
  FeedItem,
  Player,
  PromptState,
  ScoreRow,
  Session,
  SessionGame,
  Snapshot,
  Tallies,
} from '@/lib/types'
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

type Provided = LiveValue & { sessionId: string; screen: Screen; parent: Provided | null }

const LiveContext = createContext<Provided | null>(null)

const IDLE: LiveState = { tallies: {}, connected: false, pings: 'ok', moved: false }
const NOTHING: Readonly<Record<string, never>> = Object.freeze({})
const NO_PROMPTS: PromptState[] = []

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
  const parent = useContext(LiveContext)
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
    () => (fixture ? { snapshot: fixture, tallies: fixture.tallies, connected: true, pings: 'ok', moved: false } : null),
    [fixture],
  )
  const state = fixtureState ?? (live?.key === key ? live.state : IDLE)

  const value = useMemo<Provided>(() => {
    const snapshot = state.snapshot
    return {
      sessionId,
      screen,
      parent,
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
  }, [state, sessionId, screen, parent, serverNow, refresh])

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>
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

// The v1 hooks, adapted: same names and parameters, read from the provider ----------

/** The provider for this party: the nearest one, or one further up. */
function useLiveFor(sessionId: string, hook: string): Provided {
  const nearest = useContext(LiveContext)
  for (let provided = nearest; provided; provided = provided.parent) {
    if (provided.sessionId === sessionId) return provided
  }
  throw new Error(`${hook}(${sessionId}) needs a <LiveSessionProvider sessionId="${sessionId}"> above it`)
}

/** The nearest provider, whichever party it is for. */
function useNearest(hook: string): Provided {
  const nearest = useContext(LiveContext)
  if (!nearest) throw new Error(`${hook}() needs a <LiveSessionProvider> above it`)
  return nearest
}

/** A LiveQuery of a value picked from the snapshot: `data` must be stable while the snapshot is. */
function useQueryOf<T>(live: Provided, data: T | undefined): LiveQuery<T> {
  const error = live.snapshot === undefined ? live.query.error : undefined
  const { refresh } = live
  return useMemo(() => ({ data, error, retry: refresh }), [data, error, refresh])
}

/** The party; null when it doesn't exist or this screen can't read it (not a member). */
export function useSession(sessionId: string): LiveQuery<Session | null> {
  const live = useLiveFor(sessionId, 'useSession')
  return useQueryOf(live, live.snapshot === undefined ? undefined : live.snapshot.session)
}

/** The party's games, by position. */
export function useSessionGames(sessionId: string): LiveQuery<SessionGame[]> {
  const live = useLiveFor(sessionId, 'useSessionGames')
  return useQueryOf(live, live.snapshot?.games)
}

/** The party's players, by join time. */
export function usePlayers(sessionId: string): LiveQuery<Player[]> {
  const live = useLiveFor(sessionId, 'usePlayers')
  return useQueryOf(live, live.snapshot?.players)
}

/** The day's standings: points highest first, then name. */
export function useScoreboard(sessionId: string): LiveQuery<ScoreRow[]> {
  const live = useLiveFor(sessionId, 'useScoreboard')
  return useQueryOf(live, live.snapshot?.standings)
}

/** A player's points on the day's scoreboard (0 when they have none). */
export function usePlayerPoints(playerId: string): LiveQuery<number> {
  const live = useNearest('usePlayerPoints')
  const standings = live.snapshot?.standings
  return useQueryOf(live, standings === undefined ? undefined : (standings.find((r) => r.player_id === playerId)?.points ?? 0))
}

/** The newest announcements (at most 12), newest first; `everyoneOnly` skips ones aimed at specific players. */
export function useFeed(
  sessionId: string,
  { limit = 5, everyoneOnly = false }: { limit?: number; everyoneOnly?: boolean } = {},
): LiveQuery<FeedItem[]> {
  const live = useLiveFor(sessionId, 'useFeed')
  const feed = live.snapshot?.feed
  const data = useMemo(
    () => feed?.filter((item) => !everyoneOnly || item.audience === null).slice(0, limit),
    [feed, limit, everyoneOnly],
  )
  return useQueryOf(live, data)
}

/** This phone's own view of a game; null when it has none (a phone screen only). */
export function usePlayerGameView(gameId: string, playerId: string): LiveQuery<unknown> {
  const live = useNearest('usePlayerGameView')
  const snapshot = live.snapshot
  const me = snapshot?.me
  return useQueryOf(live, snapshot === undefined ? undefined : me && me.player_id === playerId ? (me.views[gameId] ?? null) : null)
}

/** A live game's full state; null when there is none or this isn't the host screen. */
export function useGameState(gameId: string): LiveQuery<unknown> {
  const live = useNearest('useGameState')
  const snapshot = live.snapshot
  return useQueryOf(live, snapshot === undefined ? undefined : (snapshot.states?.[gameId]?.state ?? null))
}

// Selectors for game views' props ----------------------------------------------------

/** Answers in so far, by unrevealed prompt key. */
export function useTallies(gameId: string): Readonly<Record<string, number>> {
  return talliesOf(useNearest('useTallies').tallies, gameId)
}

/** This game's prompts (this round). */
export function usePrompts(gameId: string): PromptState[] {
  const snapshot = useNearest('usePrompts').snapshot
  return useMemo(() => (snapshot ? promptsOf(snapshot, gameId) : NO_PROMPTS), [snapshot, gameId])
}

/** This round's points per player: its scores plus its awards and bonuses. */
export function useGamePoints(gameId: string): Readonly<Record<string, number>> {
  const snapshot = useNearest('useGamePoints').snapshot
  return snapshot ? gamePointsOf(snapshot, gameId) : NOTHING
}

/** This phone's own answers to the game's prompts, by key, read back after a reload. */
export function useMyAnswers(gameId: string): Readonly<Record<string, AnswerPayload>> {
  const snapshot = useNearest('useMyAnswers').snapshot
  return snapshot ? myAnswersOf(snapshot, gameId) : NOTHING
}
