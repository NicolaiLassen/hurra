import { ArrowCounterClockwiseIcon, ArrowLeftIcon, ArrowsLeftRightIcon, ScanIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import Avatar from '@/components/Avatar'
import { errorMessage } from '@/components/host/hostCalls'
import MovePlayerDialog, { type MovingPlayer } from '@/components/host/MovePlayerDialog'
import { defaultAwardGame } from '@/components/host/scene'
import { useDialogTarget } from '@/components/host/useDialogTarget'
import { Notice, Screen } from '@/components/layout'
import ProfileBadges from '@/components/ProfileBadges'
import QueryGate from '@/components/QueryGate'
import StateChip from '@/components/host/StateChip'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatPoints } from '@/lib/format'
import { awardPoints, undoPoints, usePlayerEvents } from '@/lib/queries'
import { toast } from '@/lib/toast'
import type { Player, Snapshot } from '@/lib/types'
import { LiveSessionProvider, useLive } from '@/lib/useLive'
import { SessionNotFound, WayBack } from '@/pages/NotFound'

const QUICK_POINTS = [1, 2, 3, 5, 10]
const NO_GAME = 'none'

/**
 * The award page (docs/engine-v2.md, 7.3): give or take points from one guest,
 * with their history and Undo, and Move to a new phone. It mounts its own live
 * session on the host's screen, so it works wherever the player QR page (/p/:code)
 * renders it. `?game=<id>` (from a game's Scan a player) picks the game the
 * points go to.
 */
export default function AwardPoints({ playerId, sessionId }: { playerId: string; sessionId: string }) {
  return (
    <LiveSessionProvider sessionId={sessionId} screen="host">
      <AwardGate playerId={playerId} />
    </LiveSessionProvider>
  )
}

function AwardGate({ playerId }: { playerId: string }) {
  const { query } = useLive()
  return (
    <QueryGate query={query} notFound={<SessionNotFound />}>
      {(snapshot) => {
        const player = snapshot.session ? snapshot.players.find((p) => p.id === playerId) : undefined
        return player ? <AwardPage snapshot={snapshot} player={player} /> : <PlayerGone />
      }}
    </QueryGate>
  )
}

/** The player left the party (or was removed) while this page was open. */
function PlayerGone() {
  return (
    <Notice
      title="Unknown player"
      actions={
        <>
          <Button asChild size="xl">
            <Link to="/host/scan">
              <ScanIcon />
              Scan again
            </Link>
          </Button>
          <WayBack back="host" variant="secondary" />
        </>
      }
    >
      This player isn't in the party anymore. They may have been removed.
    </Notice>
  )
}

