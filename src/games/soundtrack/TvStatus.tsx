import { CassetteTapeIcon } from '@phosphor-icons/react'
import { BandCount, BandLine, BandText, Tab } from '@/components/tv/onAir'
import type { TvStatusProps } from '@/games/types'
import type { SoundtrackGame } from './logic'
import { readPublic } from './read'
import { strapWords, typedWords } from './tv/words'
import { promptKey, type SoundtrackPublicState } from './types'

/**
 * Lydspor on the TV while it runs (docs/identity.md, The TV's frame). In the
 * strap while it holds the stage: where the round is ("Song 5 of 8", "Reveal
 * 1 of 8"). In the band while another game holds the stage: where it is, and
 * the titles typed for the song playing or how the latest reveal went. As a
 * card: the same, with the game's icon and title. Counts only, never an
 * answer. CSS only, no motion library: the registry brings this to phones.
 */
export default function TvStatus(props: TvStatusProps<SoundtrackGame>) {
  if (props.variant === 'band') return <BandStatus {...props} />
  if (props.variant === 'strap') return strapWords(readPublic(props.publicState), props.game.status === 'finished')
  return <CardStatus {...props} />
}

TvStatus.variants = ['band', 'strap'] as const

/** One line on the round: the titles typed for the song playing, or how many got the latest reveal's photo (its moment, with typed moments on). */
function Detail({ pub, tallies }: { pub: SoundtrackPublicState; tallies: TvStatusProps['tallies'] }) {
  const n = pub.playedAt.length
  if (pub.phase === 'playing' && n > 0) {
    const typed = tallies[promptKey(n, 'title')] ?? 0
    return (
      <>
        <strong>{typed}</strong> of {Math.max(pub.playing, typed)} {typedWords(typed)}
      </>
    )
  }
  if ((pub.phase === 'reveal' || pub.phase === 'standings') && pub.reveal && pub.reveal.scoring > 0) {
    return (
      <>
        <strong>{pub.reveal.counts.event}</strong> of {pub.reveal.scoring} got song {pub.reveal.n}'s {pub.momentTyped ? 'moment' : 'event'}
      </>
    )
  }
  if (pub.phase === 'lastCall') return <>Check every song on your phone</>
  if (pub.phase === 'lobby') return <>Answer on your phone</>
  return null
}

function BandStatus({ game, publicState, tallies }: TvStatusProps<SoundtrackGame>) {
  const pub = readPublic(publicState)
  return (
    <BandLine tab={<Tab tone="paper">{game.title}</Tab>}>
      <BandCount>{strapWords(pub, game.status === 'finished')}</BandCount>
      {pub && (
        <BandText>
          <Detail pub={pub} tallies={tallies} />
        </BandText>
      )}
    </BandLine>
  )
}

function CardStatus({ game, publicState, tallies }: TvStatusProps<SoundtrackGame>) {
  const pub = readPublic(publicState)
  return (
    <section className="grid min-w-0 grid-cols-1 gap-3 rounded-3xl bg-raised p-5 short:gap-2 short:p-4">
      <header className="flex min-w-0 items-center gap-2.5">
        <CassetteTapeIcon weight="duotone" className="size-7 shrink-0 text-paper-2 short:size-6" />
        <h3 className="min-w-0 flex-1 truncate text-xl font-bold short:text-lg">{game.title}</h3>
      </header>
      <p className="truncate text-lg font-semibold">{strapWords(pub, game.status === 'finished')}</p>
      {pub && (
        <p className="text-paper-2 [&_strong]:font-bold [&_strong]:text-paper">
          <Detail pub={pub} tallies={tallies} />
        </p>
      )}
    </section>
  )
}
