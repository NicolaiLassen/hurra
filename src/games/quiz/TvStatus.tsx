import { CrownIcon, QuestionIcon } from '@phosphor-icons/react'
import Avatar from '@/components/Avatar'
import { BandCount, BandLine, BandText, Tab } from '@/components/tv/onAir'
import { formatNumber, joinNames, type QuizGame } from '@/games/quiz/logic'
import { SecondsLeft } from '@/games/quiz/parts'
import { readPublic } from '@/games/quiz/read'
import type { TvStatusProps } from '@/games/types'

type Pub = NonNullable<ReturnType<typeof readPublic>>

/**
 * The quiz on the TV while it runs (docs/identity.md, The TV's frame). In the
 * strap while it holds the stage: where the quiz is ("Question 3 of 10"). In
 * the band while another game holds the stage: where it is, and the answers
 * coming in. As a card: where it is, the answers coming in while a question
 * is open, and who leads. No motion library: CSS only.
 */
export default function TvStatus(props: TvStatusProps<QuizGame>) {
  if (props.variant === 'band') return <BandStatus {...props} />
  if (props.variant === 'strap') return whereNow(readPublic(props.publicState), props.game.status === 'finished')
  return <CardStatus {...props} />
}

TvStatus.variants = ['band', 'strap'] as const

/** Where the quiz is, in a few words. */
function whereNow(pub: Pub | null, finished = false): string {
  if (finished || pub?.phase === 'done') return 'Final result'
  if (pub?.phase === 'lobby') return `${pub.total} questions, starting soon`
  if (pub?.phase === 'question' || pub?.phase === 'reveal') return `Question ${pub.index + 1} of ${pub.total}`
  if (pub?.phase === 'leaderboard') return `After question ${pub.index + 1} of ${pub.total}`
  return 'Getting ready'
}

function BandStatus({ game, players, publicState, tallies }: TvStatusProps<QuizGame>) {
  const pub = readPublic(publicState)
  const answered = pub?.phase === 'question' && pub.question ? (tallies[pub.question.key] ?? 0) : null
  return (
    <BandLine tab={<Tab tone="paper">{game.title}</Tab>}>
      <BandCount>{whereNow(pub)}</BandCount>
      {answered !== null ? (
        <BandText>
          <strong>{answered}</strong> of {players.length} have answered
        </BandText>
      ) : (
        pub?.phase === 'reveal' &&
        pub.reveal && (
          <BandText>
            <strong>{pub.reveal.rightCount}</strong> of {pub.reveal.answered} got it right
          </BandText>
        )
      )}
    </BandLine>
  )
}

function CardStatus({ game, players, publicState, tallies, serverNow }: TvStatusProps<QuizGame>) {
  const pub = readPublic(publicState)
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? 'A guest'
  const leaders = pub?.leaderboard.filter((row) => row.rank === 1 && players.some((p) => p.id === row.playerId)) ?? []
  const where = pub?.phase === 'done' ? 'Over' : whereNow(pub)

  const answered = pub?.question ? (tallies[pub.question.key] ?? 0) : 0
  const share = players.length > 0 ? Math.min(1, answered / players.length) : 0
  const verb = pub?.phase === 'done' ? 'won' : leaders.length > 1 ? 'lead' : 'leads'

  return (
    <section className="grid min-w-0 grid-cols-1 gap-4 rounded-3xl bg-raised p-5 short:gap-3 short:p-4">
      <header className="flex min-w-0 items-center gap-2.5">
        <QuestionIcon weight="duotone" className="size-7 shrink-0 text-paper-2 short:size-6" />
        <h3 className="min-w-0 flex-1 truncate text-xl font-bold short:text-lg">{game.title}</h3>
      </header>
      <p className="flex min-w-0 items-baseline justify-between gap-3 text-lg font-semibold">
        <span className="truncate">{where}</span>
        {pub?.phase === 'question' && pub.question && (
          <SecondsLeft endsAt={pub.question.endsAt} serverNow={serverNow} suffix=" s" className="shrink-0 text-xl" />
        )}
      </p>

      {pub?.phase === 'question' && pub.question ? (
        <div className="grid gap-2">
          <div className="h-2.5 overflow-hidden rounded-full bg-rule">
            <div className="h-full rounded-full bg-paper transition-[width] duration-500" style={{ width: `${share * 100}%` }} />
          </div>
          <p className="text-paper-2 tabular-nums">
            <span className="font-bold text-paper">{answered}</span> of {players.length} answered
          </p>
        </div>
      ) : pub?.phase === 'reveal' && pub.reveal ? (
        <p className="text-paper-2 tabular-nums">
          <span className="font-bold text-paper">{pub.reveal.rightCount}</span> of {pub.reveal.answered} got it right
        </p>
      ) : leaders.length > 0 ? (
        <p className="flex min-w-0 items-center gap-2.5">
          <Avatar name={nameOf(leaders[0].playerId)} className="size-8" />
          <span className="min-w-0 flex-1 truncate text-lg font-semibold">
            {joinNames(leaders.map((row) => nameOf(row.playerId)))} {verb}
          </span>
          {pub?.phase === 'done' && <CrownIcon weight="fill" className="shrink-0 text-gold" />}
          <span className="shrink-0 text-xl font-black text-gold">{formatNumber(leaders[0].points)}</span>
        </p>
      ) : (
        <p className="text-lg text-paper-2">No points yet.</p>
      )}
    </section>
  )
}
