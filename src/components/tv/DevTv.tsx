import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import NotFound from '@/pages/NotFound'
import { AFTER_NEWS_MS, devTv, NEWS, TV_SCENES } from '@/components/tv/devFixture'
import PairingScreen from '@/components/tv/PairingScreen'
import { PICTURE_PARAM } from '@/components/tv/picture'
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
  // The picture is the TV page's (picture.ts): taking ?picture= off the address never restarts the scene.
  const params = new URLSearchParams(search)
  params.delete(PICTURE_PARAM)
  const scene = params.toString()
  return <Fixture key={scene} scene={scene} />
}

function Fixture({ scene }: { scene: string }) {
  const search = useMemo(() => new URLSearchParams(scene), [scene])
  const setup = useMemo(() => devTv(search), [search])
  const [now, setNow] = useState<'first' | 'later' | 'after' | 'paired'>('first')

  useEffect(() => {
    if (!setup?.later) return
    const timer = setTimeout(() => setNow((state) => (state === 'first' ? 'later' : state)), 1500)
    // With news and then: the party moves on a while after the news.
    const after = setup.after ? setTimeout(() => setNow((state) => (state === 'later' ? 'after' : state)), 1500 + AFTER_NEWS_MS) : undefined
    return () => {
      clearTimeout(timer)
      clearTimeout(after)
    }
  }, [setup])

  if (!setup) {
    return (
      <NotFound title="No such fixture">
        Scenes: {[...FIXTURE_SCENES, ...TV_SCENES].join(', ')}. Add players=8, 24 or 45, fresh=1, later=200, host=1, then=(a scene), or news=
        {NEWS.join('|')}.
      </NotFound>
    )
  }

  const snapshot =
    now === 'paired' ? setup.paired : now === 'after' && setup.after ? setup.after : now !== 'first' && setup.later ? setup.later : setup.snapshot
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
