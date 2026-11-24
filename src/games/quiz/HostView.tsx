import {
  ArrowRightIcon,
  CheckCircleIcon,
  CrownIcon,
  DotsThreeIcon,
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
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
import { LetterBadge } from '@/games/quiz/parts'
import { readPublic } from '@/games/quiz/read'
import type { HostViewProps } from '@/games/types'
import type { PromptState } from '@/lib/types'
import { cn } from '@/lib/utils'

type Step = { label: string; icon: Icon; action: QuizHostAction; close?: string[] }

/**
 * The quiz in the host control room: the question on the TV, the answers
 * coming in, and one gold button for the next step (docs/identity.md), with
 * the steps that skip ahead in the menu beside it, so nothing sits next to
 * Reveal now. Each step names the question it was made for, so a double tap
 * or a race with the timer does nothing. The answers hide behind Show
 * answers, since this phone is out in the room.
 */
export default function HostView({ players, publicState, state, config, tallies, prompts, serverNow, act }: HostViewProps<QuizGame>) {
  const [showAnswers, setShowAnswers] = useState(false)
  const [pending, setPending] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const pub = readPublic(publicState)
  if (!pub) return <p className="text-paper-2">Getting the quiz ready…</p>

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
        {/* The phase as a word on the overlay: gold is the next step's. */}
        <Badge size="lg" variant="secondary">
          {PHASE_LABEL[pub.phase]}
        </Badge>
        <p className="text-lg font-extrabold">
          {pub.phase === 'lobby' ? `${pub.total} questions` : pub.phase === 'done' ? 'The quiz is over' : `Question ${index + 1} of ${pub.total}`}
        </p>
        {pub.phase === 'question' && pub.question && <SecondsLeft endsAt={pub.question.endsAt} serverNow={serverNow} />}
        <Button variant="ghost" className="ml-auto" onClick={() => setShowAnswers((shown) => !shown)}>
          {showAnswers ? <EyeSlashIcon /> : <EyeIcon />}
          {showAnswers ? 'Hide answers' : 'Show answers'}
        </Button>
      </div>

      {pub.question && <Question pub={pub} questions={questions} showAnswers={showAnswers} />}

      {pub.phase === 'question' && (
        <div className="grid gap-1.5">
          <AnsweredPips count={tallies[key] ?? 0} total={players.length} />
          <p className="text-sm text-paper-2">It reveals by itself when time's up. Tap Reveal now once everyone has answered.</p>
        </div>
      )}
      {pub.phase === 'reveal' && pub.reveal && (
        <p className="text-sm text-paper-2">
          <span className="font-bold text-paper">{pub.reveal.rightCount}</span> of {pub.reveal.answered} got it right.{' '}
          <LeaderboardSoon revealedAt={state?.revealedAt ?? revealedAtOf(prompts, key)} serverNow={serverNow} />
        </p>
      )}
      {pub.phase === 'lobby' && (
        <p className="text-sm text-paper-2">Start when the room is looking at the TV. Guests answer on their phones.</p>
      )}

      {(main || extra || crownEarly) && (
        <div className="flex items-center gap-2">
          {main && (
            <Button size="lg" className="h-12 flex-1 text-base sm:h-11 sm:flex-none sm:px-6" isPending={pending} onClick={() => void send(main.action, main.close)}>
              <main.icon />
              {main.label}
            </Button>
          )}
          {(extra || crownEarly) && (
            // Not modal, so the crowning dialog it opens doesn't fight it for focus.
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon-lg" className="size-12 sm:size-11" disabled={pending} aria-label="More quiz steps">
                  <DotsThreeIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-auto min-w-56">
                {extra && (
                  <DropdownMenuItem onSelect={() => void send(extra.action)}>
                    <extra.icon />
                    {extra.label}
                  </DropdownMenuItem>
                )}
                {crownEarly && (
                  <DropdownMenuItem onSelect={() => setConfirming(true)}>
                    <CrownIcon />
                    Crown the winner now…
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
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

/** The gold button for the next step, and in the menu beside it the step that skips ahead, where that makes sense. Each names its step. */
function stepsFor(pub: QuizPublicState, key: string, last: boolean): { main: Step | null; extra: Step | null } {
  const { index } = pub
  const crown: Step = { label: 'Crown the winner', icon: CrownIcon, action: { type: 'finish' } }
  const next: Step = { label: 'Next question', icon: ArrowRightIcon, action: { type: 'next', from: index } }
  // In the menu while the answer shows: they skip the leaderboard.
  const skipToNext: Step = { label: 'Skip the leaderboard: next question', icon: ArrowRightIcon, action: { type: 'next', from: index } }
  const skipToCrown: Step = { label: 'Skip the leaderboard: crown the winner', icon: CrownIcon, action: { type: 'finish' } }
  switch (pub.phase) {
    case 'lobby':
      return { main: { label: 'Start the first question', icon: PlayIcon, action: { type: 'next', from: index } }, extra: null }
    case 'question':
      return { main: { label: 'Reveal now', icon: EyeIcon, action: { type: 'reveal', index }, close: [key] }, extra: null }
    case 'reveal':
      return { main: { label: 'Show the leaderboard', icon: ListNumbersIcon, action: { type: 'leaderboard', index } }, extra: last ? skipToCrown : skipToNext }
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

/**
 * The question on the TV, in a well, with its answer marked once revealed, or
 * before that with Show answers: a step lighter and the word Right, never a
 * colour alone (docs/identity.md).
 */
function Question({ pub, questions, showAnswers }: { pub: QuizPublicState; questions: QuizQuestion[] | null; showAnswers: boolean }) {
  const question = pub.question!
  const revealed = pub.reveal !== null
  const right = revealed ? pub.reveal!.correct : showAnswers ? (questions?.[pub.index]?.correct ?? -1) : -1
  return (
    <section className="rounded-lg bg-overlay p-4">
      <p className="text-lg leading-snug font-extrabold">{question.text}</p>
      <ol className="mt-3 grid gap-1.5">
        {question.options.map((option, i) => (
          <li key={i} className={cn('flex items-center gap-2.5 rounded-control px-2 py-1.5', i === right && 'bg-rule')}>
            <LetterBadge index={i} className="size-7 rounded-chip text-sm" />
            <span className="min-w-0 flex-1 font-bold break-words">{option}</span>
            {i === right && (
              <span className="flex shrink-0 items-center gap-1 text-sm font-bold text-paper">
                <CheckCircleIcon weight="fill" className="size-5" aria-hidden />
                Right
              </span>
            )}
            {revealed && <span className="tv-num w-8 shrink-0 text-right text-lg text-paper-2">{pub.reveal!.counts[i] ?? 0}</span>}
          </li>
        ))}
      </ol>
    </section>
  )
}

/** The time left on the question, its number in condensed numerals: "9 s left", then "Time's up". Paper, never gold or pink. */
function SecondsLeft({ endsAt, serverNow }: { endsAt: number; serverNow: () => number }) {
  const now = useServerTime(serverNow, 250)
  const left = endsAt - now
  if (left <= 0) return <span className="text-lg font-bold text-paper-2">Time's up</span>
  return (
    <span className="text-lg font-bold text-paper">
      <span className="tv-num text-xl">{Math.ceil(left / 1000)}</span> s left
    </span>
  )
}

/**
 * How many have answered: a square pip per guest, filled in paper as answers
 * come in, with "6 of 12 have answered". Counts only, never names or faces, so
 * nobody can tell who hasn't answered.
 */
function AnsweredPips({ count, total }: { count: number; total: number }) {
  const pips = Math.max(total, count)
  return (
    <div className="flex items-center gap-3" role="img" aria-label={`${count} of ${pips} have answered`}>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1">
        {Array.from({ length: pips }, (_, i) => (
          <span
            key={i}
            className={cn('size-2.5 rounded-[2px] transition-colors duration-500', i < count ? 'bg-paper' : 'border-[1.5px] border-rule')}
          />
        ))}
      </div>
      <p className="shrink-0 text-sm whitespace-nowrap text-paper-2">
        <span className="tv-num text-lg text-paper">
          {count} of {pips}
        </span>{' '}
        have answered
      </p>
    </div>
  )
}

/** "The leaderboard follows by itself in 5 s." */
function LeaderboardSoon({ revealedAt, serverNow }: { revealedAt: number | null; serverNow: () => number }) {
  const now = useServerTime(serverNow, 500, revealedAt !== null)
  if (revealedAt === null) return null
  const left = Math.ceil((revealedAt + REVEAL_HOLD_MS - now) / 1000)
  return <>{left > 0 ? `The leaderboard follows by itself in ${left} s.` : 'The leaderboard is coming up.'}</>
}

/**
 * The quiz's top five. Gains and totals in condensed Archivo numerals, whose
 * tabular figures keep the comma narrow (docs/identity.md, Type), so the
 * columns hold still as the numbers change.
 */
function TopFive({ pub, nameOf }: { pub: QuizPublicState; nameOf: (id: string) => string }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-extrabold">Quiz leaderboard</h3>
      <ol className="divide-y divide-rule">
        {pub.leaderboard.slice(0, 5).map((row) => (
          <li key={row.playerId} className="flex items-center gap-3 py-1.5">
            <span className="tv-num w-5 text-right text-base text-paper-3">{row.rank}</span>
            <Avatar name={nameOf(row.playerId)} playerId={row.playerId} className="size-7" />
            <span className="min-w-0 flex-1 truncate font-bold">{nameOf(row.playerId)}</span>
            {row.gained > 0 && <span className="tv-num text-base text-paper-2">+{formatNumber(row.gained)}</span>}
            <span className="tv-num min-w-14 text-right text-lg text-paper">{formatNumber(row.points)}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** Every question with its answer: asked, on now, or still to come. */
function AllQuestions({ questions, pub }: { questions: QuizQuestion[] | null; pub: QuizPublicState }) {
  if (!questions) return <p className="text-sm text-paper-2">The answers aren't on this screen.</p>
  return (
    <section>
      <h3 className="mb-2 text-sm font-extrabold">All questions</h3>
      <ol className="divide-y divide-rule">
        {questions.map((q, i) => {
          const now = i === pub.index && pub.phase !== 'done' && pub.phase !== 'lobby'
          const asked = i < pub.index || (i === pub.index && pub.phase === 'done')
          return (
            <li key={i} className={cn('flex gap-3 py-2', asked && 'text-paper-2')}>
              <span className="tv-num w-6 shrink-0 text-right text-base text-paper-3">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="leading-snug font-medium">{q.text}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-sm text-paper-2">
                  <CheckCircleIcon weight="fill" className="shrink-0" />
                  <span className="min-w-0 break-words">
                    {letterOf(q.correct)}: {q.options[q.correct] ?? ''}
                  </span>
                </p>
              </div>
              {now && (
                <Badge variant="secondary" className="shrink-0">
                  Now
                </Badge>
              )}
              {asked && (
                <Badge variant="ghost" className="shrink-0">
                  Asked
                </Badge>
              )}
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
