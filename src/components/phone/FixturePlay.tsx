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
import type { Player, Snapshot } from '@/lib/types'
import NotFound from '@/pages/NotFound'

const EXTRA_NAMES = [
  'Asta', 'Alma', 'Agnes', 'Anton', 'August', 'Bertram', 'Carl', 'Christoffer Bjørnskov', 'Dagmar', 'Ella', 'Esther',
  'Felix', 'Frida', 'Frederik', 'Gustav', 'Hannah', 'Ingrid', 'Johan', 'Josefine', 'Karla', 'Konrad', 'Liva', 'Laura',
  'Lucas', 'Luna', 'Magnus', 'Malthe', 'Marie-Louise Christensen', 'Mathilde', 'Nora', 'Olivia', 'Otto', 'Silje',
]
const extraId = (n: number) => `f1c7a000-0000-4000-8000-${String(8000 + n).padStart(12, '0')}`

/**
 * The phone's party with `size` guests (`&players=1|12|45`): Sofie always, with
 * the fixture's first others, or more after them. A live round of Last one
 * standing deals the newcomers in. Sample data for dev builds only.
 */
function resize(s: Snapshot, size: number): Snapshot {
  if (!s.session || size < 1) return s
  const me = s.players.find((p) => p.id === FIXTURE_PLAYER_ID)
  const others = s.players.filter((p) => p.id !== FIXTURE_PLAYER_ID).slice(0, size - 1)
  const kept = me ? [...others.slice(0, Math.max(0, size - 1)), me] : others
  const extra: Player[] = []
  for (let n = 0; kept.length + extra.length < size; n++) {
    const name = EXTRA_NAMES[n % EXTRA_NAMES.length] + (n >= EXTRA_NAMES.length ? ` ${Math.floor(n / EXTRA_NAMES.length) + 1}` : '')
    extra.push({ id: extraId(n), name, code: `X${String(n).padStart(4, '0')}`, profile: {}, created_at: s.now - (60 - n) * 60_000 })
  }
  const players = [...kept, ...extra]
  const ids = new Set(players.map((p) => p.id))
  const standings = [
    ...s.standings.filter((row) => ids.has(row.player_id)),
    ...extra.map((p, n) => ({ player_id: p.id, name: p.name, code: p.code, points: (n * 7) % 13, profile: p.profile })),
  ].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))
  const newIds = extra.map((p) => p.id)
  const games = s.games.map((g) => {
    const pub = g.public_state as { alive?: unknown; out?: unknown; winner?: unknown } | null
    if (!pub || !Array.isArray(pub.alive) || !Array.isArray(pub.out) || pub.winner) return g
    const keep = (list: unknown[]) => list.filter((id): id is string => typeof id === 'string' && ids.has(id))
    return { ...g, public_state: { ...pub, alive: [...keep(pub.alive), ...newIds], out: keep(pub.out) } }
  })
  return { ...s, players, standings, games }
}

/**
 * The phone home over a fixture (docs/engine-v2.md, 5.11): /play/<any>?fixture=<scene>
 * in dev builds shows a sample party as Sofie sees it, with no network
 * (&players=<n> for the party's size, &photos for drawn faces). Taps
 * that would call the server pretend to succeed. Loaded lazily, so production
 * bundles never carry the fixtures.
 */
export default function FixturePlay({ scene, players: size = null }: { scene: string; players?: number | null }) {
  const snapshot = useMemo(() => {
    if (!isFixtureScene(scene)) return null
    const s = fixtureSnapshot(scene, 'phone')
    return size !== null && Number.isInteger(size) && size > 0 ? resize(s, size) : s
  }, [scene, size])
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
