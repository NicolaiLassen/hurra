/* eslint-disable react-refresh/only-export-components -- the provider and the hooks that read it are one module */
// Every game's saved settings for the control room, read in one go, so each
// row in the Games panel can say whether its game is ready (GameModule.setupStatus)
// and the settings page opens on them at once. game_settings is not in the
// party's snapshot (hosts only, and no ping tells of a change), so the room
// reads it as it opens, when a game is added, and when the tab comes back
// into view; a save here updates it at once. A fixture scene (dev builds)
// brings its own settings and saves them in memory only.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { errorMessage } from '@/components/host/hostCalls'
import { roomStep, type Readiness, type RoomStep } from '@/components/host/scene'
import { configOf, getGameModule, setupStatusOf, startProblemOf } from '@/games/registry'
import type { SetupStatus } from '@/games/types'
import { guestsOf } from '@/lib/guestList'
import { readGamesSettings, saveGameSettings } from '@/lib/queries'
import { tvScene } from '@/lib/stage'
import { useTvTabOpen } from '@/lib/tvTab'
import type { Snapshot } from '@/lib/types'
import { useServerNow } from '@/lib/useLive'

type Saved = Record<string, unknown> | null

/** Where the settings come from: the database, or a fixture scene's own (dev builds, saved in memory). */
export type SettingsSource = { kind: 'live' } | { kind: 'fixture'; settings: Readonly<Record<string, Record<string, unknown>>> }

export type ProgramSettings = {
  /** A game's saved settings: undefined while they are read, null when none were saved (or they couldn't be read). */
  saved: (gameId: string) => Saved | undefined
  /** Its readiness from them: undefined while they are read, null when the game says nothing. */
  status: Readiness
  /** What the game's own check says about starting with them (parseConfig), or null when it would start. */
  startProblem: (gameId: string) => string | null
  /** The read failed: its words, until a retry reads them. */
  error: string | null
  retry: () => void
  /** Saves a game's settings and keeps them here, so its row says at once what changed. */
  save: (gameId: string, config: Record<string, unknown>) => Promise<void>
}

/** Outside a control room (no provider): nothing is known, so nothing is held back. */
const NOTHING: ProgramSettings = {
  saved: () => null,
  status: () => null,
  startProblem: () => null,
  error: null,
  retry: () => {},
  save: async (gameId, config) => saveGameSettings(gameId, config),
}

const ProgramSettingsContext = createContext<ProgramSettings>(NOTHING)

export function ProgramSettingsProvider({ snapshot, source, children }: { snapshot: Snapshot; source: SettingsSource; children: ReactNode }) {
  const ids = useMemo(() => snapshot.games.map((g) => g.id).sort(), [snapshot.games])
  const key = ids.join(',')
  // What was read, and what was saved here since: a save wins over a read that started before it.
  const [read, setRead] = useState<Record<string, Saved>>({})
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const saves = useRef(new Map<string, number>())
  const live = source.kind === 'live'

  useEffect(() => {
    if (!live) return
    let cancelled = false
    const wanted = key === '' ? [] : key.split(',')
    const before = new Map(wanted.map((id) => [id, saves.current.get(id) ?? 0]))
    readGamesSettings(wanted).then(
      (settings) => {
        if (cancelled) return
        setError(null)
        setRead((current) => {
          const next = { ...current }
          for (const id of wanted) if ((saves.current.get(id) ?? 0) === before.get(id)) next[id] = settings[id] ?? null
          return next
        })
      },
      (failure: unknown) => {
        if (!cancelled) setError(errorMessage(failure))
      },
    )
    return () => {
      cancelled = true
    }
  }, [live, key, attempt])

  // Another device may have changed them meanwhile: read them again when the tab comes back.
  useEffect(() => {
    if (!live) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') setAttempt((n) => n + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [live])

  const fixture = source.kind === 'fixture' ? source.settings : null
  const saved = useCallback(
    (gameId: string): Saved | undefined => {
      if (gameId in read) return read[gameId]
      if (fixture) return fixture[gameId] ?? null
      // Unreadable: nothing is known, so the room holds nothing back.
      return error !== null ? null : undefined
    },
    [read, fixture, error],
  )

  const guests = useMemo(() => guestsOf(snapshot), [snapshot])
  const derived = useMemo(() => {
    const status = new Map<string, SetupStatus | null | undefined>()
    const problems = new Map<string, string | null>()
    for (const game of snapshot.games) {
      const settings = saved(game.id)
      const gameModule = getGameModule(game.game_type)
      status.set(game.id, settings === undefined ? undefined : setupStatusOf(game.game_type, settings, guests))
      problems.set(game.id, gameModule && settings !== undefined ? startProblemOf(gameModule, configOf(gameModule, settings)) : null)
    }
    return { status, problems }
  }, [snapshot.games, saved, guests])

  const save = useCallback(
    async (gameId: string, config: Record<string, unknown>) => {
      if (live) await saveGameSettings(gameId, config)
      saves.current.set(gameId, (saves.current.get(gameId) ?? 0) + 1)
      setRead((current) => ({ ...current, [gameId]: config }))
    },
    [live],
  )

  const value = useMemo<ProgramSettings>(
    () => ({
      saved,
      status: (gameId) => (derived.status.has(gameId) ? derived.status.get(gameId) : null),
      startProblem: (gameId) => derived.problems.get(gameId) ?? null,
      error,
      retry: () => setAttempt((n) => n + 1),
      save,
    }),
    [saved, derived, error, save],
  )

  return <ProgramSettingsContext.Provider value={value}>{children}</ProgramSettingsContext.Provider>
}

/** The control room's settings: every game's saved settings and readiness. */
export function useProgramSettings(): ProgramSettings {
  return useContext(ProgramSettingsContext)
}

/**
 * The room's one gold step where the TV leaves it to the program (roomStep):
 * Pair a TV, a game's Set up or its Start. Its own clock ticks every second,
 * for a final screen that hands the TV back to the standings.
 */
export function useRoomStep(snapshot: Snapshot): RoomStep {
  const now = useServerNow(1000)
  const tvTab = useTvTabOpen(snapshot.session?.join_code ?? '')
  const { status } = useProgramSettings()
  return roomStep(snapshot, tvScene(snapshot, now), (snapshot.screens ?? 0) > 0 || tvTab, status)
}
