import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { Loading } from '@/components/layout'
import QueryGate from '@/components/QueryGate'
import PairingScreen from '@/components/tv/PairingScreen'
import { OTHER_PARTY } from '@/components/tv/pairing'
import { useTvPicture } from '@/components/tv/picture'
import TvScreen from '@/components/tv/TvScreen'
import { preloadTvScreens } from '@/games/registry'
import { ensureSignedIn, isHost } from '@/lib/auth'
import { claimScreen, sessionByCode } from '@/lib/queries'
import { useScreenWakeLock } from '@/lib/screenWakeLock'
import { useAnnounceTvTab } from '@/lib/tvTab'
import type { PublicSession } from '@/lib/types'
import { LiveSessionProvider, useLive } from '@/lib/useLive'
import { useLiveQuery } from '@/lib/useLiveQuery'
import { useWakeSync } from '@/lib/wakeSync'
import NotFound from '@/pages/NotFound'

// Dev builds only: ?fixture=<scene> renders a fixture (docs/engine-v2.md, 5.11).
// In production the condition is false at build time, so the fixtures are never bundled.
const DevTv = import.meta.env.DEV ? lazy(() => import('@/components/tv/DevTv')) : null

/**
 * The TV (`/tv/:joinCode`, docs/engine-v2.md 7.2): a public page for the laptop
 * by the TV. It signs in anonymously and reads exactly what a guest reads, so
 * nothing in the room can open the control room or read a secret. Until the
 * host pairs it, it shows the pairing screen; a host's own browser skips
 * pairing and says "Host preview", except with ?mirror=1: the host page's "Show
 * the TV here" for when no second device can be paired, a tab the host casts or
 * moves to the TV. Every TV, that tab included, shows its own picture,
 * Standard or Brighter (picture.ts), set in the corner or with ?picture=bright.
 */
export default function Scoreboard() {
  const joinCode = (useParams().joinCode ?? '').trim().toUpperCase()
  const [search] = useSearchParams()
  useTvPicture()
  if (DevTv && search.has('fixture')) {
    return (
      <Suspense fallback={<Loading />}>
        <DevTv />
      </Suspense>
    )
  }
  return <Tv key={joinCode} joinCode={joinCode} mirror={search.has('mirror')} />
}

function Tv({ joinCode, mirror }: { joinCode: string; mirror: boolean }) {
  // Guests share the venue's one IP: the anonymous sign-in may wait out a rate limit (5.9).
  const [busy, setBusy] = useState(false)
  const lookup = useCallback(async () => {
    await ensureSignedIn({ onBusy: () => setBusy(true) })
    const party = await sessionByCode(joinCode)
    if (!party) return null
    // A host's own browser is a member through is_host() and skips pairing.
    const host = await isHost().catch(() => false)
    return { party, host }
  }, [joinCode])
  const query = useLiveQuery(lookup)

  return (
    <>
      {busy && query.data === undefined && !query.error && <BusyNote />}
      <QueryGate query={query} notFound={<TvNotFound joinCode={joinCode} />}>
        {({ party, host }) => (
          <LiveSessionProvider sessionId={party.id} screen="tv">
            <PairedTv party={party} host={host} mirror={mirror} />
          </LiveSessionProvider>
        )}
      </QueryGate>
    </>
  )
}

/** The TV scene once this screen may read the party (paired, or a host's own browser); the pairing screen until then. */
function PairedTv({ party, host, mirror }: { party: PublicSession; host: boolean; mirror: boolean }) {
  const { query, refresh } = useLive()
  // The TV sends each live game's timer sync 250 ms after its wake_at (4.5, 5.10).
  useWakeSync({ delayMs: 250 })
  // It runs all evening: no dimming or sleep while it shows.
  useScreenWakeLock()
  // Deploys included: every game's TV screens load now, while their files are on the site.
  useEffect(() => preloadTvScreens(), [])
  // In a host's own browser, the control room shows "TV open in this browser".
  useAnnounceTvTab(party.join_code, host)

  const pair = useCallback(
    async (code: string) => {
      const sessionId = await claimScreen(code)
      if (sessionId !== party.id) throw new Error(OTHER_PARTY)
      // The read now says member: the channels join and the TV scene replaces this screen.
      refresh()
    },
    [party.id, refresh],
  )

  return (
    <QueryGate query={query} notFound={<TvNotFound joinCode={party.join_code} />}>
      {(snapshot) =>
        snapshot.member && snapshot.session ? (
          <TvScreen hostPreview={host && !mirror} />
        ) : (
          // Unpaired by the host, the next read says member: false and the TV comes back here by itself.
          <PairingScreen partyName={party.name} onPair={pair} />
        )
      }
    </QueryGate>
  )
}

function TvNotFound({ joinCode }: { joinCode: string }) {
  return (
    <NotFound title="Party not found" back="start">
      There's no party with the code {joinCode || 'in this link'}. It may have been deleted, or the link is wrong: open
      the TV link from the host page.
    </NotFound>
  )
}

/** Over the loader while the sign-in waits out a rate limit: calm words, never the error notice. */
function BusyNote() {
  return (
    <p role="status" className="fixed inset-x-0 bottom-[28%] z-70 px-6 text-center text-xl text-muted-foreground">
      Lots of guests arriving, one moment
    </p>
  )
}
