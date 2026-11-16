import {
  CheckCircleIcon,
  CircleNotchIcon,
  HourglassHighIcon,
  LockSimpleIcon,
  QuestionIcon,
  TrophyIcon,
  XCircleIcon,
} from '@phosphor-icons/react'
import { useState } from 'react'
import Avatar from '@/components/Avatar'
import { useMomentSound, useServerTime } from '@/games/quiz/clock'
import { formatNumber, promptKey, type QuizGame, type QuizPlayerView, type QuizPublicState } from '@/games/quiz/logic'
import { FRESH_MS, letterOf, momentId } from '@/games/quiz/look'
import { DrainBar, LetterBadge, SecondsLeft } from '@/games/quiz/parts'
import { choiceIndex, readPublic, readView } from '@/games/quiz/read'
import type { PlayerViewProps } from '@/games/types'
import type { AnswerPayload, Player, PromptState, SessionGame, SubmitResult } from '@/lib/types'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

/** The quiz on a guest's phone: big options to tap, then how it went and where you stand. */
export default function PlayerView({
  game,
  players,
  player,
  publicState,
  view: rawView,
  prompts,
  myAnswers,
  onStage,
  submit,
  serverNow,
}: PlayerViewProps<QuizGame>) {
  const pub = readPublic(publicState)
  const view = readView(rawView)
  if (!pub) return <p className="py-8 text-center text-muted-foreground">Getting the quiz ready…</p>

  switch (pub.phase) {
    case 'lobby':
      return <Lobby total={pub.total} onStage={onStage} />
    case 'question':
      return pub.question ? (
        <Answering
          key={pub.question.key}
          pub={pub}
          prompt={prompts.find((p) => p.key === pub.question!.key)}
          saved={myAnswers[pub.question.key]}
          onStage={onStage}
          submit={submit}
          serverNow={serverNow}
        />
      ) : null
    case 'reveal':
      return <Revealed game={game} pub={pub} view={view} myAnswers={myAnswers} prompts={prompts} serverNow={serverNow} />
    case 'leaderboard':
      return <Standing pub={pub} view={view} players={players} player={player} onStage={onStage} />
    case 'done':
      return (
        <div className="space-y-4 py-2 text-center">
          <TrophyIcon weight="duotone" className="mx-auto size-14 text-primary" />
          <p className="text-2xl font-black">The quiz is over</p>
          <MyRank view={view} more={false} />
        </div>
      )
  }
}

function Lobby({ total, onStage }: { total: number; onStage: boolean }) {
  return (
    <div className="space-y-4 py-2 text-center">
      <span className="mx-auto grid size-20 rotate-3 place-items-center rounded-3xl bg-primary/15 ring-1 ring-primary/40">
        <QuestionIcon weight="duotone" className="size-11 text-primary" />
      </span>
      <div>
        <p className="text-3xl font-black">Quiz time!</p>
        <p className="mt-1 text-lg font-semibold">{onStage ? 'Watch the TV.' : 'The host starts the first question soon.'}</p>
      </div>
      <p className="text-muted-foreground">
        {total} {total === 1 ? 'question' : 'questions'}. You answer here on your phone: a right answer scores 500 to
        1,000 points, and the faster you are, the more you get.
      </p>
    </div>
  )
}

