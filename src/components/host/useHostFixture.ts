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
  /** False while the fixtures load. */
  ready: boolean
}

export function useHostFixture(): HostFixture {
  const [params] = useSearchParams()
  const scene = loadFixtures ? params.get('fixture') : null
  const [loaded, setLoaded] = useState<{ scene: string; snapshot: Snapshot | undefined } | null>(null)

  useEffect(() => {
    if (!loadFixtures || !scene) return
    let cancelled = false
    void loadFixtures().then(({ fixtureSnapshot, isFixtureScene }) => {
      if (!cancelled) setLoaded({ scene, snapshot: isFixtureScene(scene) ? fixtureSnapshot(scene, 'host') : undefined })
    })
    return () => {
      cancelled = true
    }
  }, [scene])

  if (!scene) return { scene: null, snapshot: undefined, ready: true }
  const current = loaded?.scene === scene ? loaded : null
  return { scene, snapshot: current?.snapshot, ready: current !== null }
}
