import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowLeftIcon,
  DownloadSimpleIcon,
  EyeSlashIcon,
  FilmStripIcon,
  InfoIcon,
  PaperPlaneTiltIcon,
  TelevisionSimpleIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import Callout from '@/components/Callout'
import Confirm from '@/components/Confirm'
import { errorMessage, useHostCall } from '@/components/host/hostCalls'
import RecapHero from '@/components/host/RecapHero'
import RecapPreview from '@/components/host/RecapPreview'
import {
  ARRIVAL_RETRIES_MS,
  clockTime,
  downloadName,
  failedNightRead,
  movedOnSince,
  recapScreen,
  retried,
  type NightRead,
} from '@/components/host/recapView'
import { useHostFixture } from '@/components/host/useHostFixture'
import { Loading, Screen } from '@/components/layout'
import QueryGate from '@/components/QueryGate'
import { Button } from '@/components/ui/button'
import type { AnyGame } from '@/games/core/Game'
import { gameModules } from '@/games/registry'
import { fetchRawRecap, publishRecap, setTvScene, unpublishRecap, usePublishedRecap } from '@/lib/queries'
import { buildRecapDoc, type RawRecap } from '@/lib/recap'
import type { Snapshot } from '@/lib/types'
import { isUuid } from '@/lib/urls'
import { LiveSessionProvider, useLive } from '@/lib/useLive'
import { cn } from '@/lib/utils'
import { SessionNotFound } from '@/pages/NotFound'

/** Every game's logic, from the registry's modules: their recap() hooks write the chapters. */
const recapLogic: ReadonlyMap<string, AnyGame> = new Map(gameModules.map((m) => [m.logic.type, m.logic]))

// Dev builds only: with ?fixture=<scene>, the preview is built from a party recorded on the local stack.
const loadRecorded = import.meta.env.DEV ? () => import('@/lib/recap.recorded') : null

/** How long after the party last changed the open page reads the night again. */
const REREAD_MS = 5000

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
  const id = sample?.session?.id ?? sessionId
  return (
    <LiveSessionProvider sessionId={id} screen="host" fixture={sample}>
      <RecapGate sessionId={id} sample={sample !== undefined} />
    </LiveSessionProvider>
  )
}

/** The party and its night load side by side; the page shows once both are in. */
function RecapGate({ sessionId, sample }: { sessionId: string; sample: boolean }) {
  const { query } = useLive()
  const night = useRawNight(sessionId, sample)
  return (
    <QueryGate query={query} notFound={<SessionNotFound />}>
      {(snapshot) => (snapshot.session ? <RecapPage snapshot={snapshot} sample={sample} night={night} /> : <SessionNotFound />)}
    </QueryGate>
  )
}

type Night = ReturnType<typeof useRawNight>

/**
 * The raw night (session_recap(), hosts only): read on arrival and on Rebuild,
 * and again by `reread` while the page stays open, quietly: no fade, and a
 * failed read keeps the last night (with none on screen yet, it shows its
 * error, see failedNightRead). The last one stays while the next loads. The
 * read on arrival tries again after a blip before it gives up, under the loader.
 */