function AwardPage({ snapshot, player }: { snapshot: Snapshot; player: Player }) {
  const session = snapshot.session!
  const { refresh } = useLive()
  const [params] = useSearchParams()
  const points = snapshot.standings.find((row) => row.player_id === player.id)?.points ?? 0
  const games = snapshot.games.filter((g) => g.archived_at === null)
  const { data: events } = usePlayerEvents(player.id, snapshot.now)
  // Points go to the game the host came from, the stage game or the newest live game, unless the host picks another.
  const [pickedGameId, setPickedGameId] = useState<string>()
  // A picked game that was archived or deleted meanwhile falls back to the default.
  const picked = pickedGameId === NO_GAME || games.some((g) => g.id === pickedGameId) ? pickedGameId : undefined
  const gameId = picked ?? defaultAwardGame(snapshot, params.get('game')) ?? NO_GAME
  const [reason, setReason] = useState('')
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const moving = useDialogTarget<MovingPlayer>()
  const scanNext = gameId === NO_GAME ? '/host/scan' : `/host/scan?game=${gameId}`

  async function award(amount: number) {
    if (!Number.isInteger(amount) || amount === 0 || busy) return
    setBusy(true)
    try {
      await awardPoints({ sessionId: session.id, playerId: player.id, gameId: gameId === NO_GAME ? null : gameId, points: amount, reason })
      toast.success(`${formatPoints(amount)} to ${player.name}`)
      setCustom('')
      refresh()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function undo(eventId: number) {
    try {
      await undoPoints(eventId)
      toast('Undone')
      refresh()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const gameTitle = (id: string | null) => snapshot.games.find((g) => g.id === id)?.title

  return (
    <Screen>
      <nav className="flex justify-between">
        <Button asChild variant="ghost" size="lg" className="-ml-3 min-w-0 text-muted-foreground">
          <Link to={`/host/s/${session.id}`}>
            <ArrowLeftIcon />
            <span className="truncate">{session.name}</span>
          </Link>
        </Button>
        <Button asChild variant="ghost" size="lg" className="-mr-3">
          <Link to={scanNext}>
            <ScanIcon />
            Scan next
          </Link>
        </Button>
      </nav>

      <header className="mt-4 flex items-center gap-3">
        <Avatar name={player.name} playerId={player.id} className="size-14" />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-sm text-muted-foreground">{player.code}</p>
          <h1 className="truncate text-3xl font-extrabold">{player.name}</h1>
          <ProfileBadges profile={player.profile} className="mt-1" />
        </div>
        <p className="tv-num text-5xl leading-none text-paper">{points}</p>
      </header>

      <Card className="mt-6">
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="award-game">For game</Label>
            <Select value={gameId} onValueChange={setPickedGameId}>
              <SelectTrigger id="award-game" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_GAME}>No specific game</SelectItem>
                {games.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.title}
                    {g.status === 'active' && <StateChip state="active" />}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="reason">Reason (optional)</Label>
            <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Won the round" maxLength={200} />
          </div>
          <div className="grid grid-cols-5 gap-2">
            {QUICK_POINTS.map((n) => (
              // Five equal choices, so none of them is gold (docs/identity.md): the overlay, with condensed numerals.
              <Button key={n} size="xl" variant="secondary" className="tv-num px-0 text-2xl" disabled={busy} onClick={() => void award(n)}>
                +{n}
              </Button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void award(Number(custom))
            }}
          >
            {/* No inputMode="numeric": the iOS digit pad has no minus key. */}
            <Input
              type="number"
              step={1}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Other amount, e.g. -2"
              aria-label="Other amount"
            />
            <Button type="submit" variant="secondary" size="lg" disabled={busy || !Number(custom)}>
              Give
            </Button>
          </form>
        </CardContent>
      </Card>

      <section className="mt-6">
        <h2 className="mb-2 text-base font-extrabold">History</h2>
        {events?.length === 0 && <p className="text-sm text-muted-foreground">No points yet.</p>}
        <ul className="divide-y divide-rule">
          {events?.map((ev) => (
            <li key={ev.id} className="flex items-center gap-3 py-1.5">
              <span className={`tv-num w-12 text-lg ${ev.points > 0 ? 'text-paper' : 'text-paper-2'}`}>
                {formatPoints(ev.points)}
              </span>
              <span className="flex-1 truncate text-sm text-muted-foreground">
                {[gameTitle(ev.game_id), ev.reason].filter(Boolean).join(' · ') || (ev.awarded_by ? 'No reason given' : 'A game bonus')}
              </span>
              <Button variant="ghost" className="text-muted-foreground" onClick={() => void undo(ev.id)}>
                <ArrowCounterClockwiseIcon />
                Undo
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8 border-t border-rule pt-6">
        <h2 className="text-base font-extrabold">New phone?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          If {player.name} lost their phone or changed browser, move their player to the new one. Their points stay.
        </p>
        <Button variant="secondary" size="lg" className="mt-3" onClick={() => moving.show({ id: player.id, name: player.name })}>
          <ArrowsLeftRightIcon />
          Move to a new phone
        </Button>
      </section>

      <MovePlayerDialog player={moving.target} open={moving.open} onOpenChange={moving.onOpenChange} joinCode={session.join_code} />
    </Screen>
  )
}
