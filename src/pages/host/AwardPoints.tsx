import { ArrowCounterClockwiseIcon, ArrowLeftIcon, ScanIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from '@/lib/toast'
import Avatar from '@/components/Avatar'
import { Screen } from '@/components/layout'
import StatusBadge from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatPoints } from '@/lib/format'
import { usePlayerEvents, usePlayerPoints, useSessionGames } from '@/lib/queries'
import { supabase } from '@/lib/supabase'
import type { Player, Session } from '@/lib/types'

const QUICK_POINTS = [1, 2, 3, 5, 10]
const NO_GAME = 'none'

export default function AwardPoints({ player, session }: { player: Player; session: Session }) {
  const { data: points } = usePlayerPoints(player.id)
  const { data: games } = useSessionGames(session.id)
  const { data: events } = usePlayerEvents(player.id)
  // Points go to the live game unless the host picks another one.
  const [pickedGameId, setPickedGameId] = useState<string>()
  const gameId = pickedGameId ?? games?.find((g) => g.status === 'active')?.id ?? NO_GAME
  const [reason, setReason] = useState('')
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)

  async function award(amount: number) {
    if (!Number.isInteger(amount) || amount === 0) return
    setBusy(true)
    const { error } = await supabase.from('score_events').insert({
      session_id: session.id,
      player_id: player.id,
      game_id: gameId === NO_GAME ? null : gameId,
      points: amount,
      reason: reason.trim() || null,
    })
    setBusy(false)
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success(`${formatPoints(amount)} to ${player.name}`)
    setCustom('')
  }

  async function undo(eventId: number) {
    const { error } = await supabase.from('score_events').delete().eq('id', eventId)
    if (error) toast.error(error.message)
    else toast('Undone')
  }

  const gameTitle = (id: string | null) => games?.find((g) => g.id === id)?.title

  return (
    <Screen>
      <nav className="flex justify-between">
        <Button asChild variant="ghost" size="lg" className="-ml-3 min-w-0 text-muted-foreground">
          <Link to={`/host/s/${session.id}`}>
            <ArrowLeftIcon />
            <span className="truncate">{session.name}</span>
          </Link>
        </Button>
        <Button asChild variant="ghost" size="lg" className="-mr-3 text-primary">
          <Link to="/host/scan">
            <ScanIcon />
            Scan next
          </Link>
        </Button>
      </nav>

      <header className="mt-4 flex items-center gap-3">
        <Avatar name={player.name} className="size-14 text-xl" />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-sm text-muted-foreground">{player.code}</p>
          <h1 className="truncate text-3xl font-bold">{player.name}</h1>
        </div>
        <p className="text-4xl font-black text-primary tabular-nums">{points ?? 0}</p>
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
                {games?.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.title}
                    {g.status === 'active' && <StatusBadge status="active" />}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="reason">Reason (optional)</Label>
            <Input
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Won the round"
              maxLength={200}
            />
          </div>
          <div className="grid grid-cols-5 gap-2">
            {QUICK_POINTS.map((n) => (
              <Button key={n} size="xl" className="px-0 text-lg" disabled={busy} onClick={() => void award(n)}>
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
        <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">History</h2>
        {events?.length === 0 && <p className="text-sm text-muted-foreground">No points yet.</p>}
        <ul className="divide-y">
          {events?.map((ev) => (
            <li key={ev.id} className="flex items-center gap-3 py-1.5">
              <span className={`w-12 font-bold tabular-nums ${ev.points > 0 ? 'text-primary' : 'text-destructive'}`}>
                {formatPoints(ev.points)}
              </span>
              <span className="flex-1 truncate text-sm text-muted-foreground">
                {[gameTitle(ev.game_id), ev.reason].filter(Boolean).join(' · ') || 'No reason given'}
              </span>
              <Button variant="ghost" className="text-muted-foreground" onClick={() => void undo(ev.id)}>
                <ArrowCounterClockwiseIcon />
                Undo
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </Screen>
  )
}
