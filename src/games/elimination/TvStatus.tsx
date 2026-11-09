import { CrownIcon, DetectiveIcon, SwordIcon } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import Avatar from '@/components/Avatar'
import type { EliminationGame, PublicKnockout } from '@/games/elimination/logic'
import { nameFrom, roundRoster, timeAgo, topHunters } from '@/games/elimination/roster'
import SurvivorMeter from '@/games/elimination/SurvivorMeter'
import type { TvStatusProps } from '@/games/types'

/**
 * Last one standing on the TV while another game holds the stage: a slim
 * survivor meter ("17 of 45 still standing"), the top hunter and the latest
 * knockout. A whole card, title included, for the rail or the strip under the
 * header. No motion library: CSS only, so it costs the TV nothing to load.
 */
export default function TvStatus({ game, players, publicState, serverNow }: TvStatusProps<EliminationGame>) {
  const now = useNow(serverNow, 30_000)

  return (
    <section className="grid min-w-0 grid-cols-1 gap-4 rounded-3xl bg-card/80 p-5 ring-1 ring-foreground/10 backdrop-blur short:gap-3 short:p-4">
      <header className="flex min-w-0 items-center gap-2.5">
        <SwordIcon weight="duotone" className="size-7 shrink-0 text-confetti-pink short:size-6" />
        <h3 className="min-w-0 flex-1 truncate text-xl font-bold short:text-lg">{game.title}</h3>
      </header>
      {publicState ? <Status players={players} publicState={publicState} now={now} /> : null}
    </section>
  )
}

function Status({
  players,
  publicState,
  now,
}: Pick<TvStatusProps<EliminationGame>, 'players' | 'publicState'> & { now: number }) {
  const nameOf = nameFrom(players)
  const { standing, total } = roundRoster(players, publicState)
  const [hunter] = topHunters(publicState, players, 1)
  const latest = publicState.feed[0]

  return (
    <>
      {publicState.winner ? (
        <p className="flex min-w-0 items-center gap-2 text-2xl font-black short:text-xl">
          <CrownIcon weight="fill" className="shrink-0 text-primary" />
          <span className="truncate">{nameOf(publicState.winner)}</span>
          <span className="shrink-0 text-lg font-semibold text-muted-foreground">wins</span>
        </p>
      ) : (
        <SurvivorMeter alive={standing.length} total={total} size="slim" />
      )}

      {latest ? (
        <div className="grid grid-cols-1 gap-3 border-t border-foreground/10 pt-3 short:gap-2">
          {hunter && (
            <p className="flex min-w-0 items-center gap-2.5">
              <span className="shrink-0 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
                Top hunter
              </span>
              <Avatar name={nameOf(hunter[0])} className="size-8 text-xs" />
              <span className="min-w-0 flex-1 truncate text-lg font-semibold">{nameOf(hunter[0])}</span>
              <span className="shrink-0 text-2xl font-black text-primary tabular-nums">{hunter[1]}</span>
            </p>
          )}
          {/* The latest knockout, re-keyed per knockout so a new one slides in. */}
          <p
            key={`${latest.by}-${latest.target}`}
            className="flex min-w-0 items-center gap-2.5 animate-in duration-500 fade-in slide-in-from-right-4 motion-reduce:animate-none"
          >
            <MethodIcon method={latest.method} />
            <span className="min-w-0 flex-1 truncate text-lg font-semibold">{describe(latest, nameOf)}</span>
            <span className="shrink-0 text-sm text-muted-foreground">{timeAgo(latest.at, now)}</span>
          </p>
        </div>
      ) : (
        <p className="text-lg text-muted-foreground">Nobody's out yet. Watch your back.</p>
      )}
    </>
  )
}

function describe(k: PublicKnockout, nameOf: (id: string) => string) {
  return k.method === 'catch' ? `${nameOf(k.by)} caught ${nameOf(k.target)}` : `${nameOf(k.by)} got ${nameOf(k.target)}`
}

function MethodIcon({ method }: { method: PublicKnockout['method'] }) {
  return method === 'catch' ? (
    <DetectiveIcon weight="duotone" className="size-5 shrink-0 text-confetti-teal" />
  ) : (
    <SwordIcon weight="duotone" className="size-5 shrink-0 text-confetti-pink" />
  )
}

/** The server time, ticking every `everyMs`, so "2 min ago" keeps up without new data. */
function useNow(serverNow: () => number, everyMs: number) {
  const [now, setNow] = useState(serverNow)
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), everyMs)
    return () => clearInterval(timer)
  }, [serverNow, everyMs])
  return now
}
