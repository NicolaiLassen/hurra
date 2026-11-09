import { CrownIcon, DetectiveIcon } from '@phosphor-icons/react'
import { plural, type FusionGame } from '@/games/fusion/logic'
import { nameOf, publicOf, totalVotes } from '@/games/fusion/view'
import type { TvStatusProps } from '@/games/types'

/**
 * The TV rail card while fusion runs in the background: pictures and votes,
 * then the reveal's progress. A whole card, title included, like the other
 * games' rail cards. CSS only, no motion library.
 */
export default function TvStatus({ game, players, publicState, tallies }: TvStatusProps<FusionGame>) {
  const pub = publicOf(publicState)

  return (
    <section className="grid min-w-0 grid-cols-1 gap-3 rounded-3xl bg-card/80 p-5 ring-1 ring-foreground/10 backdrop-blur short:gap-2 short:p-4">
      <header className="flex min-w-0 items-center gap-2.5">
        <DetectiveIcon weight="duotone" className="size-7 shrink-0 text-confetti-violet short:size-6" />
        <h3 className="min-w-0 flex-1 truncate text-xl font-bold short:text-lg">{game.title}</h3>
      </header>
      {pub && <Status pub={pub} players={players} tallies={tallies} />}
    </section>
  )
}

function Status({
  pub,
  players,
  tallies,
}: Pick<TvStatusProps<FusionGame>, 'players' | 'tallies'> & { pub: NonNullable<ReturnType<typeof publicOf>> }) {
  const total = pub.pictures.length
  const votes = totalVotes(tallies)
  const revealed = pub.pictures.filter((p) => p.revealed).length
  // How far voting is: every guest voting on every picture fills the bar.
  const share = total > 0 && players.length > 0 ? Math.min(1, votes / (total * players.length)) : 0
  const leader = pub.top[0]

  return (
    <>
      {pub.phase === 'voting' ? (
        <>
          <p className="text-2xl font-bold short:text-xl">Vote on your phone</p>
          <p className="text-lg text-muted-foreground tabular-nums short:text-base">
            {plural(total, 'picture')}, {plural(votes, 'vote')}
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-white/10" role="img" aria-label={`${Math.round(share * 100)}% voted`}>
            <div
              className="h-full rounded-full bg-confetti-violet transition-[width] duration-700"
              style={{ width: `${share * 100}%` }}
            />
          </div>
        </>
      ) : (
        <p className="text-xl font-bold tabular-nums short:text-lg">
          {pub.phase === 'locked' ? `Voting closed. ${revealed} of ${total} revealed` : 'The reveal is done'}
        </p>
      )}
      {leader && (
        <p className="flex min-w-0 items-center gap-2 text-lg">
          <CrownIcon weight="fill" className="shrink-0 text-primary" />
          <span className="min-w-0 truncate">{nameOf(players, leader.playerId)}</span>
          <span className="ml-auto shrink-0 font-bold text-primary tabular-nums">{leader.points}</span>
        </p>
      )}
    </>
  )
}
