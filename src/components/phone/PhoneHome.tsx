import { CaretDownIcon, CaretRightIcon, CrownIcon, FlagCheckeredIcon, HourglassMediumIcon, RankingIcon } from '@phosphor-icons/react'
import { useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Link, Navigate, useLocation } from 'react-router'
import Avatar from '@/components/Avatar'
import { Notice, Screen } from '@/components/layout'
import Logo from '@/components/Logo'
import { FixtureMode, isBackgroundGame, phoneSecretOf, phoneStrapOf } from '@/components/phone/calls'
import { useFeedToasts } from '@/components/phone/feed'
import GameCard from '@/components/phone/GameCard'
import GameSheet from '@/components/phone/GameSheet'
import MyPlace from '@/components/phone/MyPlace'
import OnTheTv from '@/components/phone/OnTheTv'
import { GameCompactCard, GameResult, GameView } from '@/components/phone/PhoneGame'
import { barSecret, homeLayout, mainCardNews, peekOpen, phoneFocus, sheetGivesWay, tvRows } from '@/components/phone/running'
import { useScannedCode } from '@/components/phone/scan'
import ShowMyCode from '@/components/phone/ShowMyCode'
import type { TabTone } from '@/components/phone/Strap'
import { finishedAt, finishedLine, runningSince } from '@/components/phone/text'
import { isTypingTarget, useTypingFocus } from '@/components/phone/useTypingFocus'
import YourNight from '@/components/phone/YourNight'
import QueryGate from '@/components/QueryGate'
import SoundToggle from '@/components/SoundToggle'
import Standings from '@/components/Standings'
import { Button } from '@/components/ui/button'
import { accentOf, getGameModule, knockedOutIds } from '@/games/registry'
import { usePublishedRecap } from '@/lib/queries'
import type { RecapDoc } from '@/lib/recap'
import { PHONE_SOUNDS } from '@/lib/sound'
import { scanTarget, tvScene } from '@/lib/stage'
import { rememberJoinCode } from '@/lib/storage'
import { toast } from '@/lib/toast'
import type { Player, PromptState, PublicSession, Session, SessionGame, Snapshot } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useLive, useServerNow } from '@/lib/useLive'
import type { FreedState } from '@/pages/joinScreen'
import { PartyNotFound } from '@/pages/NotFound'

// The phone home (docs/engine-v2.md, 7.1, and user-flows 7), top to bottom:
// the header (the logo, the party and the sound), the game on the main card
// when one holds it, your token and place, On the TV (Now, Next and Later),
// the games running underneath in their own sections, what finished lately,
// "Your night", the standings, and the Show my code bar, the home's one gold
// step. Everything comes from the nearest LiveSessionProvider; game screens
// come through the registry.
//
// The takeover (phoneFocus in running.ts): while a stage game holds the TV,
// live or on its final screen, the phone shows only that game under a slim
// header with Standings, which opens the rest of the home as the peek. The
// bar stays, with a background game's secret (the hunt's task) beside Show my
// code. When the TV moves on, the home comes back as it was.

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
          <NotInParty party={party} name={player.name} moved={live.moved} freed={live.freed} />
        )
      }}
    </QueryGate>
  )
}

/**
 * A game's strap words: its own while it is live (GameModule.phoneStrap, as
 * "Question 3 of 10"), else where it is: "On the TV", "Since 20:30" or
 * "Finished at 22:41". Only times the database holds.
 */
