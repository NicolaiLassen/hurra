import { CaretRightIcon, ChampagneIcon, CrownIcon, HourglassMediumIcon, TrophyIcon } from '@phosphor-icons/react'
import { createElement, useContext, useEffect, useRef, useState, type RefObject } from 'react'
import { Link } from 'react-router'
import Avatar from '@/components/Avatar'
import { Notice, Screen } from '@/components/layout'
import { FixtureMode, gameIconOf } from '@/components/phone/calls'
import { useFeedToasts } from '@/components/phone/feed'
import GameCard, { Eyebrow, type GameStatus } from '@/components/phone/GameCard'
import GameSheet from '@/components/phone/GameSheet'
import { GameCompactCard, GameResult, GameView } from '@/components/phone/PhoneGame'
import { useScannedCode } from '@/components/phone/scan'
import ShowMyCode from '@/components/phone/ShowMyCode'
import { finishedLine, timeAgo } from '@/components/phone/text'
import YourNight from '@/components/phone/YourNight'
import ProfileBadges from '@/components/ProfileBadges'
import QueryGate from '@/components/QueryGate'
import SoundToggle from '@/components/SoundToggle'
import Standings from '@/components/Standings'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { getGameModule } from '@/games/registry'
import { usePublishedRecap } from '@/lib/queries'
import type { RecapDoc } from '@/lib/recap'
import { phoneLayout, scanTarget, tvScene, type PhoneLayout } from '@/lib/stage'
import { rememberJoinCode } from '@/lib/storage'
import { toast } from '@/lib/toast'
import type { Player, PromptState, PublicSession, Session, SessionGame, Snapshot } from '@/lib/types'
import { useLive, useServerNow } from '@/lib/useLive'
import { PartyNotFound } from '@/pages/NotFound'

// The phone home (docs/engine-v2.md, 7.1, and user-flows 7): the game on the
// main card, the other live games as compact cards, what finished lately,
// "Your night", the standings and the Show my code bar. Everything comes from
// the nearest LiveSessionProvider; game screens come through the registry.

const acceptsScans = (gameType: string) => getGameModule(gameType)?.acceptsScans === true

/** One round of one game: a restart starts its views afresh, so nothing of the last round lingers. */
const roundKey = (game: SessionGame) => `${game.id}:${game.started_at ?? ''}`

/** The sheet over the phone home: a game opened from its card. Kept while it closes, so it slides away whole. */
type SheetState = { gameId: string; open: boolean }

export default function PhoneHome({
  party,
  player,
  fixtureRecap = null,
}: {
  /** The party as this phone found it on opening: still known when the snapshot can't read it (removed, moved). */
  party: PublicSession
  /** This phone's player as found on opening. */
  player: Pick<Player, 'id' | 'name'>
  /** Fixture mode only: the recap shown as published (5.11). */
  fixtureRecap?: RecapDoc | null
}) {
  const live = useLive()
  return (
    <QueryGate query={live.query} notFound={<PartyNotFound code={party.join_code} />}>
      {(snapshot) => {
        const me = snapshot.member ? snapshot.players.find((p) => p.id === player.id) : undefined
        return me && snapshot.session ? (
          <Home snapshot={snapshot} session={snapshot.session} player={me} fixtureRecap={fixtureRecap} />
        ) : (
          <NotInParty party={party} name={player.name} moved={live.moved} />
        )
      }}
    </QueryGate>
  )
}

