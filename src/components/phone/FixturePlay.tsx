import { useMemo } from 'react'
import { FixtureMode } from '@/components/phone/calls'
import PhoneHome from '@/components/phone/PhoneHome'
import {
  FIXTURE_PLAYER_ID,
  FIXTURE_SCENES,
  FIXTURE_SESSION_ID,
  fixtureRecapDoc,
  fixtureSnapshot,
  isFixtureScene,
} from '@/lib/fixtures'
import { LiveSessionProvider } from '@/lib/useLive'
import NotFound from '@/pages/NotFound'

/**
 * The phone home over a fixture (docs/engine-v2.md, 5.11): /play/<any>?fixture=<scene>
 * in dev builds shows a sample party as Sofie sees it, with no network. Taps
 * that would call the server pretend to succeed. Loaded lazily, so production
 * bundles never carry the fixtures.
 */
export default function FixturePlay({ scene }: { scene: string }) {
  const snapshot = useMemo(() => (isFixtureScene(scene) ? fixtureSnapshot(scene, 'phone') : null), [scene])
  const lobby = useMemo(() => fixtureSnapshot('lobby', 'phone'), [])
  const recap = useMemo(() => fixtureRecapDoc(), [])

  if (!snapshot || !lobby.session) {
    return <NotFound title="No such fixture">Try one of these scenes: {FIXTURE_SCENES.join(', ')}.</NotFound>
  }
  const player = lobby.players.find((p) => p.id === FIXTURE_PLAYER_ID) ?? { id: FIXTURE_PLAYER_ID, name: 'Sofie' }

  return (
    <FixtureMode value>
      <LiveSessionProvider sessionId={FIXTURE_SESSION_ID} screen="phone" playerId={FIXTURE_PLAYER_ID} fixture={snapshot}>
        <PhoneHome party={lobby.session} player={player} fixtureRecap={recap} />
      </LiveSessionProvider>
    </FixtureMode>
  )
}
