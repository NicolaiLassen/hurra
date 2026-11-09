import { lazy, Suspense, useCallback, useRef } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router'
import { Loading } from '@/components/layout'
import { isBusyError, useBusySignIn } from '@/components/phone/busy'
import BusyScreen from '@/components/phone/BusyScreen'
import PhoneHome from '@/components/phone/PhoneHome'
import QueryGate from '@/components/QueryGate'
import { loadMembership, type Membership } from '@/lib/queries'
import { LiveSessionProvider } from '@/lib/useLive'
import { useLiveQuery } from '@/lib/useLiveQuery'
import { PartyNotFound } from '@/pages/NotFound'

// Dev builds only: ?fixture=<scene> shows a sample party with no network (docs/engine-v2.md, 5.11).
const FixturePlay = import.meta.env.DEV ? lazy(() => import('@/components/phone/FixturePlay')) : null

/**
 * The phone (docs/engine-v2.md, 7.1): finds this browser's player in the
 * party, signing in first (with the calm busy state while the sign-in waits
 * out a rate limit), then the live phone home. Not a player here: the join page.
 */
export default function Play() {
  const code = (useParams().joinCode ?? '').toUpperCase()
  const [params] = useSearchParams()
  const scene = params.get('fixture')

  if (FixturePlay && scene !== null) {
    return (
      <Suspense fallback={<Loading />}>
        <FixturePlay scene={scene} />
      </Suspense>
    )
  }
  return <LivePlay key={code} code={code} />
}

function LivePlay({ code }: { code: string }) {
  const { busy, signIn } = useBusySignIn()
  // Read once. From then on the live snapshot says whether this phone is still
  // in the party, so waking the phone after the host removed the player (or it
  // moved to another phone) says so, instead of jumping to the join page.
  const found = useRef<Promise<Membership | null> | null>(null)
  const load = useCallback(() => {
    if (!found.current) {
      const membership = signIn().then(() => loadMembership(code))
      // A failed read is tried again from scratch.
      membership.catch(() => {
        if (found.current === membership) found.current = null
      })
      found.current = membership
    }
    return found.current
  }, [code, signIn])
  const membership = useLiveQuery(load)

  if (membership.data === undefined && (busy || isBusyError(membership.error))) return <BusyScreen />
  return (
    <QueryGate query={membership} notFound={<PartyNotFound code={code} />}>
      {({ session, player }) =>
        player ? (
          <LiveSessionProvider sessionId={session.id} screen="phone" playerId={player.id}>
            <PhoneHome party={session} player={player} />
          </LiveSessionProvider>
        ) : (
          <Navigate to={`/join/${session.join_code}`} replace />
        )
      }
    </QueryGate>
  )
}
