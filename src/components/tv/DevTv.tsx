import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import NotFound from '@/pages/NotFound'
import { devTv, NEWS, TV_SCENES } from '@/components/tv/devFixture'
import PairingScreen from '@/components/tv/PairingScreen'
import TvScreen from '@/components/tv/TvScreen'
import { FIXTURE_SCENES, FIXTURE_SESSION_ID } from '@/lib/fixtures'
import { LiveSessionProvider } from '@/lib/useLive'

/** The pairing screen's sample code in a fixture: any other code is refused with the server's words. */
const SAMPLE_CODE = 'TV2026'

/**
 * Dev builds only: the TV page on a fixture (?fixture=<scene>, see
 * devFixture.ts), with no network. Loaded lazily, so production never
 * downloads the fixtures.
 */
export default function DevTv() {
  const [search] = useSearchParams()
  return <Fixture key={search.toString()} search={search} />
}

function Fixture({ search }: { search: URLSearchParams }) {
  const setup = useMemo(() => devTv(search), [search])
  const [now, setNow] = useState<'first' | 'later' | 'paired'>('first')

  useEffect(() => {
    if (!setup?.later) return
    const timer = setTimeout(() => setNow((state) => (state === 'first' ? 'later' : state)), 1500)
    return () => clearTimeout(timer)
  }, [setup])

  if (!setup) {
    return (
      <NotFound title="No such fixture">
        Scenes: {[...FIXTURE_SCENES, ...TV_SCENES].join(', ')}. Add players=8, 24 or 45, fresh=1, later=200, host=1, or news=
        {NEWS.join('|')}.
      </NotFound>
    )
  }

  const snapshot = now === 'paired' ? setup.paired : now === 'later' && setup.later ? setup.later : setup.snapshot
  async function pair(code: string) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    if (code !== SAMPLE_CODE) throw new Error('That code is wrong or has expired. Get a new one from the host page.')
    setTimeout(() => setNow('paired'), 900)
  }

  return (
    <LiveSessionProvider sessionId={FIXTURE_SESSION_ID} screen="tv" fixture={snapshot}>
      {snapshot.member && snapshot.session ? (
        <TvScreen hostPreview={setup.hostPreview} fixtureRecap={setup.recap} recapSlide={Number(search.get('slide')) || 0} />
      ) : (
        <PairingScreen partyName={setup.partyName} onPair={pair} />
      )}
    </LiveSessionProvider>
  )
}
