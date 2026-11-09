import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowLeftIcon,
  DownloadSimpleIcon,
  EyeSlashIcon,
  FilmStripIcon,
  InfoIcon,
  PaperPlaneTiltIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import Callout from '@/components/Callout'
import Confirm from '@/components/Confirm'
import { errorMessage, useHostCall } from '@/components/host/hostCalls'
import RecapPreview from '@/components/host/RecapPreview'
import { clockTime, downloadName, movedOnSince } from '@/components/host/recapView'
import { useHostFixture } from '@/components/host/useHostFixture'
import { Loading, LoadingPart, Screen } from '@/components/layout'
import QueryGate from '@/components/QueryGate'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { AnyGame } from '@/games/core/Game'
import { gameModules } from '@/games/registry'
import { fetchRawRecap, publishRecap, setTvScene, unpublishRecap, usePublishedRecap } from '@/lib/queries'
import { buildRecapDoc, type RawRecap } from '@/lib/recap'
import type { Snapshot } from '@/lib/types'
import { isUuid } from '@/lib/urls'
import { LiveSessionProvider, useLive } from '@/lib/useLive'
import { SessionNotFound } from '@/pages/NotFound'

/** Every game's logic, from the registry's modules: their recap() hooks write the chapters. */
const recapLogic: ReadonlyMap<string, AnyGame> = new Map(gameModules.map((m) => [m.logic.type, m.logic]))

// Dev builds only: with ?fixture=<scene>, the preview is built from a party recorded on the local stack.
const loadRecorded = import.meta.env.DEV ? () => import('@/lib/recap.recorded') : null

/**
 * The recap page (docs/engine-v2.md, 7.4): the night built from the event log
 * in this browser, previewed as the room will see it, then published to every
 * phone ("Your night") and the TV. It can be built any time: rounds still
 * running get a chapter without the game's own highlights, so publishing early
 * never gives away a live task or an answer.
 */
export default function Recap() {
  const sessionId = useParams().sessionId ?? ''
  const fixture = useHostFixture()
  if (!fixture.ready) return <Loading />
  const sample = fixture.snapshot
  if (!sample && !isUuid(sessionId)) return <SessionNotFound />
  return (
    <LiveSessionProvider sessionId={sample?.session?.id ?? sessionId} screen="host" fixture={sample}>
      <RecapGate sample={sample !== undefined} />
    </LiveSessionProvider>
  )
}

function RecapGate({ sample }: { sample: boolean }) {
  const { query } = useLive()
  return (
    <QueryGate query={query} notFound={<SessionNotFound />}>
      {(snapshot) => (snapshot.session ? <RecapPage snapshot={snapshot} sample={sample} /> : <SessionNotFound />)}
    </QueryGate>
  )
}

/** The raw night (session_recap(), hosts only), read on arrival and on Rebuild. The last one stays while the next loads. */
function useRawNight(sessionId: string, sample: boolean) {
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<{ attempt: number; raw: RawRecap | null; error: string | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    const read = sample && loadRecorded ? loadRecorded().then((m) => m.recordedRawRecap) : fetchRawRecap(sessionId)
    read.then(
      (raw) => {
        if (!cancelled) setLoaded({ attempt, raw, error: null })
      },
      (error: unknown) => {
        if (!cancelled) setLoaded((last) => ({ attempt, raw: last?.raw ?? null, error: errorMessage(error) }))
      },
    )
    return () => {
      cancelled = true
    }
  }, [sessionId, sample, attempt])

  return {
    raw: loaded?.raw ?? null,
    error: loaded?.attempt === attempt ? loaded.error : null,
    loading: loaded?.attempt !== attempt,
    rebuild: () => setAttempt((n) => n + 1),
  }
}

