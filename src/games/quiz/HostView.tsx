import {
  ArrowRightIcon,
  CheckCircleIcon,
  CrownIcon,
  EyeIcon,
  EyeSlashIcon,
  ListNumbersIcon,
  PlayIcon,
  type Icon,
} from '@phosphor-icons/react'
import { useState } from 'react'
import Avatar from '@/components/Avatar'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useServerTime } from '@/games/quiz/clock'
import {
  formatNumber,
  joinNames,
  promptKey,
  REVEAL_HOLD_MS,
  type QuizGame,
  type QuizHostAction,
  type QuizPublicState,
  type QuizQuestion,
} from '@/games/quiz/logic'
import { letterOf } from '@/games/quiz/look'
import { AnsweredDots, LetterBadge, SecondsLeft } from '@/games/quiz/parts'
import { readPublic } from '@/games/quiz/read'
import type { HostViewProps } from '@/games/types'
import type { PromptState } from '@/lib/types'
import { cn } from '@/lib/utils'

type Step = { label: string; icon: Icon; action: QuizHostAction; close?: string[] }

/**
 * The quiz in the host control room: the question on the TV, the answers
 * coming in, and one big button for the next step. Each step names the
 * question it was made for, so a double tap or a race with the timer does
 * nothing. The answers hide behind Show answers, since this phone is out in
 * the room.
 */
