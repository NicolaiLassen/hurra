import { UsersThreeIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import Faces from '@/games/in-person/Faces'
import type { InPersonGame } from '@/games/in-person/logic'
import { nameList, runningFor, topScorers } from '@/games/in-person/summary'
import type { TvStatusProps } from '@/games/types'

/**
 * The round's card in the TV rail while another game holds the stage: its
 * title, how long it has run, "Played in person" and who leads this round
 * ("Ana leads with 7"), from this game's own points.
 */
export default function TvStatus({ game, players, gamePoints, serverNow }: TvStatusProps<InPersonGame>) {
  const now = useNow(serverNow, 30_000)
  const leaders = topScorers(gamePoints, players)
  const names = leaders?.players.map((p) => p.name) ?? []
  // Past two names the line can't fit the rail; the faces show who they are.
  const who = names.length > 2 ? `${names.length} players` : nameList(names)

  return (
    // min-w-0 and grid-cols-1: as wide as the rail gives it, so a long title or
    // name truncates instead of widening the card.
    <div className="grid min-w-0 grid-cols-1 gap-1.5">
      <div className="flex items-center gap-2.5">
        <UsersThreeIcon weight="duotone" className="size-7 shrink-0 text-confetti-teal short:size-6" />
        <p className="min-w-0 flex-1 truncate text-2xl font-bold short:text-xl">{game.title}</p>
        {game.started_at !== null && (
          <span className="shrink-0 text-lg text-muted-foreground tabular-nums short:text-base">
            {runningFor(now - game.started_at)}
          </span>
        )}
      </div>
      <p className="text-lg text-muted-foreground short:text-base">Played in person</p>
      {leaders ? (
        <div className="mt-1 flex items-center gap-3">
          <Faces names={names} size="lg" />
          <p className="flex min-w-0 items-baseline gap-1.5 text-xl short:text-lg">
            <span className="truncate font-semibold">{who}</span>
            <span className="shrink-0 text-muted-foreground">{names.length > 1 ? 'lead' : 'leads'} with</span>
            <span className="shrink-0 font-black text-primary tabular-nums">{leaders.points}</span>
          </p>
        </div>
      ) : (
        <p className="mt-1 text-xl text-muted-foreground short:text-lg">No points yet</p>
      )}
    </div>
  )
}

/** The server time, read again every `ms`, so the card's running time moves on by itself. */
function useNow(serverNow: () => number, ms: number): number {
  const [now, setNow] = useState(serverNow)
  const latest = useRef(serverNow)
  useEffect(() => {
    latest.current = serverNow
  }, [serverNow])
  useEffect(() => {
    const timer = setInterval(() => setNow(latest.current()), ms)
    return () => clearInterval(timer)
  }, [ms])
  return now
}
