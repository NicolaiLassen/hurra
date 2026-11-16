import { CrownIcon, DetectiveIcon, SwordIcon } from '@phosphor-icons/react'
import Avatar from '@/components/Avatar'
import { clockTime } from '@/components/tv/clock'
import { BandCount, BandEvent, BandLine, Stripes, Tab } from '@/components/tv/onAir'
import type { EliminationGame, PublicKnockout } from '@/games/elimination/logic'
import { knockoutLine, nameFrom, roundRoster, topHunters } from '@/games/elimination/roster'
import SurvivorMeter from '@/games/elimination/SurvivorMeter'
import type { TvStatusProps } from '@/games/types'

/**
 * Last one standing on the TV while it runs (docs/identity.md, The TV's frame).
 * In the band, under every other game: the hunt's pink tab with the popper's
 * stripes, "18 of 24 still in" and the latest knockout at its time of day.
 * In the strap, while it holds the stage: how many are still in. As a card:
 * the survivor meter, the top hunter and the latest knockout. No motion
 * library: CSS only, so it costs the TV nothing to load.
 */
export default function TvStatus(props: TvStatusProps<EliminationGame>) {
  if (props.variant === 'band') return <BandStatus {...props} />
  if (props.variant === 'strap') return <StrapWords {...props} />
  return <CardStatus {...props} />
}

TvStatus.variants = ['band', 'strap'] as const

function BandStatus({ game, players, publicState }: TvStatusProps<EliminationGame>) {
  const nameOf = nameFrom(players)
  const roster = publicState ? roundRoster(players, publicState) : null
  const latest = publicState?.feed[0]
  return (
    <BandLine
      tab={
        <>
          <Stripes />
          <Tab tone="pink">{game.title}</Tab>
        </>
      }
    >
      {roster && (
        <BandCount>
          {roster.standing.length} of {roster.total} still in
        </BandCount>
      )}
      {latest && (
        <BandEvent key={`${latest.by}-${latest.target}`} at={latest.at}>
          <strong>{nameOf(latest.by)}</strong> {latest.method === 'catch' ? 'caught' : 'got'} <strong>{nameOf(latest.target)}</strong>
          {/* The task once it's no one's secret, where the line has room for it. */}
          {latest.task && <span className="hidden font-medium @min-[96rem]:inline"> with “{latest.task}”</span>}
        </BandEvent>
      )}
    </BandLine>
  )
}

function StrapWords({ game, players, publicState }: TvStatusProps<EliminationGame>) {
  if (game.status === 'finished') return publicState?.winner ? 'The final knockout' : 'Final result'
  if (!publicState) return 'Getting ready'
  const { standing, total } = roundRoster(players, publicState)
  return `${standing.length} of ${total} still in`
}

function CardStatus({ game, players, publicState }: TvStatusProps<EliminationGame>) {
  return (
    <section className="grid min-w-0 grid-cols-1 gap-4 rounded-3xl bg-raised p-5 short:gap-3 short:p-4">
      <header className="flex min-w-0 items-center gap-2.5">
        <SwordIcon weight="duotone" className="size-7 shrink-0 text-pink short:size-6" />
        <h3 className="min-w-0 flex-1 truncate text-xl font-bold short:text-lg">{game.title}</h3>
      </header>
      {publicState ? <Card players={players} publicState={publicState} /> : null}
    </section>
  )
}

function Card({ players, publicState }: Pick<TvStatusProps<EliminationGame>, 'players' | 'publicState'>) {
  const nameOf = nameFrom(players)
  const { standing, total } = roundRoster(players, publicState)
  const [hunter] = topHunters(publicState, players, 1)
  const latest = publicState.feed[0]

  return (
    <>
      {publicState.winner ? (
        <p className="flex min-w-0 items-center gap-2 text-2xl font-black short:text-xl">
          <CrownIcon weight="fill" className="shrink-0 text-gold" />
          <span className="truncate">{nameOf(publicState.winner)}</span>
          <span className="shrink-0 text-lg font-semibold text-paper-2">wins</span>
        </p>
      ) : (
        <SurvivorMeter alive={standing.length} total={total} size="slim" />
      )}

      {latest ? (
        <div className="grid grid-cols-1 gap-3 border-t border-rule pt-3 short:gap-2">
          {hunter && (
            <p className="flex min-w-0 items-center gap-2.5">
              <span className="shrink-0 text-xs font-semibold tracking-widest text-paper-2 uppercase">Top hunter</span>
              <Avatar name={nameOf(hunter[0])} className="size-8" />
              <span className="min-w-0 flex-1 truncate text-lg font-semibold">{nameOf(hunter[0])}</span>
              <span className="shrink-0 text-2xl font-black text-paper tabular-nums">{hunter[1]}</span>
            </p>
          )}
          {/* The latest knockout, re-keyed per knockout so a new one slides in. */}
          <p
            key={`${latest.by}-${latest.target}`}
            className="flex min-w-0 items-center gap-2.5 animate-in duration-500 fade-in slide-in-from-right-4 motion-reduce:animate-none"
          >
            <MethodIcon method={latest.method} />
            <span className="min-w-0 flex-1 truncate text-lg font-semibold">{knockoutLine(latest, nameOf)}</span>
            <span className="shrink-0 tv-num text-lg text-paper-3">{clockTime(latest.at)}</span>
          </p>
        </div>
      ) : (
        <p className="text-lg text-paper-2">Nobody's out yet. Watch your back.</p>
      )}
    </>
  )
}

function MethodIcon({ method }: { method: PublicKnockout['method'] }) {
  return method === 'catch' ? (
    <DetectiveIcon weight="duotone" className="size-5 shrink-0 text-pink" />
  ) : (
    <SwordIcon weight="duotone" className="size-5 shrink-0 text-pink" />
  )
}
