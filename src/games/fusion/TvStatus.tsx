import { CrownIcon, DetectiveIcon } from '@phosphor-icons/react'
import { BandCount, BandLine, BandText, Tab } from '@/components/tv/onAir'
import { plural, type FusionGame } from '@/games/fusion/logic'
import { nameOf, publicOf, totalVotes } from '@/games/fusion/view'
import type { TvStatusProps } from '@/games/types'

type Pub = NonNullable<ReturnType<typeof publicOf>>

/**
 * Fusion on the TV while it runs (docs/identity.md, The TV's frame). In the
 * band while another game holds the stage: the votes, then the reveal's
 * progress. In the strap while it holds the stage: where the game is. As a
 * card: pictures and votes, then the reveal's progress. CSS only, no motion
 * library.
 */
export default function TvStatus(props: TvStatusProps<FusionGame>) {
  if (props.variant === 'band') return <BandStatus {...props} />
  if (props.variant === 'strap') return strapWords(publicOf(props.publicState), props.game.status === 'finished')
  return <CardStatus {...props} />
}

TvStatus.variants = ['band', 'strap'] as const

function revealedOf(pub: Pub): number {
  return pub.pictures.filter((p) => p.revealed).length
}

function strapWords(pub: Pub | null, finished: boolean): string {
  if (finished || pub?.phase === 'done') return 'Final result'
  if (!pub) return 'Hanging the pictures'
  const total = pub.pictures.length
  if (pub.phase === 'voting') return `${plural(total, 'picture')} on the wall. Vote on your phone`
  const revealed = revealedOf(pub)
  return revealed === 0 ? 'Voting is closed' : `${revealed} of ${total} revealed`
}

function BandStatus({ game, publicState, tallies }: TvStatusProps<FusionGame>) {
  const pub = publicOf(publicState)
  const total = pub?.pictures.length ?? 0
  return (
    <BandLine tab={<Tab tone="paper">{game.title}</Tab>}>
      {pub?.phase === 'voting' ? (
        <>
          <BandCount>{plural(totalVotes(tallies), 'vote')}</BandCount>
          <BandText>
            on {plural(total, 'picture')}. Vote on your phone
          </BandText>
        </>
      ) : (
        pub && (
          <>
            <BandCount>
              {revealedOf(pub)} of {total} revealed
            </BandCount>
            <BandText>Voting is closed</BandText>
          </>
        )
      )}
    </BandLine>
  )
}

function CardStatus({ game, players, publicState, tallies }: TvStatusProps<FusionGame>) {
  const pub = publicOf(publicState)

  return (
    <section className="grid min-w-0 grid-cols-1 gap-3 rounded-3xl bg-raised p-5 short:gap-2 short:p-4">
      <header className="flex min-w-0 items-center gap-2.5">
        <DetectiveIcon weight="duotone" className="size-7 shrink-0 text-paper-2 short:size-6" />
        <h3 className="min-w-0 flex-1 truncate text-xl font-bold short:text-lg">{game.title}</h3>
      </header>
      {pub && <Card pub={pub} players={players} tallies={tallies} />}
    </section>
  )
}

function Card({ pub, players, tallies }: Pick<TvStatusProps<FusionGame>, 'players' | 'tallies'> & { pub: Pub }) {
  const total = pub.pictures.length
  const votes = totalVotes(tallies)
  const revealed = revealedOf(pub)
  // How far voting is: every guest voting on every picture fills the bar.
  const share = total > 0 && players.length > 0 ? Math.min(1, votes / (total * players.length)) : 0
  const leader = pub.top[0]

  return (
    <>
      {pub.phase === 'voting' ? (
        <>
          <p className="text-2xl font-bold short:text-xl">Vote on your phone</p>
          <p className="text-lg text-paper-2 short:text-base">
            {plural(total, 'picture')}, {plural(votes, 'vote')}
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-rule" role="img" aria-label={`${Math.round(share * 100)}% voted`}>
            <div className="h-full rounded-full bg-paper transition-[width] duration-700" style={{ width: `${share * 100}%` }} />
          </div>
        </>
      ) : (
        <p className="text-xl font-bold short:text-lg">
          {pub.phase === 'locked' ? `Voting closed. ${revealed} of ${total} revealed` : 'The reveal is done'}
        </p>
      )}
      {leader && (
        <p className="flex min-w-0 items-center gap-2 text-lg">
          <CrownIcon weight="fill" className="shrink-0 text-gold" />
          <span className="min-w-0 truncate">{nameOf(players, leader.playerId)}</span>
          <span className="ml-auto shrink-0 font-bold text-gold tabular-nums">{leader.points}</span>
        </p>
      )}
    </>
  )
}
