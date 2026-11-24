import { ArchiveIcon, FilmStripIcon, LockIcon, LockOpenIcon } from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import GamesPanel from '@/components/host/GamesPanel'
import { useHostCall } from '@/components/host/hostCalls'
import JoinCard from '@/components/host/JoinCard'
import LiveDot from '@/components/host/LiveDot'
import LiveGameCard from '@/components/host/LiveGameCard'
import PairTvButton from '@/components/host/PairTvButton'
import PlayersPanel from '@/components/host/PlayersPanel'
import { arrangeGames, partyLine } from '@/components/host/scene'
import StagePanel from '@/components/host/StagePanel'
import StateChip from '@/components/host/StateChip'
import TimerWarnings from '@/components/host/TimerWarnings'
import { useHostFixture } from '@/components/host/useHostFixture'
import { Loading, Screen } from '@/components/layout'
import QueryGate from '@/components/QueryGate'
import { Button } from '@/components/ui/button'
import { setJoining } from '@/lib/queries'
import type { Snapshot } from '@/lib/types'
import { isUuid } from '@/lib/urls'
import { LiveSessionProvider, useLive } from '@/lib/useLive'
import SessionMenu from '@/pages/host/SessionMenu'
import { SessionNotFound } from '@/pages/NotFound'

/**
 * The host control room (docs/engine-v2.md, 7.3): what is on the TV, every
 * live game with its own controls, the night's program, the guests and the
 * join card, live from the party's snapshot. In dev builds `?fixture=<scene>`
 * shows a sample party instead (5.11).
 */
export default function HostSession() {
  const sessionId = useParams().sessionId ?? ''
  const fixture = useHostFixture()
  if (!fixture.ready) return <Loading />
  const sample = fixture.snapshot
  if (!sample && !isUuid(sessionId)) return <SessionNotFound />
  return (
    <LiveSessionProvider sessionId={sample?.session?.id ?? sessionId} screen="host" fixture={sample}>
      <ControlRoomGate live={!sample} />
    </LiveSessionProvider>
  )
}

/** The control room once the snapshot is in: the loader before, Session not found for a party that is gone. */
export function ControlRoomGate({ live }: { live: boolean }) {
  const { query } = useLive()
  return (
    <QueryGate query={query} notFound={<SessionNotFound />}>
      {(snapshot) => (snapshot.session ? <ControlRoom snapshot={snapshot} live={live} /> : <SessionNotFound />)}
    </QueryGate>
  )
}

function ControlRoom({ snapshot, live }: { snapshot: Snapshot; live: boolean }) {
  const navigate = useNavigate()
  const { refresh } = useLive()
  const call = useHostCall()
  const [joiningPending, setJoiningPending] = useState(false)
  const session = snapshot.session!
  const { live: liveGames, program, archived } = useMemo(() => arrangeGames(snapshot), [snapshot])
  const over = session.archived_at !== null
  const open = session.status === 'open'

  async function toggleJoining() {
    setJoiningPending(true)
    await call(() => setJoining(session.id, !open), open ? 'Joining is closed' : 'Joining is open')
    setJoiningPending(false)
  }

  return (
    <Screen wide>
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="truncate text-3xl font-extrabold">{session.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-paper-2">
            <span className="font-mono text-lg leading-none font-extrabold tracking-[0.04em] text-paper">{session.join_code}</span>
            <span>{partyLine(snapshot.players.length, session)}</span>
            {over && <StateChip state="archived" />}
            <LiveDot />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!over && (
            <Button variant="secondary" size="lg" isPending={joiningPending} onClick={() => void toggleJoining()}>
              {open ? <LockIcon /> : <LockOpenIcon />}
              {open ? 'Close joining' : 'Open joining'}
            </Button>
          )}
          {/* On a phone the stage panel right below has it. */}
          <PairTvButton sessionId={session.id} joinCode={session.join_code} screens={snapshot.screens} className="max-sm:hidden" />
          <Button asChild variant="secondary" size="lg">
            <Link to={`/host/s/${session.id}/recap`}>
              <FilmStripIcon />
              Recap
            </Link>
          </Button>
          <SessionMenu
            session={session}
            size="icon-lg"
            variant="secondary"
            onChanged={(change) => (change.deleted ? navigate('/host', { replace: true }) : refresh())}
          />
        </div>
      </header>

      {over && (
        // A solid note, not a toast's callout: the room has no glass (docs/identity.md).
        <section className="mt-6 flex items-start gap-3 rounded-xl bg-raised p-4" role="status">
          <span className="grid size-9 shrink-0 place-items-center rounded-control bg-overlay text-paper-2">
            <ArchiveIcon weight="fill" className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="font-extrabold">This party is archived</p>
            <p className="mt-0.5 text-sm text-paper-2">
              Joining is closed, phones say that's a wrap, and the TV shows the final standings. Unarchive it from the menu.
            </p>
          </div>
        </section>
      )}

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 grid-cols-1 gap-6">
          <StagePanel snapshot={snapshot} />
          {live && <TimerWarnings games={snapshot.games} />}
          {liveGames.length > 0 && (
            <section className="grid grid-cols-1 gap-4" aria-labelledby="live-games">
              <h2 id="live-games" className="text-base font-extrabold">
                Live now ({liveGames.length})
              </h2>
              {liveGames.map((game) => (
                <LiveGameCard key={game.id} snapshot={snapshot} game={game} onStage={game.id === session.spotlight_game_id} />
              ))}
            </section>
          )}
          <GamesPanel snapshot={snapshot} program={program} archived={archived} />
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-6">
          {/* First beside the games on a laptop; last on a phone, under the guests. */}
          <JoinCard session={session} className="order-last lg:order-first" />
          <PlayersPanel snapshot={snapshot} />
        </div>
      </div>
    </Screen>
  )
}
