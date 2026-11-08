import { ChampagneIcon, QrCodeIcon, TrophyIcon } from '@phosphor-icons/react'
import { QRCodeSVG } from 'qrcode.react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router'
import { toast } from '@/lib/toast'
import Avatar from '@/components/Avatar'
import { Notice, Screen } from '@/components/layout'
import ProfileBadges from '@/components/ProfileBadges'
import QueryGate from '@/components/QueryGate'
import SoundToggle from '@/components/SoundToggle'
import Standings from '@/components/Standings'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { getGameModule } from '@/games/registry'
import { toastAnnouncement } from '@/lib/announcement'
import { callGame } from '@/lib/gameApi'
import { useLoaderHold } from '@/lib/loader'
import {
  loadMembership,
  sessionExists,
  useFeed,
  usePlayerGameView,
  usePlayers,
  useScoreboard,
  useSession,
  useSessionGames,
} from '@/lib/queries'
import { playSound } from '@/lib/sound'
import { strongestSound } from '@/lib/soundPolicy'
import { rememberJoinCode } from '@/lib/storage'
import type { Player, Session, SessionGame } from '@/lib/types'
import { playerUrl } from '@/lib/urls'
import { useLiveQuery } from '@/lib/useLiveQuery'
import { PartyNotFound } from '@/pages/NotFound'

export default function Play() {
  const code = (useParams().joinCode ?? '').toUpperCase()
  const load = useCallback(() => loadMembership(code), [code])
  const membership = useLiveQuery(load)

  return (
    <QueryGate query={membership} notFound={<PartyNotFound code={code} />}>
      {({ session, player }) =>
        player ? <PlayerHome session={session} player={player} /> : <Navigate to={`/join/${code}`} replace />
      }
    </QueryGate>
  )
}

function PlayerHome({ session: joinedSession, player: joined }: { session: Session; player: Player }) {
  // Live, so archiving or deleting the party reaches phones that are open.
  const { data: liveSession } = useSession(joinedSession.id)
  const session = liveSession ?? joinedSession
  const { data: games, error: gamesError } = useSessionGames(session.id)
  const { data: players, error: playersError } = usePlayers(session.id)
  const { data: scores, error: scoresError } = useScoreboard(session.id)
  const [qrOpen, setQrOpen] = useState(false)
  // Keep the loader up until the first screen is complete, so the lobby never
  // flashes before the live game appears.
  useLoaderHold((!games && !gamesError) || (!players && !playersError) || (!scores && !scoresError))
  const activeGame = games?.find((g) => g.status === 'active')
  // The live row, so badges games add to the profile show up right away.
  const player = players?.find((p) => p.id === joined.id) ?? joined
  const points = scores?.find((row) => row.player_id === player.id)?.points
  const missing = players !== undefined && !players.some((p) => p.id === joined.id)
  const removed = usePartyStillThere(session.id, missing)
  const over = session.archived_at !== null

  useFeedToasts(session.id, player.id)
  useGameRemovedToast(session.id, games, activeGame)
  // A player code scanned with the camera app (see PlayerCard): the live game gets
  // it if it takes codes; otherwise it's just whose code it is.
  const scan = useScannedCode()
  const takesScans = !over && activeGame !== undefined && getGameModule(activeGame.game_type)?.acceptsScans === true
  const ready = games !== undefined && players !== undefined
  useEffect(() => {
    if (!scan.code || !ready || takesScans) return
    const owner = players?.find((p) => p.code === scan.code)
    toast.info(owner ? `That's ${owner.name}'s code` : "That code isn't from this party", {
      description: owner ? 'Only the host can give points with it.' : undefined,
    })
    scan.done()
  }, [scan, ready, takesScans, players])

  // Stored again on every fresh read of the party, so a not-found that turns out
  // to be wrong (say, a read during a failed token refresh) can't drop it for good.
  useEffect(() => {
    if (liveSession !== null) rememberJoinCode(session.join_code)
  }, [liveSession, session.join_code])

  if (liveSession === null) return <PartyNotFound code={session.join_code} />
  if (removed) {
    return (
      <Notice
        title={`You're no longer in ${session.name}`}
        actions={
          <Button asChild size="xl">
            <Link to={`/join/${session.join_code}`}>Join again</Link>
          </Button>
        }
      >
        The host took you off the player list. Join again to keep playing.
      </Notice>
    )
  }

  return (
    // Bottom padding keeps the last card clear of the "Show my code" bar.
    <Screen className={over ? undefined : 'pb-32'}>
      <header className="flex items-center gap-3">
        <Avatar name={player.name} className="size-12 text-lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-muted-foreground">{session.name}</p>
          <h1 className="truncate text-2xl leading-tight font-bold">{player.name}</h1>
          <ProfileBadges profile={player.profile} className="mt-1" />
        </div>
        <SoundToggle className="-mr-1 shrink-0" />
        <div className="shrink-0 rounded-2xl bg-primary px-4 py-2 text-center text-primary-foreground">
          <p className="text-2xl leading-none font-black tabular-nums">{points ?? 0}</p>
          <p className="text-[0.65rem] font-bold tracking-wide uppercase">points</p>
        </div>
      </header>

      <Card className="mt-6">
        <CardContent>
          {over ? (
            <PartyOver session={session} />
          ) : activeGame ? (
            <ActiveGame
              session={session}
              game={activeGame}
              player={player}
              players={players ?? []}
              scannedCode={takesScans ? (scan.code ?? undefined) : undefined}
              onScanHandled={scan.done}
            />
          ) : (
            <Lobby players={players ?? []} />
          )}
        </CardContent>
      </Card>

      {scores && scores.length > 1 && <Standings rows={scores} playerId={player.id} className="mt-4" />}

      {/* Always in reach: in-person games need your code at a moment's notice. */}
      {!over && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/85 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] backdrop-blur">
          <div className="mx-auto max-w-md px-4">
            <Button size="xl" variant="secondary" className="w-full" onClick={() => setQrOpen(true)}>
              <QrCodeIcon />
              Show my code
              <span className="font-mono text-sm tracking-widest text-muted-foreground">{player.code}</span>
            </Button>
          </div>
        </div>
      )}

      {qrOpen && (
        <button
          onClick={() => setQrOpen(false)}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-white p-8 text-black"
        >
          <QRCodeSVG value={playerUrl(player.code)} size={320} level="M" className="h-auto w-full max-w-sm" />
          <div className="text-center">
            <p className="text-3xl font-bold">{player.name}</p>
            <p className="font-mono text-xl tracking-widest">{player.code}</p>
          </div>
          <p className="text-sm text-black/50">Turn your brightness up if it won't scan. Tap anywhere to close.</p>
        </button>
      )}
    </Screen>
  )
}

