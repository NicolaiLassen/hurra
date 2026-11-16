import { UsersThreeIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { BandLine, BandSince, BandText, Tab } from '@/components/tv/onAir'
import Faces from '@/games/in-person/Faces'
import type { InPersonGame } from '@/games/in-person/logic'
import { nameList, runningFor, topScorers } from '@/games/in-person/summary'
import type { TvStatusProps } from '@/games/types'

/**
 * The round on the TV while it runs (docs/identity.md, The TV's frame). In the
 * strap while it holds the stage: "Played in person". In the band while
 * another game holds the stage: since when it has run and who leads. As a
 * card: its title, how long it has run, "Played in person" and who leads this
 * round ("Ana leads with 7"), from this game's own points.
 */
export default function TvStatus(props: TvStatusProps<InPersonGame>) {
  if (props.variant === 'band') return <BandStatus {...props} />
  if (props.variant === 'strap') return props.game.status === 'finished' ? 'Final result' : 'Played in person'
  return <CardStatus {...props} />
}

TvStatus.variants = ['band', 'strap'] as const

/** "Ana leads with 7", "Ana and Bo lead with 7", "4 players lead with 7". */
function leadLine(names: readonly string[], points: number) {
  // Past two names the line gets long; the count says enough.
  const who = names.length > 2 ? `${names.length} players` : nameList(names)
  return (
    <>
      <strong>{who}</strong> {names.length > 1 ? 'lead' : 'leads'} with <strong>{points}</strong>
    </>
  )
}

function BandStatus({ game, players, gamePoints }: TvStatusProps<InPersonGame>) {
  const leaders = topScorers(gamePoints, players)
  return (
    <BandLine tab={<Tab tone="paper">{game.title}</Tab>}>
      {game.started_at !== null && <BandSince at={game.started_at} />}
      <BandText>{leaders ? leadLine(leaders.players.map((p) => p.name), leaders.points) : 'Played in person'}</BandText>
    </BandLine>
  )
}

function CardStatus({ game, players, gamePoints, serverNow }: TvStatusProps<InPersonGame>) {
  const now = useNow(serverNow, 30_000)
  const leaders = topScorers(gamePoints, players)
  const names = leaders?.players.map((p) => p.name) ?? []
  // Past two names the line can't fit the card; the faces show who they are.
  const who = names.length > 2 ? `${names.length} players` : nameList(names)

  return (
    // min-w-0 and grid-cols-1: as wide as the strip gives it, so a long title or
    // name truncates instead of widening the card.
    <section className="grid min-w-0 grid-cols-1 gap-3 rounded-3xl bg-raised p-5 short:gap-2 short:p-4">
      <header className="flex min-w-0 items-center gap-2.5">
        <UsersThreeIcon weight="duotone" className="size-7 shrink-0 text-paper-2 short:size-6" />
        <h3 className="min-w-0 flex-1 truncate text-xl font-bold short:text-lg">{game.title}</h3>
        {game.started_at !== null && (
          <span className="shrink-0 text-lg text-paper-2 tabular-nums short:text-base">{runningFor(now - game.started_at)}</span>
        )}
      </header>
      <p className="text-lg text-paper-2 short:text-base">Played in person</p>
      {leaders ? (
        <div className="flex min-w-0 items-center gap-3">
          <Faces names={names} size="lg" />
          <p className="flex min-w-0 items-baseline gap-1.5 text-xl short:text-lg">
            <span className="truncate font-semibold">{who}</span>
            <span className="shrink-0 text-paper-2">{names.length > 1 ? 'lead' : 'leads'} with</span>
            <span className="shrink-0 font-black text-gold tabular-nums">{leaders.points}</span>
          </p>
        </div>
      ) : (
        <p className="text-xl text-paper-2 short:text-lg">No points yet</p>
      )}
    </section>
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