function strapLine(game: SessionGame, onStage: boolean): string | null {
  if (game.status === 'finished') return finishedAt(game)
  return phoneStrapOf(game) ?? (onStage ? 'On the TV' : runningSince(game))
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
  const location = useLocation()
  const tick = useServerNow(30_000)
  // A finished game's final screen ends on the database clock: the phone goes home with the TV, not up to 30 s later.
  const ticked = tvScene(snapshot, tick)
  const now = useNowPast(ticked.kind === 'final' ? ticked.until : null, tick)
  const layout = homeLayout(snapshot, now, isBackgroundGame)
  const scene = tvScene(snapshot, now)
  // The takeover: a stage game on the TV fills the phone, alone, until the TV moves on.
  const focus = phoneFocus(snapshot, now, isBackgroundGame)
  const takeover = focus.kind === 'takeover' ? focus : null
  const stageId = scene.kind === 'live' ? scene.game.id : null
  // The game the TV shows, live or its final screen: its tab is gold, the colour of what is on air.
  // The hunt's tab is always its pink (GameModule.accent), as its own section draws it.
  const airId = scene.kind === 'live' || scene.kind === 'final' ? scene.game.id : null
  const toneOf = (game: SessionGame): TabTone => (accentOf(game.game_type) === 'hunt' ? 'hunt' : game.id === airId ? 'air' : 'plain')
  const { main } = layout
  // The main card: the takeover's game (live, or its result while the TV shows its final screen), else the home's.
  const liveMain = takeover ? (takeover.finished ? null : takeover.game) : main.kind === 'game' ? main.game : null
  const resultMain = takeover ? (takeover.finished ? takeover.game : null) : main.kind === 'result' ? main.game : null
  const mainGame = liveMain ?? resultMain
  const held = useHeldGame(snapshot, mainGame)
  const over = !takeover && main.kind === 'over'
  // A timed question is open on the main card (a quiz question): the Show my
  // code bar steps aside for it, so it covers none of the answers.
  const timed = liveMain !== null && snapshot.prompts.some((p) => p.game_id === liveMain.id && p.closes_at !== null && p.closed_at === null)
  // A guest typing into a game's text field: the bar steps aside too, for the
  // browsers that lift a fixed bar above the keyboard.
  const typing = useTypingFocus()
  const out = useMemo(() => knockedOutIds(snapshot.games), [snapshot.games])
  const rows = tvRows(snapshot, now, player.id, mainGame?.id ?? null, phoneStrapOf)
  // In the takeover, a background game's secret (the hunt's task) stays one tap away on the bar.
  const secret = takeover ? barSecret(layout.alsoRunning, takeover.game.id, (g) => phoneSecretOf(g, snapshot.me?.views[g.id])) : null

  // The peek: the home as a sheet over the takeover, from Standings in the header. Fixture mode
  // only: `&peek=1` opens it on the first render, for the captures and the tests.
  const [peeked, setPeeked] = useState<string | null>(() =>
    fixture && takeover && new URLSearchParams(location.search).get('peek') === '1' ? takeover.game.id : null,
  )
  const peeking = peekOpen(focus, peeked)
  const peekControl = useRef<HTMLButtonElement>(null)
  const closePeek = useCallback(() => setPeeked(null), [])

  // "Your night", once the host publishes the recap: nothing for a guest who joined after it was made.
  const revision = fixture ? 0 : (snapshot.recap?.published_at ?? 0)
  const { data: publishedRecap } = usePublishedRecap(session.id, revision)
  const published = snapshot.recap ? (fixture ? fixtureRecap : (publishedRecap ?? null)) : null
  const recap = published?.players[player.id] ? published : null

  useFeedToasts(snapshot.feed, player.id, snapshot.now)
  useRemovedGameToast(snapshot, mainGame?.id ?? null, !takeover && main.kind === 'lobby' ? 'Back to the lobby until the next game.' : undefined)
  const mainCard = useRef<HTMLElement>(null)

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
  const scanInMain = target !== null && liveMain !== null && target.id === liveMain.id
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
  // A new timed question (a quiz question) takes the page back from a sheet or the peek left open, so its seconds aren't missed.
  useBringIntoView(mainCard, snapshot, liveMain, sheetOpen, { timed, scanning: scanSheet !== null, close: closeSheet, peeking, closePeek })
  usePeekKeys(peeking, sheetOpen, closePeek, peekControl)

  const myToken = <Avatar name={player.name} playerId={player.id} className="size-9" />
  const standings = snapshot.standings.length > 1 && <Standings rows={snapshot.standings} playerId={player.id} out={out} className="mt-8" />
  // In the peek the bar is the peek's own, so a game's layer opened there (the hunt's scan sheet) covers it as on the home.
  const codeBar = !over && <ShowMyCode player={player} hidden={timed || typing} secret={secret?.secret ?? null} />

  return (
    // Bottom padding keeps the last section clear of the Show my code bar.
    // The takeover's header sits higher: the game gets the room.
    <Screen className={cn(!over && 'pb-36', takeover && 'pt-5')}>
      {/* While the peek is open over the takeover, the game under it is out of reach. */}
      <div inert={peeking}>
        <PhoneHeader
          session={session}
          peek={takeover ? { open: peeking, onOpen: () => setPeeked(takeover.game.id) } : null}
          peekRef={peekControl}
        />

        {/* One keyed list: a live game that loses the main card (to another
            game, a result card, or its own section) keeps its view, out of
            sight, so a full-screen layer it has open (such as the scan sheet or
            a knockout dialog) stays on top until the guest is done.
            Game layers are position: fixed (see GameSheet), so the hidden
            wrapper doesn't clip them. */}
        {[liveMain, held].map(
          (game) =>
            game && (
              <div
                key={roundKey(game)}
                data-out-of-sight={game === liveMain ? undefined : ''}
                className={game === liveMain ? 'mt-7' : 'invisible h-0 overflow-hidden [&_.fixed]:visible'}
              >
                <GameCard
                  ref={game === liveMain ? mainCard : undefined}
                  title={game.title}
                  tone={toneOf(game)}
                  line={strapLine(game, game.id === stageId)}
                  aside={myToken}
                >
                  <GameView
                    snapshot={snapshot}
                    session={session}
                    game={game}
                    player={player}
                    onStage={game.id === stageId}
                    scannedCode={game === liveMain && scanInMain ? (scan.code ?? undefined) : undefined}
                    onScanHandled={scan.done}
                  />
                </GameCard>
              </div>
            ),
        )}
        {resultMain && (
          <div className="mt-7">
            <GameCard ref={mainCard} title={resultMain.title} tone={toneOf(resultMain)} line={strapLine(resultMain, false)} aside={myToken}>
              <GameResult snapshot={snapshot} session={session} game={resultMain} player={player} />
              <p className="flex items-center gap-2 text-sm text-paper-2">
                <HourglassMediumIcon weight="duotone" className="size-5 shrink-0" />
                Waiting for the next game
              </p>
            </GameCard>
          </div>
        )}
        {!takeover && main.kind === 'lobby' && <Lobby players={snapshot.players} />}
        {over && <PartyOver session={session} recap={recap !== null} />}
      </div>

      {/* The rest of the home. In the takeover it stays mounted out of sight
          (what a guest had open in a game's section, such as the hunt's scan,
          stays on top), and Standings opens it as the peek. */}
      <HomeSections mode={takeover ? (peeking ? 'peek' : 'hidden') : 'flow'} session={session} onClose={closePeek} foot={codeBar}>
        <div className="mt-7">
          <MyPlace session={session} player={player} standings={snapshot.standings} />
        </div>

        {/* Opened from Standings, the peek has them right under your place. */}
        {peeking && standings}

        {rows.length > 0 && (
          <div className="mt-8">
            <OnTheTv rows={rows} />
          </div>
        )}

        {layout.alsoRunning.map((game) => (
          <div key={roundKey(game)} className="mt-8">
            <GameCompactCard
              snapshot={snapshot}
              session={session}
              game={game}
              player={player}
              onStage={game.id === stageId}
              open={() => openSheet(game.id)}
            />
          </div>
        ))}

        {layout.finishedLately.length > 0 && (
          <FinishedLately games={layout.finishedLately} players={snapshot.players} meId={player.id} onOpen={openSheet} />
        )}

        {recap && <YourNight doc={recap} playerId={player.id} className="mt-8" />}

        {!peeking && standings}
      </HomeSections>

      {!peeking && codeBar}

      <GameSheet
        open={sheetOpen}
        onClose={closeSheet}
        tone={sheetGame ? toneOf(sheetGame) : 'plain'}
        title={sheetGame?.title ?? ''}
        line={sheetGame ? strapLine(sheetGame, sheetGame.id === stageId) : null}
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

/**
 * The logo, the party's name and this phone's sound. In the takeover, also
 * Standings: a quiet way to the home (the peek), never a second gold step.
 */
function PhoneHeader({
  session,
  peek,
  peekRef,
}: {
  session: Session
  peek: { open: boolean; onOpen: () => void } | null
  peekRef: RefObject<HTMLButtonElement | null>
}) {
  return (
    <header className="flex items-center gap-2.5">
      <Logo className="size-[1.625rem]" />
      <p className="min-w-0 flex-1 truncate text-[0.9375rem] font-bold text-paper-2">{session.name}</p>
      {peek && (
        <Button
          ref={peekRef}
          variant="secondary"
          size="lg"
          aria-haspopup="dialog"
          aria-expanded={peek.open}
          data-peek-control=""
          onClick={peek.onOpen}
          className="shrink-0 rounded-full px-3.5 text-[0.9375rem]"
        >
          <RankingIcon className="size-[1.125rem]" />
          Standings
        </Button>
      )}
      <SoundToggle preload={PHONE_SOUNDS} className="-mr-2 shrink-0" />
    </header>
  )
}

/**
 * The home's sections under the main card: your place, On the TV, the games
 * running underneath, what finished lately, Your night and the standings.
 * One element in every mode, so nothing inside remounts: 'flow' on the home;
 * 'hidden' in the takeover, mounted out of sight (a full-screen layer a
 * game's section has open, such as the hunt's scan sheet, stays on top, as
 * the held game's do); 'peek', the same sections as a sheet over the
 * takeover, with the party's name and Back to the game, and the bar at its
 * foot. Nothing in the peek's frame keeps a transform: a game's layer inside
 * must stay fixed to the screen.
 */
function HomeSections({
  mode,
  session,
  onClose,
  foot,
  children,
}: {
  mode: 'flow' | 'hidden' | 'peek'
  session: Session
  onClose: () => void
  /** The Show my code bar, drawn inside the peek while it is open. */
  foot: ReactNode
  children: ReactNode
}) {
  const titleId = useId()
  const peek = mode === 'peek'
  return (
    <div
      data-peek={peek ? '' : undefined}
      data-out-of-sight={mode === 'hidden' ? '' : undefined}
      role={peek ? 'dialog' : undefined}
      aria-labelledby={peek ? titleId : undefined}
      className={cn(
        mode === 'hidden' && 'invisible h-0 overflow-hidden [&_.fixed]:visible',
        peek && 'fixed inset-0 z-40 animate-peek-in overflow-y-auto overscroll-contain bg-ground motion-reduce:animate-none',
      )}
    >
      {peek && (
        <header className="sticky top-0 z-10 bg-raised px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3">
          <div className="mx-auto flex w-full max-w-md items-center gap-2.5">
            <Logo className="size-[1.625rem]" />
            <h2 id={titleId} className="min-w-0 flex-1 truncate text-[0.9375rem] font-bold text-paper-2">
              {session.name}
            </h2>
            <Button autoFocus variant="secondary" size="lg" onClick={onClose} className="-mr-1 shrink-0 rounded-full px-3.5 text-[0.9375rem]">
              <CaretDownIcon className="size-[1.125rem]" />
              Back to the game
            </Button>
          </div>
        </header>
      )}
      <div className={cn(peek && 'mx-auto w-full max-w-md px-4 pt-1 pb-36')}>{children}</div>
      {peek && foot}
    </div>
  )
}

/**
 * While the peek is open, Escape closes it (not while a game's sheet is open
 * over it: that one closes first). Once it closes, the focus goes back to
 * Standings.
 */
function usePeekKeys(open: boolean, covered: boolean, close: () => void, control: RefObject<HTMLButtonElement | null>) {
  const wasOpen = useRef(open)
  useEffect(() => {
    if (wasOpen.current && !open) control.current?.focus({ preventScroll: true })
    wasOpen.current = open
  }, [open, control])
  useEffect(() => {
    if (!open || covered) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, covered, close])
}

/**
 * Now by the database clock for the home's layout: `tick`, and also `at` the
 * moment it passes (the end of a finished game's final screen on the TV), so
 * the phone leaves that game's takeover with the TV rather than at its next
 * 30 s tick.
 */
function useNowPast(at: number | null, tick: number): number {
  const { serverNow } = useLive()
  const [passed, setPassed] = useState<number | null>(null)
  useEffect(() => {
    if (at === null) return
    const timer = setTimeout(() => setPassed(at), Math.max(0, at - serverNow()))
    return () => clearTimeout(timer)
  }, [at, serverNow])
  return at !== null && passed === at ? Math.max(tick, at) : tick
}

/** No game yet: you're in, and who else is. */
function Lobby({ players }: { players: Player[] }) {
  const faces = players.slice(-5).reverse()
  return (
    <section aria-label="You're in" className="mt-7 grid gap-3">
      <div>
        <p className="text-phone-head leading-tight font-extrabold">You're in.</p>
        <p className="mt-1 text-paper-2">The host starts the next game soon.</p>
      </div>
      {players.length > 1 && (
        <div className="flex items-center gap-2.5">
          <div className="flex -space-x-2">
            {faces.map((p) => (
              <Avatar key={p.id} name={p.name} playerId={p.id} className="size-8 ring-2 ring-ground" />
            ))}
          </div>
          <p className="text-sm text-paper-2">{players.length} players here</p>
        </div>
      )}
    </section>
  )
}

/** The party is archived: no more games, just how it ended. */
function PartyOver({ session, recap }: { session: Session; recap: boolean }) {
  return (
    <section aria-label="The party is over" className="mt-7">
      <p className="text-phone-head leading-tight font-extrabold">That's a wrap.</p>
      <p className="mt-1 text-paper-2">
        {session.name} is over. Thanks for playing.{recap && ' Here is your night.'}
      </p>
    </section>
  )
}

/** One row per other game that finished in the last half hour, with when it finished; a tap shows its result. */
function FinishedLately({
  games,
  players,
  meId,
  onOpen,
}: {
  games: SessionGame[]
  players: Player[]
  meId: string
  onOpen: (gameId: string) => void
}) {
  return (
    <section aria-labelledby="finished-lately" className="mt-8 grid grid-cols-1 gap-2">
      <h2 id="finished-lately" className="text-sm on-air text-paper-2">
        Finished lately
      </h2>
      <ul className="grid grid-cols-1 gap-2">
        {games.map((game) => {
          const won = game.winners.includes(meId)
          return (
            <li key={game.id}>
              <button
                type="button"
                onClick={() => onOpen(game.id)}
                className="flex min-h-14 w-full items-center gap-3 rounded-phone bg-overlay px-3.5 py-2.5 text-left transition-colors hover:bg-rule focus-visible:ring-3 focus-visible:ring-gold/50 focus-visible:outline-none"
              >
                {won ? (
                  <CrownIcon weight="fill" className="size-5 shrink-0 text-gold" />
                ) : (
                  <FlagCheckeredIcon weight="duotone" className="size-5 shrink-0 text-paper-2" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{finishedLine(game, players, meId)}</span>
                  <span className="block text-sm text-paper-2">{finishedAt(game)}</span>
                </span>
                <CaretRightIcon className="size-4 shrink-0 text-paper-2" />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/**
 * This phone is no longer in the party: the host gave its name back to the
 * guest list, it moved to another phone, or the host removed the player.
 */
function NotInParty({ party, name, moved, freed }: { party: PublicSession; name: string; moved: boolean; freed: boolean }) {
  // Straight back to Who are you?, with the name for its note (docs/guest-list.md, 6.6).
  if (freed) return <Navigate to={`/join/${party.join_code}`} state={{ freed: name } satisfies FreedState} replace />
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
 * The live game that had the main card until something else took it (another
 * game on the TV, a result card, or its own section when it left the TV),
 * while that round is still live; else null. When the main game finishes, its
 * result keeps the round's key, so a game held behind it stays held. Home
 * keeps its view mounted out of sight, so what the guest had open in it (a
 * vote being picked, a knockout being confirmed) isn't lost.
 */
function useHeldGame(snapshot: Snapshot, main: SessionGame | null): SessionGame | null {
  const key = main ? roundKey(main) : null
  const [mains, setMains] = useState<{ now: string | null; before: string | null }>({ now: key, before: null })
  // Remembered while rendering (React's way to follow a prop's previous value), so the hand-over has no gap.
  if (mains.now !== key) setMains({ now: key, before: mains.now })
  const before = mains.now !== key ? mains.now : mains.before
  if (before === null || before === key) return null
  return snapshot.games.find((g) => roundKey(g) === before && g.status === 'active' && g.archived_at === null) ?? null
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
 * where the last answers would sit below the fold. A sheet covering the page
 * gives way only to a new timed question (sheetGivesWay in running.ts), so a
 * guest who left the hunt's sheet open after a scan still sees the quiz's
 * question in time. The peek over the takeover gives way to it the same way.
 */
function useBringIntoView(
  card: RefObject<HTMLElement | null>,
  snapshot: Snapshot,
  /** The live game on the main card. */
  game: SessionGame | null,
  covered: boolean,
  /** The sheet covering the page, the peek, and whether the main card's question is timed: sheetGivesWay decides whether they close. */
  sheet: { timed: boolean; scanning: boolean; close: () => void; peeking: boolean; closePeek: () => void },
) {
  let question: PromptState | null = null
  for (const prompt of snapshot.prompts) {
    if (prompt.game_id === game?.id && prompt.closed_at === null && (!question || prompt.opened_at > question.opened_at)) question = prompt
  }
  const gameId = game?.id ?? null
  const questionKey = question?.key ?? null
  const seen = useRef<{ gameId: string | null; questionKey: string | null } | null>(null)

  const sheetRef = useRef(sheet)
  useEffect(() => {
    sheetRef.current = sheet
  })

  useEffect(() => {
    const before = seen.current
    seen.current = { gameId, questionKey }
    if (!before) return
    const news = mainCardNews(before, { gameId, questionKey })
    const { timed, scanning, close, peeking, closePeek } = sheetRef.current
    if (peeking) {
      if (!sheetGivesWay({ news, covered: peeking, timed, scanning: false })) return
      closePeek()
    }
    if (covered) {
      if (!sheetGivesWay({ news, covered, timed, scanning })) return
      close()
    }
    const element = card.current
    const box = element?.getBoundingClientRect()
    if (!news || !element || !box || (box.top >= 0 && box.bottom <= window.innerHeight)) return
    // Never under the fingers of a guest typing into a field: the game's own view shows what is new.
    if (isTypingTarget(document.activeElement)) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    element.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
  }, [gameId, questionKey, covered, card])
}
