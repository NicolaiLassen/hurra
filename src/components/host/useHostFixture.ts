import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { Snapshot } from '@/lib/types'

// Dev builds only (docs/engine-v2.md, 5.11): `?fixture=<scene>` renders a
// sample snapshot instead of the live party, so the host page can be built and
// checked before a party is running. A constant false in production builds, so
// the fixtures never ship.
const loadFixtures = import.meta.env.DEV ? () => import('@/lib/fixtures') : null

export type HostFixture = {
  /** The scene asked for, or null for the live party. */
  scene: string | null
  /** The scene's snapshot as the host page reads it; undefined for the live party or an unknown scene. */
  snapshot: Snapshot | undefined
  /** The scene's game settings by game id, as game_settings would hold them; undefined for the live party. */
  settings: Record<string, Record<string, unknown>> | undefined
  /** False while the fixtures load. */
  ready: boolean
}

export function useHostFixture(): HostFixture {
  const [params] = useSearchParams()
  const scene = loadFixtures ? params.get('fixture') : null
  const [loaded, setLoaded] = useState<{
    scene: string
    snapshot: Snapshot | undefined
    settings: Record<string, Record<string, unknown>> | undefined
  } | null>(null)

  useEffect(() => {
    if (!loadFixtures || !scene) return
    let cancelled = false
    void loadFixtures().then(({ fixtureSettings, fixtureSnapshot, isFixtureScene }) => {
      if (cancelled) return
      const known = isFixtureScene(scene)
      setLoaded({ scene, snapshot: known ? fixtureSnapshot(scene, 'host') : undefined, settings: known ? fixtureSettings(scene) : undefined })
    })
    return () => {
      cancelled = true
    }
  }, [scene])

  if (!scene) return { scene: null, snapshot: undefined, settings: undefined, ready: true }
  const current = loaded?.scene === scene ? loaded : null
  return { scene, snapshot: current?.snapshot, settings: current?.settings, ready: current !== null }
}