/** A question: the options as big buttons, locked once your answer is in. */
function Answering({
  pub,
  prompt,
  saved,
  onStage,
  submit,
  serverNow,
}: {
  pub: QuizPublicState
  prompt: PromptState | undefined
  saved: AnswerPayload | undefined
  onStage: boolean
  submit: (key: string, answer: AnswerPayload) => Promise<SubmitResult>
  serverNow: () => number
}) {
  const question = pub.question!
  // Shown from the moment the database took it, until the next read brings it back in myAnswers.
  const [sent, setSent] = useState<number | null>(null)
  const [sending, setSending] = useState<number | null>(null)
  const locked = choiceIndex(saved) ?? sent
  const now = useServerTime(serverNow, 250, locked === null)
  const over = now >= question.endsAt || (prompt?.closed_at ?? null) !== null
  const open = locked === null && sending === null && !over

  async function pick(choice: number) {
    if (!open) return
    setSending(choice)
    try {
      const result = await submit(question.key, { choice: [String(choice)] })
      setSent(choiceIndex(result.answer) ?? choice)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSending(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex min-h-7 items-baseline justify-between gap-3">
        <p className="text-xs font-semibold tracking-widest text-primary uppercase">
          Question {pub.index + 1} of {pub.total}
        </p>
        {/* Once time is up without an answer (none saved or still on its way), the note under the options says so. */}
        {(locked !== null || sending !== null || !over) && (
          <SecondsLeft endsAt={question.endsAt} serverNow={serverNow} suffix=" s" className="text-lg" />
        )}
      </div>
      <p className="text-xl leading-snug font-bold text-balance">{question.text}</p>
      <DrainBar startsAt={prompt?.opened_at ?? null} endsAt={question.endsAt} serverNow={serverNow} className="h-2 rounded-full" />

      <div className="grid gap-2.5" role="group" aria-label="Your answer">
        {question.options.map((option, i) => {
          const chosen = locked === i
          return (
            <button
              key={i}
              type="button"
              disabled={!open}
              aria-pressed={chosen}
              onClick={() => void pick(i)}
              className={cn(
                'flex min-h-16 w-full items-center gap-3 rounded-2xl bg-secondary/70 p-3 pr-4 text-left ring-1 ring-white/10 transition-[transform,opacity,background-color] duration-200',
                open && 'hover:bg-secondary active:scale-[0.98]',
                chosen && 'bg-primary/15 ring-2 ring-primary',
                locked !== null && !chosen && 'opacity-40',
                locked === null && over && 'opacity-50',
                sending === i && 'animate-pulse bg-secondary',
              )}
            >
              <LetterBadge index={i} className="size-11 rounded-xl text-xl" />
              <span className="min-w-0 flex-1 text-lg leading-snug font-semibold break-words">{option}</span>
              {sending === i && <CircleNotchIcon className="size-5 shrink-0 animate-spin text-muted-foreground" />}
              {chosen && <LockSimpleIcon weight="fill" className="size-5 shrink-0 text-primary" />}
            </button>
          )
        })}
      </div>

      {locked !== null ? (
        <div className="space-y-1 text-center">
          <p className="flex items-center justify-center gap-2 text-lg font-bold text-primary">
            <LockSimpleIcon weight="fill" />
            Locked in: {letterOf(locked)}
          </p>
          <p className="text-sm text-muted-foreground">{onStage ? 'The answer comes up on the TV.' : 'The answer comes up soon.'}</p>
        </div>
      ) : over && sending === null ? (
        // An answer still on its way may yet count (the database takes it until closes_at, a second later): "Sending" until it settles.
        <div className="space-y-1 text-center">
          <p className="flex items-center justify-center gap-2 text-lg font-bold text-confetti-pink">
            <HourglassHighIcon weight="fill" />
            Time's up
          </p>
          <p className="text-sm text-muted-foreground">No answer from you this time.</p>
        </div>
      ) : (
        <p className="text-center text-sm text-muted-foreground">
          {sending !== null ? 'Sending your answer…' : 'Tap your answer. The first tap counts.'}
        </p>
      )}
    </div>
  )
}

/** The reveal on your phone: right or not, your points, and the answer. */
function Revealed({
  game,
  pub,
  view,
  myAnswers,
  prompts,
  serverNow,
}: {
  game: SessionGame
  pub: QuizPublicState
  view: QuizPlayerView | null
  myAnswers: Readonly<Record<string, AnswerPayload>>
  prompts: PromptState[]
  serverNow: () => number
}) {
  const key = pub.question?.key ?? promptKey(pub.index)
  const last = view?.last && view.last.index === pub.index ? view.last : null
  const mine = last ? last.choice : choiceIndex(myAnswers[key])
  const correct = last?.correct ?? pub.reveal?.correct ?? -1
  const right = last ? last.points > 0 : mine !== null && mine === correct
  const options = pub.question?.options ?? []
  const [revealedAt] = useState(() => prompts.find((p) => p.key === key)?.revealed_at ?? serverNow())
  // Coin for your right answer, the sad trombone for a wrong one or none: once, at the reveal.
  useMomentSound(serverNow() - revealedAt < FRESH_MS ? momentId(game, key, 'result') : null, right ? 'coin' : 'sad')

  return (
    <div className="space-y-5">
      <p className="text-xs font-semibold tracking-widest text-primary uppercase">
        Question {pub.index + 1} of {pub.total}
      </p>
      {right ? (
        <div className="animate-in space-y-2 rounded-3xl bg-confetti-teal/10 p-5 text-center ring-1 ring-confetti-teal/40 duration-300 zoom-in-95 fade-in-0 motion-reduce:animate-none">
          <CheckCircleIcon weight="duotone" className="mx-auto size-14 text-confetti-teal" />
          <p className="text-4xl font-black">Right!</p>
          {last && (
            <p className="inline-block rounded-full bg-primary px-4 py-1 text-2xl font-black text-primary-foreground">
              +{formatNumber(last.points)}
            </p>
          )}
        </div>
      ) : (
        <div className="animate-in space-y-2 rounded-3xl bg-confetti-pink/10 p-5 text-center ring-1 ring-confetti-pink/30 duration-300 fade-in-0 motion-reduce:animate-none">
          <XCircleIcon weight="duotone" className="mx-auto size-14 text-confetti-pink" />
          <p className="text-3xl font-black">{mine === null ? 'No answer this time.' : 'Not this time.'}</p>
          {correct >= 0 && (
            <p className="text-lg text-muted-foreground">
              It was <span className="font-bold text-foreground">{letterOf(correct)}</span>
              {options[correct] ? `: ${options[correct]}` : ''}.
            </p>
          )}
        </div>
      )}

      {options.length > 0 && (
        <ul className="grid gap-2" aria-label="How everyone answered">
          {options.map((option, i) => (
            <li
              key={i}
              className={cn(
                'flex items-center gap-3 rounded-2xl bg-secondary/50 p-2.5 pr-4 ring-1 ring-white/10',
                i === correct && 'bg-primary/15 ring-2 ring-primary',
                i !== correct && 'opacity-60',
              )}
            >
              <LetterBadge index={i} className="size-8 rounded-lg text-base" />
              <span className="min-w-0 flex-1 truncate font-semibold">{option}</span>
              {i === mine && <span className="shrink-0 text-xs font-semibold text-muted-foreground">You</span>}
              {i === correct && <CheckCircleIcon weight="fill" className="size-5 shrink-0 text-primary" />}
              <span className="w-6 shrink-0 text-right text-sm font-bold text-muted-foreground tabular-nums">
                {pub.reveal?.counts[i] ?? ''}
              </span>
            </li>
          ))}
        </ul>
      )}

      <MyRank view={view} more={pub.index + 1 < pub.total} />
    </div>
  )
}

/** Between questions: where you stand, and the top three. */
function Standing({
  pub,
  view,
  players,
  player,
  onStage,
}: {
  pub: QuizPublicState
  view: QuizPlayerView | null
  players: Player[]
  player: Player
  onStage: boolean
}) {
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? 'A guest'
  const top = pub.leaderboard.filter((row) => players.some((p) => p.id === row.playerId)).slice(0, 3)
  const asked = pub.index + 1

  return (
    <div className="space-y-5">
      <p className="text-xs font-semibold tracking-widest text-primary uppercase">
        Leaderboard after question {asked} of {pub.total}
      </p>
      <div className="space-y-1 text-center">
        {view?.rank ? (
          <>
            <p className="text-6xl font-black text-primary tabular-nums">#{view.rank}</p>
            <p className="text-lg font-semibold">{formatNumber(view.quizPoints)} quiz points</p>
          </>
        ) : (
          <p className="text-2xl font-black">No quiz points yet</p>
        )}
        <p className="text-sm text-muted-foreground">
          {view ? `${view.right} of ${asked} right so far` : `${asked} of ${pub.total} questions asked`}
        </p>
      </div>

      {top.length > 0 && (
        <ol className="grid gap-2">
          {top.map((row) => (
            <li
              key={row.playerId}
              className={cn(
                'flex items-center gap-3 rounded-2xl bg-secondary/50 p-2.5 pr-4 ring-1 ring-white/10',
                row.playerId === player.id && 'ring-2 ring-primary',
              )}
            >
              <span className="w-5 text-right font-black text-muted-foreground tabular-nums">{row.rank}</span>
              <Avatar name={nameOf(row.playerId)} className="size-8" />
              <span className="min-w-0 flex-1 truncate font-semibold">{nameOf(row.playerId)}</span>
              <span className="font-black text-primary">{formatNumber(row.points)}</span>
            </li>
          ))}
        </ol>
      )}

      <p className="text-center text-sm text-muted-foreground">
        {asked >= pub.total
          ? 'That was the last question. The winner is crowned soon!'
          : onStage
            ? 'The next question is coming up. Watch the TV.'
            : 'The next question is coming up.'}
      </p>
    </div>
  )
}

/** "You're #4 with 2,350". `more`: questions are still to come. */
function MyRank({ view, more }: { view: QuizPlayerView | null; more: boolean }) {
  if (!view) return null
  return (
    <p className="text-center text-lg font-semibold">
      {view.rank ? (
        <>
          You're <span className="text-primary">#{view.rank}</span> with {formatNumber(view.quizPoints)}
        </>
      ) : (
        <span className="text-muted-foreground">
          {more ? 'No quiz points yet. The next question is your chance.' : 'No quiz points for you this time.'}
        </span>
      )}
    </p>
  )
}