function useRawNight(sessionId: string, sample: boolean) {
  const [ask, setAsk] = useState({ attempt: 0, quiet: false })
  const [loaded, setLoaded] = useState<NightRead<RawRecap> | null>(null)

  useEffect(() => {
    let cancelled = false
    const { attempt, quiet } = ask
    const readOnce = () => (sample && loadRecorded ? loadRecorded().then((m) => m.recordedRawRecap) : fetchRawRecap(sessionId))
    const read = attempt === 0 ? retried(readOnce, ARRIVAL_RETRIES_MS, () => cancelled) : readOnce()
    read.then(
      (raw) => {
        if (!cancelled) setLoaded({ attempt, raw, error: null })
      },
      (error: unknown) => {
        if (!cancelled) setLoaded((last) => failedNightRead(last, attempt, quiet, errorMessage(error)))
      },
    )
    return () => {
      cancelled = true
    }
  }, [sessionId, sample, ask])

  const reread = useCallback(() => setAsk((last) => ({ attempt: last.attempt + 1, quiet: true })), [])
  return {
    raw: loaded?.raw ?? null,
    error: loaded?.attempt === ask.attempt ? loaded.error : null,
    loading: loaded?.attempt !== ask.attempt && !ask.quiet,
    rebuild: () => setAsk((last) => ({ attempt: last.attempt + 1, quiet: false })),
    reread,
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

function RecapPage({ snapshot, sample, night }: { snapshot: Snapshot; sample: boolean; night: Night }) {
  const session = snapshot.session!
  const call = useHostCall()
  const { reread } = night
  const doc = useMemo(() => (night.raw ? buildRecapDoc(night.raw, recapLogic) : null), [night.raw])
  // The party goes on while this page is open: a few seconds after its games, points or
  // guests change (not on every poll), the night is read again, so the preview and
  // "More has happened" follow it. The live snapshot is read again when the tab comes back.
  const party = JSON.stringify([snapshot.games, snapshot.standings, snapshot.players.length])
  const opened = useRef(party)
  useEffect(() => {
    if (sample || party === opened.current) return
    const timer = setTimeout(reread, REREAD_MS)
    return () => clearTimeout(timer)
  }, [party, reread, sample])
  const publishedAt = snapshot.recap?.published_at ?? null
  const { data: published } = usePublishedRecap(session.id, publishedAt ?? 0)
  const onTv = session.tv_scene === 'recap' && publishedAt !== null
  const [pending, setPending] = useState<string | null>(null)
  const [unpublishing, setUnpublishing] = useState(false)
  // Rows the recap would show, newer than the published one: not its own Publish, nor the TV switching to it.
  const behind = publishedAt !== null && published && night.raw ? movedOnSince(night.raw, published.generatedAt) : false
  const running = doc?.chapters.some((c) => c.finishedAt === null) ?? false

  // From the loader straight to the night: nothing of the page shows before it.
  if (recapScreen(night) === 'loader') return <Loading />

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
      async () => {
        // Built from a fresh read: every Publish and Update carries the night as it is now,
        // not as this page last read it. Then the preview catches up with what was sent.
        await publishRecap(session.id, buildRecapDoc(await fetchRawRecap(session.id), recapLogic))
        reread()
      },
      publishedAt === null ? 'Published: every phone shows Your night' : 'Updated on every screen',
    )

  const band = (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-1 basis-60 items-start gap-3">
          <span
            className={cn(
              'grid size-9 shrink-0 place-items-center rounded-full [&_svg]:size-4.5',
              onTv ? 'bg-primary text-primary-foreground' : publishedAt !== null ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
            )}
          >
            {onTv ? <TelevisionSimpleIcon weight="fill" /> : publishedAt !== null ? <PaperPlaneTiltIcon weight="fill" /> : <EyeSlashIcon />}
          </span>
          <div className="min-w-0 text-sm">
            <p className="font-semibold">
              {publishedAt === null ? 'Not published yet' : `Published ${clockTime(publishedAt)}${onTv ? ', on the TV' : ''}`}
            </p>
            <p className="text-muted-foreground">
              {publishedAt === null
                ? 'Only you can see this preview.'
                : `Every phone shows Your night${onTv ? ' and the TV plays it on a loop' : ''}.`}
              {doc && doc.generatedAt > 0 && ` Built from everything up to ${clockTime(doc.generatedAt)}.`}
            </p>
          </div>
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
    </div>
  )

  const tvNote = onTv
    ? 'It is playing on the TV now.'
    : publishedAt !== null
      ? 'Show on the TV plays it there.'
      : 'Once published, Show on the TV plays it on a loop.'

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

      <div className="mt-4">
        {doc ? (
          <RecapPreview doc={doc} partyName={session.name} band={band} tvNote={tvNote} faded={night.loading} />
        ) : (
          <RecapHero doc={null} partyName={session.name}>
            {band}
          </RecapHero>
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
