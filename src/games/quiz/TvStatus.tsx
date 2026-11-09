import { CrownIcon, QuestionIcon } from '@phosphor-icons/react'
import Avatar from '@/components/Avatar'
import { formatNumber, joinNames, type QuizGame } from '@/games/quiz/logic'
import { SecondsLeft } from '@/games/quiz/parts'
import { readPublic } from '@/games/quiz/read'
import type { TvStatusProps } from '@/games/types'

/**
 * The quiz on the TV while another game holds the stage: where the quiz is,
 * the answers coming in while a question is open, and who leads. A whole
 * card, title included. No motion library: CSS only.
 */
export default function TvStatus({ game, players, publicState, tallies, serverNow }: TvStatusProps<QuizGame>) {
  const pub = readPublic(publicState)
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? 'A guest'
  const leaders = pub?.leaderboard.filter((row) => row.rank === 1 && players.some((p) => p.id === row.playerId)) ?? []

  let where = 'Getting ready'
  if (pub?.phase === 'lobby') where = `${pub.total} questions, starting soon`
  else if (pub?.phase === 'question' || pub?.phase === 'reveal') where = `Question ${pub.index + 1} of ${pub.total}`
  else if (pub?.phase === 'leaderboard') where = `After question ${pub.index + 1} of ${pub.total}`
  else if (pub?.phase === 'done') where = 'Over'

  const answered = pub?.question ? (tallies[pub.question.key] ?? 0) : 0
  const share = players.length > 0 ? Math.min(1, answered / players.length) : 0
  const verb = pub?.phase === 'done' ? 'won' : leaders.length > 1 ? 'lead' : 'leads'

  return (
    <section className="grid min-w-0 grid-cols-1 gap-4 rounded-3xl bg-card/80 p-5 ring-1 ring-foreground/10 backdrop-blur short:gap-3 short:p-4">
      <header className="flex min-w-0 items-center gap-2.5">
        <QuestionIcon weight="duotone" className="size-7 shrink-0 text-primary short:size-6" />
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
          <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500"
              style={{ width: `${share * 100}%` }}
            />
          </div>
          <p className="text-muted-foreground tabular-nums">
            <span className="font-bold text-primary">{answered}</span> of {players.length} answered
          </p>
        </div>
      ) : pub?.phase === 'reveal' && pub.reveal ? (
        <p className="text-muted-foreground tabular-nums">
          <span className="font-bold text-primary">{pub.reveal.rightCount}</span> of {pub.reveal.answered} got it right
        </p>
      ) : leaders.length > 0 ? (
        <p className="flex min-w-0 items-center gap-2.5">
          <Avatar name={nameOf(leaders[0].playerId)} className="size-8 text-xs" />
          <span className="min-w-0 flex-1 truncate text-lg font-semibold">
            {joinNames(leaders.map((row) => nameOf(row.playerId)))} {verb}
          </span>
          {pub?.phase === 'done' && <CrownIcon weight="fill" className="shrink-0 text-primary" />}
          <span className="shrink-0 text-xl font-black text-primary tabular-nums">{formatNumber(leaders[0].points)}</span>
        </p>
      ) : (
        <p className="text-lg text-muted-foreground">No points yet.</p>
      )}
    </section>
  )
}