export default function HostView({ players, publicState, state, config, tallies, prompts, serverNow, act }: HostViewProps<QuizGame>) {
  const [showAnswers, setShowAnswers] = useState(false)
  const [pending, setPending] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const pub = readPublic(publicState)
  if (!pub) return <p className="text-muted-foreground">Getting the quiz ready…</p>

  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? 'A guest'
  const questions = Array.isArray(config?.questions) ? config.questions : null
  const index = pub.index
  const key = pub.question?.key ?? promptKey(Math.max(index, 0))
  const last = index + 1 >= pub.total
  const leaders = pub.leaderboard.filter((row) => row.rank === 1)

  async function send(action: QuizHostAction, close?: string[]) {
    setPending(true)
    try {
      await act(action, close ? { close } : undefined)
    } catch {
      // The host page shows a refusal as a toast in the server's words.
    } finally {
      setPending(false)
    }
  }

  const { main, extra } = stepsFor(pub, key, last)
  // Crowning before the last question ends the quiz early: ask first.
  const crownEarly = pub.phase === 'leaderboard' && !last

  return (
    // grid-cols-1: one column as wide as the panel, so long texts wrap instead of widening it.
    <div className="grid grid-cols-1 gap-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Badge size="lg" variant={pub.phase === 'question' ? 'default' : 'secondary'}>
          {PHASE_LABEL[pub.phase]}
        </Badge>
        <p className="text-lg font-semibold">
          {pub.phase === 'lobby' ? `${pub.total} questions` : pub.phase === 'done' ? 'The quiz is over' : `Question ${index + 1} of ${pub.total}`}
        </p>
        {pub.phase === 'question' && pub.question && (
          <SecondsLeft endsAt={pub.question.endsAt} serverNow={serverNow} suffix=" s left" className="text-lg" />
        )}
        <Button variant="ghost" className="ml-auto" onClick={() => setShowAnswers((shown) => !shown)}>
          {showAnswers ? <EyeSlashIcon /> : <EyeIcon />}
          {showAnswers ? 'Hide answers' : 'Show answers'}
        </Button>
      </div>

      {pub.question && <Question pub={pub} questions={questions} showAnswers={showAnswers} />}

      {pub.phase === 'question' && (
        <div className="grid gap-1.5">
          <AnsweredDots count={tallies[key] ?? 0} total={players.length} screen="host" className="text-sm" />
          <p className="text-sm text-muted-foreground">It reveals by itself when time's up. Tap Reveal now once everyone has answered.</p>
        </div>
      )}
      {pub.phase === 'reveal' && pub.reveal && (
        <p className="text-sm text-muted-foreground">
          <span className="font-bold text-foreground">{pub.reveal.rightCount}</span> of {pub.reveal.answered} got it right.{' '}
          <LeaderboardSoon revealedAt={state?.revealedAt ?? revealedAtOf(prompts, key)} serverNow={serverNow} />
        </p>
      )}
      {pub.phase === 'lobby' && (
        <p className="text-sm text-muted-foreground">Start when the room is looking at the TV. Guests answer on their phones.</p>
      )}

      {(main || extra) && (
        <div className="grid gap-2 sm:flex">
          {main && (
            <Button size="xl" className="w-full sm:flex-1" isPending={pending} onClick={() => void send(main.action, main.close)}>
              <main.icon />
              {main.label}
            </Button>
          )}
          {extra && (
            <Button size="xl" variant="secondary" className="w-full sm:w-auto" isPending={pending} onClick={() => void send(extra.action)}>
              <extra.icon />
              {extra.label}
            </Button>
          )}
          {crownEarly && (
            <Button size="xl" variant="secondary" className="w-full sm:w-auto" isPending={pending} onClick={() => setConfirming(true)}>
              <CrownIcon />
              Crown the winner now
            </Button>
          )}
        </div>
      )}

      {pub.leaderboard.length > 0 && <TopFive pub={pub} nameOf={nameOf} />}

      {showAnswers && <AllQuestions questions={questions} pub={pub} />}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Crown the winner now?</AlertDialogTitle>
            <AlertDialogDescription>
              The quiz ends after question {index + 1} of {pub.total}.{' '}
              {leaders.length > 0
                ? `${joinNames(leaders.map((row) => nameOf(row.playerId)))} ${leaders.length > 1 ? 'share the win' : 'wins'} with ${formatNumber(leaders[0].points)} quiz points.`
                : 'Nobody has scored yet, so nobody is crowned.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep going</AlertDialogCancel>
            <AlertDialogAction onClick={() => void send({ type: 'finish' })}>
              <CrownIcon />
              Crown the winner
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** The big button for the next step, and a second one where skipping ahead makes sense. Each names its step. */
function stepsFor(pub: QuizPublicState, key: string, last: boolean): { main: Step | null; extra: Step | null } {
  const { index } = pub
  const crown: Step = { label: 'Crown the winner', icon: CrownIcon, action: { type: 'finish' } }
  const next: Step = { label: 'Next question', icon: ArrowRightIcon, action: { type: 'next', from: index } }
  switch (pub.phase) {
    case 'lobby':
      return { main: { label: 'Start the first question', icon: PlayIcon, action: { type: 'next', from: index } }, extra: null }
    case 'question':
      return { main: { label: 'Reveal now', icon: EyeIcon, action: { type: 'reveal', index }, close: [key] }, extra: null }
    case 'reveal':
      return { main: { label: 'Show the leaderboard', icon: ListNumbersIcon, action: { type: 'leaderboard', index } }, extra: last ? crown : next }
    case 'leaderboard':
      return { main: last ? crown : next, extra: null }
    case 'done':
      return { main: null, extra: null }
  }
}

const PHASE_LABEL: Record<QuizPublicState['phase'], string> = {
  lobby: 'Ready',
  question: 'Answering',
  reveal: 'Answer shown',
  leaderboard: 'Leaderboard',
  done: 'Over',
}

/** The question on the TV, with its answer marked once revealed, or before that with Show answers. */
function Question({ pub, questions, showAnswers }: { pub: QuizPublicState; questions: QuizQuestion[] | null; showAnswers: boolean }) {
  const question = pub.question!
  const revealed = pub.reveal !== null
  const right = revealed ? pub.reveal!.correct : showAnswers ? (questions?.[pub.index]?.correct ?? -1) : -1
  return (
    <section className="rounded-2xl bg-muted/40 p-4">
      <p className="text-lg leading-snug font-semibold">{question.text}</p>
      <ol className="mt-3 grid gap-1.5">
        {question.options.map((option, i) => (
          <li
            key={i}
            className={cn('flex items-center gap-2.5 rounded-xl px-2 py-1.5', i === right && 'bg-primary/15 ring-1 ring-primary/60')}
          >
            <LetterBadge index={i} className="size-7 rounded-lg text-sm" />
            <span className="min-w-0 flex-1 break-words">{option}</span>
            {i === right && <CheckCircleIcon weight="fill" className="size-5 shrink-0 text-primary" aria-label="The right answer" />}
            {revealed && (
              <span className="w-8 shrink-0 text-right text-sm font-bold text-muted-foreground tabular-nums">{pub.reveal!.counts[i] ?? 0}</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

/** "The leaderboard follows by itself in 5 s." */
function LeaderboardSoon({ revealedAt, serverNow }: { revealedAt: number | null; serverNow: () => number }) {
  const now = useServerTime(serverNow, 500, revealedAt !== null)
  if (revealedAt === null) return null
  const left = Math.ceil((revealedAt + REVEAL_HOLD_MS - now) / 1000)
  return <>{left > 0 ? `The leaderboard follows by itself in ${left} s.` : 'The leaderboard is coming up.'}</>
}

function TopFive({ pub, nameOf }: { pub: QuizPublicState; nameOf: (id: string) => string }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">Quiz leaderboard</h3>
      <ol className="divide-y">
        {pub.leaderboard.slice(0, 5).map((row) => (
          <li key={row.playerId} className="flex items-center gap-3 py-1.5">
            <span className="w-5 text-right text-sm font-bold text-muted-foreground tabular-nums">{row.rank}</span>
            <Avatar name={nameOf(row.playerId)} className="size-7" />
            <span className="min-w-0 flex-1 truncate font-medium">{nameOf(row.playerId)}</span>
            {row.gained > 0 && <span className="text-sm font-semibold text-confetti-teal">+{formatNumber(row.gained)}</span>}
            <span className="font-bold text-primary">{formatNumber(row.points)}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** Every question with its answer: asked, on now, or still to come. */
function AllQuestions({ questions, pub }: { questions: QuizQuestion[] | null; pub: QuizPublicState }) {
  if (!questions) return <p className="text-sm text-muted-foreground">The answers aren't on this screen.</p>
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">All questions</h3>
      <ol className="divide-y">
        {questions.map((q, i) => {
          const now = i === pub.index && pub.phase !== 'done' && pub.phase !== 'lobby'
          const asked = i < pub.index || (i === pub.index && pub.phase === 'done')
          return (
            <li key={i} className={cn('flex gap-3 py-2', asked && 'opacity-60')}>
              <span className="w-6 shrink-0 text-right text-sm font-bold text-muted-foreground tabular-nums">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="leading-snug font-medium">{q.text}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                  <CheckCircleIcon weight="fill" className="shrink-0 text-primary" />
                  <span className="min-w-0 break-words">
                    {letterOf(q.correct)}: {q.options[q.correct] ?? ''}
                  </span>
                </p>
              </div>
              {now && <Badge className="shrink-0">Now</Badge>}
              {asked && <Badge variant="secondary" className="shrink-0">Asked</Badge>}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function revealedAtOf(prompts: PromptState[], key: string): number | null {
  return prompts.find((p) => p.key === key)?.revealed_at ?? null
}