function ActiveGame({
  session,
  game,
  player,
  players,
  scannedCode,
  onScanHandled,
}: {
  session: Session
  game: SessionGame
  player: Player
  players: Player[]
  scannedCode?: string
  onScanHandled: () => void
}) {
  const gameModule = getGameModule(game.game_type)
  const { data: view } = usePlayerGameView(game.id, player.id)
  const act = useCallback(
    async (action: unknown) => {
      await callGame({ gameId: game.id, type: 'action', action })
    },
    [game.id],
  )

  if (!gameModule) {
    return (
      <p className="text-muted-foreground">
        {game.title} is running, but this app doesn't know the game type “{game.game_type}”.
      </p>
    )
  }
  return (
    <gameModule.PlayerView
      session={session}
      game={game}
      player={player}
      players={players}
      publicState={game.public_state}
      view={view}
      act={act}
      scannedCode={scannedCode}
      onScanHandled={onScanHandled}
    />
  )
}

/** The `?scanned=<player code>` a camera scan of a player QR leads to, and a way to drop it once it's used. */
function useScannedCode() {
  const [params, setParams] = useSearchParams()
  const code = params.get('scanned')?.toUpperCase() ?? null
  const done = useCallback(
    () =>
      setParams(
        (current) => {
          current.delete('scanned')
          return current
        },
        { replace: true },
      ),
    [setParams],
  )
  return useMemo(() => ({ code, done }), [code, done])
}

/**
 * Shows game announcements as they happen. Ones aimed at this player replace
 * the room-wide version of the same moment, and the strongest of their sounds
 * plays (one sound per batch, e.g. the winner hears the fanfare, not a coin too).
 */
function useFeedToasts(sessionId: string, playerId: string) {
  const { data: feed } = useFeed(sessionId, { limit: 10 })
  const seen = useRef<Set<number>>(null)

  useEffect(() => {
    if (!feed) return
    // Announcements from before the page opened aren't news.
    if (!seen.current) {
      seen.current = new Set(feed.map((item) => item.id))
      return
    }
    const fresh = [...feed].reverse().filter((item) => !seen.current!.has(item.id))
    fresh.forEach((item) => seen.current!.add(item.id))

    const mine = fresh.filter((item) => item.audience?.includes(playerId))
    mine.forEach(toastAnnouncement)
    void playSound(strongestSound(mine.map((item) => item.sound)))
    if (mine.length === 0) fresh.filter((item) => !item.audience).forEach(toastAnnouncement)
  }, [feed, playerId])
}

/**
 * Runs `then` only if a fresh read shows the party still exists. Deleting the
 * party empties its games and players in the same transaction, and those live
 * queries can land before the session's, so "the game went" or "you went" must
 * not be said before the party itself is known to be there.
 */
function ifPartyExists(sessionId: string, then: () => void) {
  sessionExists(sessionId).then(
    (exists) => exists && then(),
    () => {},
  )
}

/** True once `missing` (this player is off the list) and the party is confirmed to still exist. */
function usePartyStillThere(sessionId: string, missing: boolean) {
  const [confirmed, setConfirmed] = useState(false)
  useEffect(() => {
    if (!missing) return
    let current = true
    ifPartyExists(sessionId, () => current && setConfirmed(true))
    return () => {
      current = false
    }
  }, [sessionId, missing])
  return missing && confirmed
}

/** Says so when the host deletes the game this phone was showing (it drops back to the lobby). */
function useGameRemovedToast(sessionId: string, games: SessionGame[] | undefined, activeGame: SessionGame | undefined) {
  const shown = useRef<SessionGame | undefined>(undefined)
  useEffect(() => {
    const previous = shown.current
    shown.current = activeGame
    if (previous && !activeGame && games && !games.some((g) => g.id === previous.id)) {
      ifPartyExists(sessionId, () =>
        toast.info(`The host removed ${previous.title}`, { description: 'Back to the lobby until the next game.' }),
      )
    }
  }, [sessionId, games, activeGame])
}

/** The party has been archived: no more games, just how it ended. */
function PartyOver({ session }: { session: Session }) {
  return (
    <div className="grid justify-items-center gap-3 py-4 text-center">
      <TrophyIcon weight="duotone" className="size-14 text-primary" />
      <div>
        <p className="text-xl font-bold">That's a wrap!</p>
        <p className="text-muted-foreground">{session.name} is over. Thanks for playing!</p>
      </div>
    </div>
  )
}

function Lobby({ players }: { players: Player[] }) {
  const faces = players.slice(-5).reverse()
  return (
    <div className="grid justify-items-center gap-3 py-4 text-center">
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
    </div>
  )
}