function Home({
  snapshot,
  session,
  player,
  fixtureRecap,
}: {
  snapshot: Snapshot
  session: Session
  player: Player
  fixtureRecap: RecapDoc | null
}) {
  const fixture = useContext(FixtureMode)
  const now = useServerNow(30_000)
  const layout = phoneLayout(snapshot, now)
  const scene = tvScene(snapshot, now)
  const stageId = scene.kind === 'live' ? scene.game.id : null
  const { main } = layout
  const mainGame = main.kind === 'game' || main.kind === 'result' ? main.game : null
  const over = main.kind === 'over'
  // A timed question is open on the main card (a quiz question): the Show my
  // code bar steps aside for it, so it covers none of the answers.
  const timed =
    main.kind === 'game' && snapshot.prompts.some((p) => p.game_id === main.game.id && p.closes_at !== null && p.closed_at === null)
  const points = snapshot.standings.find((row) => row.player_id === player.id)?.points ?? 0
  const status = (game: SessionGame): GameStatus => (game.status === 'finished' ? 'finished' : game.id === stageId ? 'stage' : 'running')

  // "Your night", once the host publishes the recap: nothing for a guest who joined after it was made.
  const revision = fixture ? 0 : (snapshot.recap?.published_at ?? 0)
  const { data: publishedRecap } = usePublishedRecap(session.id, revision)
  const published = snapshot.recap ? (fixture ? fixtureRecap : (publishedRecap ?? null)) : null
  const recap = published?.players[player.id] ? published : null

  useFeedToasts(snapshot.feed, player.id, snapshot.now)
  useRemovedGameToast(snapshot, mainGame?.id ?? null, main.kind === 'lobby' ? 'Back to the lobby until the next game.' : undefined)
  const mainCard = useRef<HTMLDivElement>(null)

  // Stored again on every fresh read, so a "not found" that was wrong (say, a
  // read during a failed token refresh) can't drop it for good.
  useEffect(() => {
    if (!fixture) rememberJoinCode(session.join_code)
  }, [fixture, snapshot, session.join_code])

  // The sheet, and camera scans of a player QR (`?scanned=CODE`): the main
  // game gets the code if it takes scans, else the newest live game that does,
  // in its sheet. With none, a toast says whose code it is.
  const [sheet, setSheet] = useState<SheetState | null>(null)
  const scan = useScannedCode()
  const target = scan.code ? scanTarget(snapshot, acceptsScans, now) : null
  const scanInMain = target !== null && main.kind === 'game' && target.id === main.game.id
  const scanSheet = target !== null && !scanInMain ? target : null
  const shown: SheetState | null = scanSheet ? { gameId: scanSheet.id, open: true } : sheet
  const sheetGame = shown ? snapshot.games.find((g) => g.id === shown.gameId && g.archived_at === null) : undefined
  const sheetOpen = shown?.open === true && sheetGame !== undefined && sheetGame.status !== 'pending'
  const openSheet = (gameId: string) => setSheet({ gameId, open: true })
  function closeSheet() {
    setSheet(shown ? { gameId: shown.gameId, open: false } : null)
    if (scanSheet) scan.done()
  }

  useRemovedGameToast(snapshot, sheetOpen && sheetGame.id !== mainGame?.id ? sheetGame.id : null)
  useScanToast(scan, target !== null, snapshot.players, player.id)
  useBringIntoView(mainCard, snapshot, layout, sheetOpen)

  return (
    // Bottom padding keeps the last card clear of the Show my code bar.
    <Screen className={over ? undefined : 'pb-32'}>
      <PhoneHeader session={session} player={player} points={points} />

      <div className="mt-6">
        {main.kind === 'game' && (
          <GameCard
            ref={mainCard}
            status={main.game.id === stageId ? 'stage' : 'playing'}
            icon={gameIconOf(main.game.game_type)}
            title={main.game.title}
          >
            <GameView
              key={roundKey(main.game)}
              snapshot={snapshot}
              session={session}
              game={main.game}
              player={player}
              onStage={main.game.id === stageId}
              scannedCode={scanInMain ? (scan.code ?? undefined) : undefined}
              onScanHandled={scan.done}
            />
          </GameCard>
        )}
        {main.kind === 'result' && (
          <GameCard ref={mainCard} status="finished" icon={gameIconOf(main.game.game_type)} title={main.game.title}>
            <GameResult snapshot={snapshot} session={session} game={main.game} player={player} />
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <HourglassMediumIcon weight="duotone" className="size-5 shrink-0" />
              Waiting for the next game
            </p>
          </GameCard>
        )}
        {main.kind === 'lobby' && <Lobby players={snapshot.players} />}
        {main.kind === 'over' && <PartyOver session={session} recap={recap !== null} />}
      </div>

      {layout.alsoRunning.length > 0 && (
        <section aria-labelledby="also-running" className="mt-6 grid grid-cols-1 gap-3">
          <Eyebrow as="h2" id="also-running">
            Also running
          </Eyebrow>
          {layout.alsoRunning.map((game) => (
            <GameCompactCard
              key={roundKey(game)}
              snapshot={snapshot}
              session={session}
              game={game}
              player={player}
              onStage={game.id === stageId}
              open={() => openSheet(game.id)}
            />
          ))}
        </section>
      )}

      {layout.finishedLately.length > 0 && (
        <FinishedLately games={layout.finishedLately} players={snapshot.players} meId={player.id} now={now} onOpen={openSheet} />
      )}

      {recap && <YourNight doc={recap} playerId={player.id} className="mt-6" />}

      {snapshot.standings.length > 1 && <Standings rows={snapshot.standings} playerId={player.id} className="mt-6" />}

      {!over && <ShowMyCode player={player} hidden={timed} />}

      <GameSheet
        open={sheetOpen}
        onClose={closeSheet}
        status={sheetGame ? status(sheetGame) : 'running'}
        icon={gameIconOf(sheetGame?.game_type ?? '')}
        title={sheetGame?.title ?? ''}
      >
        {sheetGame?.status === 'active' && (
          <GameView
            key={roundKey(sheetGame)}
            snapshot={snapshot}
            session={session}
            game={sheetGame}
            player={player}
            onStage={sheetGame.id === stageId}
            scannedCode={scanSheet?.id === sheetGame.id ? (scan.code ?? undefined) : undefined}
            onScanHandled={() => {
              // The code is used: keep the sheet open on its own from here.
              setSheet({ gameId: sheetGame.id, open: true })
              scan.done()
            }}
          />
        )}
        {sheetGame?.status === 'finished' && <GameResult snapshot={snapshot} session={session} game={sheetGame} player={player} />}
      </GameSheet>
    </Screen>
  )
}

