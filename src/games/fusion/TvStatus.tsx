import { DetectiveIcon } from '@phosphor-icons/react'
import { CARD } from '@/components/tv/look'
import { BandCount, BandLine, BandText, Tab } from '@/components/tv/onAir'
import type { FusionGame } from '@/games/fusion/logic'
import { readPublic, revealedCount, strapWords, type FusionPublicState } from '@/games/fusion/shapes'
import type { TvStatusProps } from '@/games/types'
import { cn } from '@/lib/utils'

/**
 * Participant fusion on the TV while it runs (docs/identity.md, The TV's
 * frame). In the strap while it holds the stage: where the round is ("12
 * pictures, starting soon", "4 of 12 revealed", "Picture 4 of 12", "Final
 * result"). In the band, when another screen holds the stage:
 * its paper tab and the same, with the figures and names standing out. As a
 * card beside the podium: the title and the same words. CSS only, no motion
 * library: the registry brings this file to every phone.
 */
export default function TvStatus(props: TvStatusProps<FusionGame>) {
  if (props.variant === 'band') return <BandStatus {...props} />
  if (props.variant === 'strap') return <StrapWords {...props} />
  return <CardStatus {...props} />
}

TvStatus.variants = ['band', 'strap'] as const

function StrapWords({ game, publicState }: TvStatusProps<FusionGame>) {
  const pub = readPublic(publicState)
  return game.status === 'finished' ? 'Final result' : strapWords(pub)
}

/** What the round is doing, its figures and names in <strong> (paper, bold) on the band and the card. */
function Status({ pub, locked }: { pub: FusionPublicState; locked: number }) {
  const current = pub.current ? pub.pictures.find((p) => p.n === pub.current!.n) : undefined
  switch (pub.phase) {
    case 'lobby':
      return <>Starting soon</>
    case 'wall': {
      const revealed = revealedCount(pub)
      return revealed > 0 ? (
        <>
          <strong>
            {revealed} of {pub.pictures.length}
          </strong>{' '}
          revealed
        </>
      ) : (
        <>{strapWords(pub)}</>
      )
    }
    case 'asking':
      return (
        <>
          <strong>{locked}</strong> {locked === 1 ? 'has' : 'have'} locked in on <strong>{current?.label}</strong>
        </>
      )
    case 'reveal': {
      const reveal = current?.revealed
      if (!current || !reveal) return <>{strapWords(pub)}</>
      return (
        <>
          <strong>{current.label}</strong> was <strong>{reveal.names[0]}</strong> and <strong>{reveal.names[1]}</strong>
        </>
      )
    }
    case 'done':
      return <>Final result</>
  }
}

function BandStatus({ game, publicState, tallies }: TvStatusProps<FusionGame>) {
  const pub = readPublic(publicState)
  const locked = pub?.current ? (tallies[pub.current.key] ?? 0) : 0
  return (
    <BandLine tab={<Tab tone="paper">{game.title}</Tab>}>
      {pub ? (
        pub.phase === 'asking' ? (
          // The count in the band's figures, as Last one standing's "18 of 24 still in".
          <>
            <BandCount>{locked}</BandCount>
            <BandText>
              {locked === 1 ? 'has' : 'have'} locked in on <strong>{pub.pictures.find((p) => p.n === pub.current?.n)?.label}</strong>
            </BandText>
          </>
        ) : (
          <BandText>
            <Status pub={pub} locked={locked} />
          </BandText>
        )
      ) : (
        <BandText>Getting ready</BandText>
      )}
    </BandLine>
  )
}

function CardStatus({ game, publicState, tallies }: TvStatusProps<FusionGame>) {
  const pub = readPublic(publicState)
  const locked = pub?.current ? (tallies[pub.current.key] ?? 0) : 0
  return (
    <section className={cn(CARD, 'grid min-w-0 grid-cols-1 gap-3 p-5 short:gap-2 short:p-4')}>
      <header className="flex min-w-0 items-center gap-3">
        <DetectiveIcon weight="duotone" className="size-8 shrink-0 text-paper-2 short:size-7" />
        <h3 className="min-w-0 flex-1 truncate text-tv-tab font-bold short:text-tv-floor">{game.title}</h3>
      </header>
      <p className="text-tv-floor text-paper-2 [&_strong]:font-bold [&_strong]:text-paper">
        {pub ? <Status pub={pub} locked={locked} /> : 'Getting ready'}
      </p>
    </section>
  )
}