function download(raw: RawRecap, partyName: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(raw, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = downloadName(partyName, raw.session.created_at)
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function RecapPage({ snapshot, sample }: { snapshot: Snapshot; sample: boolean }) {
  const session = snapshot.session!
  const call = useHostCall()
  const night = useRawNight(session.id, sample)
  const doc = useMemo(() => (night.raw ? buildRecapDoc(night.raw, recapLogic) : null), [night.raw])
  const publishedAt = snapshot.recap?.published_at ?? null
  const { data: published } = usePublishedRecap(session.id, publishedAt ?? 0)
  const onTv = session.tv_scene === 'recap' && publishedAt !== null
  const [pending, setPending] = useState<string | null>(null)
  const [unpublishing, setUnpublishing] = useState(false)
  // Rows the recap would show, newer than the published one: not its own Publish, nor the TV switching to it.
  const behind = publishedAt !== null && published && night.raw ? movedOnSince(night.raw, published.generatedAt) : false
  const running = doc?.chapters.some((c) => c.finishedAt === null) ?? false

  async function run(id: string, request: () => Promise<unknown>, success?: string) {
    if (pending) return
    setPending(id)
    await call(request, success)
    setPending(null)
  }

  const publish = () =>
    doc &&
    void run(
      'publish',
      () => publishRecap(session.id, doc),
      publishedAt === null ? 'Published: every phone shows Your night' : 'Updated on every screen',
    )

  return (
    <Screen wide>
      <nav>
        <Button asChild variant="ghost" size="lg" className="-ml-3 max-w-full text-muted-foreground">
          <Link to={`/host/s/${session.id}`}>
            <ArrowLeftIcon />
            <span className="truncate">{session.name}</span>
          </Link>
        </Button>
      </nav>

      <header className="mt-4 grid gap-4">
        <div>
          <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">Recap of the night</p>
          <h1 className="mt-1 text-3xl font-bold break-words">{session.name}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {publishedAt !== null ? (
              <>
                <Badge variant="secondary">Published {clockTime(publishedAt)}</Badge>
                {onTv && <Badge>On the TV</Badge>}
                <span>Every phone shows Your night{onTv ? ' and the TV plays it on a loop' : ''}.</span>
              </>
            ) : (
              <span>Not published yet. Only you can see this preview.</span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="lg" disabled={!doc || night.loading || pending !== null} isPending={pending === 'publish'} onClick={publish}>
            <PaperPlaneTiltIcon />
            {publishedAt === null ? 'Publish' : 'Update'}
          </Button>
          {publishedAt !== null &&
            (onTv ? (
              <Button
                variant="secondary"
                size="lg"
                isPending={pending === 'party'}
                disabled={pending !== null}
                onClick={() => void run('party', () => setTvScene(session.id, 'live'))}
              >
                <ArrowCounterClockwiseIcon />
                Back to the party
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="lg"
                isPending={pending === 'tv'}
                disabled={pending !== null}
                onClick={() => void run('tv', () => setTvScene(session.id, 'recap'))}
              >
                <FilmStripIcon />
                Show on the TV
              </Button>
            ))}
          {publishedAt !== null && (
            <Button variant="ghost" size="lg" disabled={pending !== null} isPending={pending === 'unpublish'} onClick={() => setUnpublishing(true)}>
              <EyeSlashIcon />
              Unpublish
            </Button>
          )}
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <Button variant="ghost" size="lg" isPending={night.loading && night.raw !== null} onClick={night.rebuild}>
              <ArrowClockwiseIcon />
              Rebuild
            </Button>
            <Button variant="ghost" size="lg" disabled={!night.raw} onClick={() => night.raw && download(night.raw, session.name)}>
              <DownloadSimpleIcon />
              Download the night
            </Button>
          </div>
        </div>

        {behind && (
          <Callout
            tone="gold"
            icon={<InfoIcon weight="fill" />}
            title="More has happened since you published"
            detail="Update to show the latest on every phone and the TV."
          />
        )}
        {running && (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <InfoIcon className="mt-0.5 shrink-0" />
            Games still running show only who leads, so publishing now never gives away a live task or an answer.
          </p>
        )}
        {night.error && (
          <Callout
            tone="red"
            icon={<WarningCircleIcon weight="fill" />}
            title="The night couldn't be read"
            detail={night.error}
            action={
              <Button variant="secondary" onClick={night.rebuild}>
                Try again
              </Button>
            }
          />
        )}
      </header>

      <div className="mt-8">
        {doc ? (
          // While a rebuild loads, the last one stays, a little faded.
          <div className={night.loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
            {doc.generatedAt > 0 && (
              <p className="mb-4 text-xs text-muted-foreground">Built from everything up to {clockTime(doc.generatedAt)}.</p>
            )}
            <RecapPreview doc={doc} />
          </div>
        ) : (
          !night.error && <LoadingPart />
        )}
      </div>

      <Confirm
        open={unpublishing}
        onOpenChange={setUnpublishing}
        title="Unpublish the recap?"
        description={`Phones stop showing Your night${onTv ? ', and the TV goes back to the party' : ''}. You can publish it again any time.`}
        confirmLabel="Unpublish"
        onConfirm={() =>
          void run('unpublish', async () => {
            await unpublishRecap(session.id)
            // The TV's recap scene ends with it, so a later Publish doesn't start it by surprise.
            if (session.tv_scene === 'recap') await setTvScene(session.id, 'live')
          })
        }
      />
    </Screen>
  )
}