/** Avatar, name, badges, the sound toggle and the day's points (as before v2). */
function PhoneHeader({ session, player, points }: { session: Session; player: Player; points: number }) {
  return (
    <header className="flex items-center gap-3">
      <Avatar name={player.name} className="size-12 text-lg" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-muted-foreground">{session.name}</p>
        <h1 className="truncate text-2xl leading-tight font-bold">{player.name}</h1>
        <ProfileBadges profile={player.profile} className="mt-1" />
      </div>
      <SoundToggle className="-mr-1 shrink-0" />
      <div className="shrink-0 rounded-2xl bg-primary px-4 py-2 text-center text-primary-foreground">
        {/* Keyed by the points, so a change pops in. */}
        <p key={points} className="animate-count-pop text-2xl leading-none font-black tabular-nums motion-reduce:animate-none">
          {points}
        </p>
        <p className="text-[0.65rem] font-bold tracking-wide uppercase">points</p>
      </div>
    </header>
  )
}

/** No game yet, or between games: you're in, and who else is. */
function Lobby({ players }: { players: Player[] }) {
  const faces = players.slice(-5).reverse()
  return (
    <Card>
      <CardContent className="grid justify-items-center gap-3 py-4 text-center">
        <ChampagneIcon weight="duotone" className="size-14 text-primary" />
        <div>
          <p className="text-xl font-bold">You're in!</p>
          <p className="text-muted-foreground">The host will start the next game soon.</p>
        </div>
        {players.length > 1 && (
          <div className="flex items-center gap-2">
            <div className="flex -space-x-2">
              {faces.map((p) => (
                <Avatar key={p.id} name={p.name} className="size-8 text-xs ring-2 ring-card" />
              ))}
            </div>
            <p className="text-sm text-muted-foreground">{players.length} players here</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** The party is archived: no more games, just how it ended. */
function PartyOver({ session, recap }: { session: Session; recap: boolean }) {
  return (
    <Card>
      <CardContent className="grid justify-items-center gap-3 py-4 text-center">
        <TrophyIcon weight="duotone" className="size-14 text-primary" />
        <div>
          <p className="text-xl font-bold">That's a wrap!</p>
          <p className="text-muted-foreground">
            {session.name} is over. Thanks for playing!{recap && ' Here is your night.'}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

/** One slim row per other game that finished in the last half hour; a tap shows its result. */
function FinishedLately({
  games,
  players,
  meId,
  now,
  onOpen,
}: {
  games: SessionGame[]
  players: Player[]
  meId: string
  now: number
  onOpen: (gameId: string) => void
}) {
  return (
    <section aria-labelledby="finished-lately" className="mt-6 grid grid-cols-1 gap-3">
      <Eyebrow as="h2" id="finished-lately">
        Finished lately
      </Eyebrow>
      <Card size="sm" className="gap-0 py-1.5">
        <ul className="divide-y divide-border">
          {games.map((game) => {
            const won = game.winners.includes(meId)
            return (
              <li key={game.id}>
                <button
                  type="button"
                  onClick={() => onOpen(game.id)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                >
                  <span
                    className={
                      won
                        ? 'grid size-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary'
                        : 'grid size-9 shrink-0 place-items-center rounded-xl bg-secondary text-muted-foreground'
                    }
                  >
                    {createElement(won ? CrownIcon : gameIconOf(game.game_type), { weight: 'duotone', className: 'size-5' })}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{finishedLine(game, players, meId)}</span>
                    <span className="block text-xs text-muted-foreground">{timeAgo(now - (game.finished_at ?? now))}</span>
                  </span>
                  <CaretRightIcon className="size-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            )
          })}
        </ul>
      </Card>
    </section>
  )
}

/** This phone is no longer in the party: the host removed the player, or it moved to another phone. */
function NotInParty({ party, name, moved }: { party: PublicSession; name: string; moved: boolean }) {
  if (moved) {
    return (
      <Notice
        title="Your player moved to another phone"
        actions={
          <Button asChild size="xl" variant="secondary">
            <Link to={`/join/${party.join_code}`}>Join with a new name</Link>
          </Button>
        }
      >
        {name} plays on another phone now, with all the points. To play on this phone too, join {party.name} with a new name.
      </Notice>
    )
  }
  return (
    <Notice
      title={`You're no longer in ${party.name}`}
      actions={
        <Button asChild size="xl">
          <Link to={`/join/${party.join_code}`}>Join again</Link>
        </Button>
      }
    >
      The host took you off the player list. Join again to keep playing.
    </Notice>
  )
}

/**
 * Says so when the host deletes the game this phone shows (on the main card,
 * or open in the sheet): the phone moves on by itself, and this says why.
 */
function useRemovedGameToast(snapshot: Snapshot, shownId: string | null, description?: string) {
  const last = useRef<SessionGame | null>(null)
  useEffect(() => {
    const previous = last.current
    last.current = shownId ? (snapshot.games.find((g) => g.id === shownId) ?? null) : null
    if (!previous || previous.id === shownId || snapshot.games.some((g) => g.id === previous.id)) return
    toast.info(`The host removed ${previous.title}`, { description })
  }, [snapshot, shownId, description])
}

/** A scanned code no live game takes: say whose it is, once, and drop it. */
function useScanToast(
  scan: { code: string | null; done: () => void },
  taken: boolean,
  players: Player[],
  meId: string,
) {
  const handled = useRef<string | null>(null)
  useEffect(() => {
    if (!scan.code || taken || handled.current === scan.code) return
    handled.current = scan.code
    const owner = players.find((p) => p.code === scan.code)
    if (!owner) toast.info("That code isn't from this party")
    else if (owner.id === meId) toast.info("That's your own code")
    else toast.info(`That's ${owner.name}'s code`, { description: 'Only the host can give points with it.' })
    scan.done()
  }, [scan, taken, players, meId])
}

/**
 * When a new game takes the main card, or the main game opens a new question,
 * brings the card into view when it isn't all on screen: for a guest who
 * scrolled down to the standings, and for one at the top of a small phone,
 * where the last answers would sit below the fold. Not while a sheet covers
 * the page.
 */
function useBringIntoView(card: RefObject<HTMLDivElement | null>, snapshot: Snapshot, layout: PhoneLayout, covered: boolean) {
  const game = layout.main.kind === 'game' ? layout.main.game : null
  let question: PromptState | null = null
  for (const prompt of snapshot.prompts) {
    if (prompt.game_id === game?.id && prompt.closed_at === null && (!question || prompt.opened_at > question.opened_at)) question = prompt
  }
  const gameId = game?.id ?? null
  const questionKey = question?.key ?? null
  const seen = useRef<{ gameId: string | null; questionKey: string | null } | null>(null)

  useEffect(() => {
    const before = seen.current
    seen.current = { gameId, questionKey }
    if (!before || covered) return
    const news = (gameId !== null && gameId !== before.gameId) || (questionKey !== null && questionKey !== before.questionKey)
    const element = card.current
    const box = element?.getBoundingClientRect()
    if (!news || !element || !box || (box.top >= 0 && box.bottom <= window.innerHeight)) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    element.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
  }, [gameId, questionKey, covered, card])
}
