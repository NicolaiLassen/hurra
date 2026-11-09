import { CrownIcon, DetectiveIcon } from '@phosphor-icons/react'
import { plural, type FusionGame } from '@/games/fusion/logic'
import { nameOf, publicOf, totalVotes } from '@/games/fusion/view'
import type { TvStatusProps } from '@/games/types'

/** The TV rail card while fusion runs in the background: pictures and votes, then the reveal's progress. */
export default function TvStatus({ game, players, publicState, tallies }: TvStatusProps<FusionGame>) {
  const pub = publicOf(publicState)
  if (!pub) return null
  const total = pub.pictures.length
  const votes = totalVotes(tallies)
  const revealed = pub.pictures.filter((p) => p.revealed).length
  // How far voting is: every guest voting on every picture fills the bar.
  const share = total > 0 && players.length > 0 ? Math.min(1, votes / (total * players.length)) : 0
  const leader = pub.top[0]

  return (
    <div className="grid gap-2.5">
      <p className="flex items-center gap-2 text-sm font-semibold tracking-widest text-confetti-violet uppercase">
        <DetectiveIcon weight="duotone" className="size-5 shrink-0" />
        <span className="truncate">{game.title}</span>
      </p>
      {pub.phase === 'voting' ? (
        <>
          <p className="text-2xl font-bold">Who is fused?</p>
          <p className="text-lg text-muted-foreground tabular-nums">
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
        <p className="text-xl font-bold tabular-nums">
          {pub.phase === 'locked' ? `Voting closed. ${revealed} of ${total} revealed` : 'The reveal is done'}
        </p>
      )}
      {leader && (
        <p className="flex items-center gap-2 text-lg">
          <CrownIcon weight="fill" className="shrink-0 text-primary" />
          <span className="min-w-0 truncate">{nameOf(players, leader.playerId)}</span>
          <span className="ml-auto font-bold text-primary tabular-nums">{leader.points}</span>
        </p>
      )}
    </div>
  )
}
