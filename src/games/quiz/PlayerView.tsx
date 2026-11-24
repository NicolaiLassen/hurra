import { CheckIcon } from '@phosphor-icons/react'
import { useRef, useState } from 'react'
import Avatar from '@/components/Avatar'
import { ordinal } from '@/components/phone/text'
import { Button } from '@/components/ui/button'
import { isLocked, NO_PICK, ruleLine, sendPick, shownChoice, type PickState } from '@/games/quiz/answer'
import { useMomentSound, useServerTime } from '@/games/quiz/clock'
import { formatNumber, promptKey, type QuizGame, type QuizPlayerView, type QuizPublicState } from '@/games/quiz/logic'
import { FRESH_MS, letterOf, momentId } from '@/games/quiz/look'
import { LetterBadge } from '@/games/quiz/parts'
import { AnswerTile, KeyChips, TimeLeft, type TileState } from '@/games/quiz/phoneParts'
import { choiceIndex, readPublic, readView } from '@/games/quiz/read'
import { useShowAnswers } from '@/games/quiz/showAnswers'
import type { PlayerViewProps } from '@/games/types'
import type { AnswerPayload, Player, PromptState, SessionGame, SubmitResult } from '@/lib/types'
import { cn } from '@/lib/utils'

// The quiz on a guest's phone (docs/identity.md, The quiz on a phone). The
// phone draws the strap above it ("Question 3 of 10", phoneStrap in index.ts).
// During a question: letters only, since the question is on the TV, unless
// this phone asked to see the answers too; a tap shows at once and then locks
// in. Then how it went, and where you stand. Gold only for the leader.

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
  if (!pub) return <p className="py-8 text-center text-paper-2">Getting the quiz ready…</p>

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
        <div className="grid gap-2">
          <p className="text-phone-head leading-tight font-extrabold">The quiz is over.</p>
          <MyRank view={view} more={false} />
        </div>
      )
  }
}

function Lobby({ total, onStage }: { total: number; onStage: boolean }) {
  return (
    <div className="grid gap-4">
      <KeyChips />
      <div>
        <p className="text-phone-head leading-tight font-extrabold">Quiz time.</p>
        <p className="mt-1 text-lg font-semibold">{onStage ? 'Watch the TV.' : 'The host starts the first question soon.'}</p>
      </div>
      <p className="text-paper-2">
        {total} {total === 1 ? 'question' : 'questions'}. The questions are on the TV and you answer here: a right answer
        scores 500 to 1,000 points, and the faster you are, the more you get.
      </p>
    </div>
  )
}

/**
 * A question: "The question is on the TV.", how answering works, the four
 * letters as big tiles, the seconds left, and "Show the answers here". A tap
 * shows the tile picked at once, then locked in once the database has it;
 * a refusal rolls it back with the reason.
 */
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
  const [pick, setPick] = useState<PickState>(NO_PICK)
  const [showAnswers, setShowAnswers] = useShowAnswers()
  // The quiz opens its prompts with `final`: the first answer counts (submit_answer refuses a second).
  const final = prompt?.spec.kind === 'choice' ? prompt.spec.final === true : true
  const chosen = shownChoice(saved, pick)
  const locked = isLocked(saved, pick)
  const sending = pick.kind === 'sending'
  const now = useServerTime(serverNow, 250, chosen === null || !final)
  const over = now >= question.endsAt || (prompt?.closed_at ?? null) !== null
  const open = !over && !sending && (chosen === null || !final)
  // A second tap before the first one's render can't send twice.
  const inFlight = useRef(false)

  function tap(choice: number) {
    if (!open || inFlight.current) return
    inFlight.current = true
    void sendPick(question.key, choice, submit, setPick).finally(() => {
      inFlight.current = false
    })
  }

  const stateOf = (i: number): TileState => {
    if (i === chosen) return sending ? 'sending' : locked ? 'locked' : 'open'
    if (open) return 'open'
    return 'faded'
  }

  let line: string
  if (chosen !== null && sending) line = `Sending ${letterOf(chosen)}…`
  else if (chosen !== null && final) {
    line = `Locked in: ${letterOf(chosen)}. ${onStage ? 'The answer comes up on the TV.' : 'The answer comes up soon.'}`
  } else if (chosen !== null && !over) line = `You picked ${letterOf(chosen)}. You can change it until the time is up.`
  else if (chosen !== null) line = `Your answer: ${letterOf(chosen)}. The answer comes up soon.`
  else if (over) line = "Time's up. No answer from you this time."
  else if (pick.kind === 'refused') line = `${pick.message} Tap again.`
  else line = ruleLine(final, !showAnswers)

  return (
    <div className="grid gap-6">
      <div className="grid gap-1.5">
        <p className="text-phone-head leading-tight font-extrabold text-balance break-words">
          {showAnswers ? question.text : 'The question is on the TV.'}
        </p>
        {/* Two lines kept for it, so the tiles stay put as it changes. */}
        <p role="status" className="min-h-[2lh] text-[1.0625rem] leading-snug text-paper-2">
          {line}
        </p>
      </div>

      <div role="group" aria-label="Your answer" className={cn('grid gap-3', showAnswers ? 'grid-cols-1' : 'grid-cols-2')}>
        {question.options.map((option, i) => (
          <AnswerTile key={i} index={i} option={showAnswers ? option : null} state={stateOf(i)} onPick={() => tap(i)} />
        ))}
      </div>

      <div className="flex min-h-11 items-center justify-between gap-4">
        <TimeLeft endsAt={question.endsAt} serverNow={serverNow} />
        <Button
          variant="link"
          className="-mr-1 h-11 px-1 text-[1.0625rem] font-bold"
          onClick={() => setShowAnswers(!showAnswers)}
        >
          {showAnswers ? 'Letters only' : 'Show the answers here'}
        </Button>
      </div>
    </div>
  )
}

/** The reveal on your phone: right or not, your points, the answer, and how everyone answered. */
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
  const it = correct >= 0 ? `It was ${letterOf(correct)}${options[correct] ? `: ${options[correct]}` : ''}.` : null

  return (
    <div className="grid gap-6">
      <div className="grid gap-1.5 duration-300 animate-in fade-in-0 motion-reduce:animate-none">
        <p className="text-phone-head leading-tight font-extrabold">
          {right ? 'You got it.' : mine === null ? 'No answer this time.' : 'Not this time.'}
        </p>
        {right && last ? (
          <p className="flex items-baseline gap-2 text-[1.0625rem] font-semibold text-paper-2">
            <span className="text-[1.875rem] leading-none text-paper tv-num">+{formatNumber(last.points)}</span>
            quiz points for {letterOf(mine ?? correct)}
          </p>
        ) : (
          <p className="text-[1.0625rem] leading-snug text-paper-2">
            {mine !== null && `You picked ${letterOf(mine)}. `}
            {it}
          </p>
        )}
      </div>

      {options.length > 0 && (
        <ul className="grid gap-2" aria-label="How everyone answered">
          {options.map((option, i) => {
            const isRight = i === correct
            return (
              <li
                key={i}
                className={cn(
                  'flex min-h-14 items-center gap-3 rounded-phone py-2 pr-4 pl-2',
                  isRight ? 'bg-paper text-ink' : 'bg-overlay',
                )}
              >
                <LetterBadge index={i} className="size-10 rounded-chip text-xl leading-none" />
                <span className="min-w-0 flex-1 leading-snug font-bold break-words">
                  {option}
                  {isRight && <span className="sr-only">, the right answer</span>}
                </span>
                {i === mine && <span className={cn('shrink-0 text-sm font-bold', isRight ? 'text-ink' : 'text-paper-2')}>You</span>}
                {isRight && <CheckIcon weight="bold" aria-hidden className="size-5 shrink-0" />}
                <span className={cn('w-7 shrink-0 text-right text-xl leading-none tv-num', isRight ? 'text-ink' : 'text-paper-2')}>
                  {pub.reveal?.counts[i] ?? ''}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <MyRank view={view} more={pub.index + 1 < pub.total} />
    </div>
  )
}

/** Between questions: where you stand in the quiz, and its top three. */
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
    <div className="grid gap-6">
      <div className="grid gap-1">
        {view?.rank ? (
          <p className="flex items-baseline gap-2.5">
            <span className={cn('text-phone-place leading-none wide', view.rank === 1 && 'text-gold')}>{ordinal(view.rank)}</span>
            <span className="text-[1.875rem] leading-none tv-num">{formatNumber(view.quizPoints)}</span>
            <span className="font-semibold text-paper-2">quiz points</span>
          </p>
        ) : (
          <p className="text-phone-head leading-tight font-extrabold">No quiz points yet</p>
        )}
        <p className="text-paper-2">{view ? `${view.right} of ${asked} right so far` : `${asked} of ${pub.total} questions asked`}</p>
      </div>

      {top.length > 0 && (
        <ol className="grid gap-1" aria-label="The quiz's top three">
          {top.map((row) => {
            const me = row.playerId === player.id
            return (
              <li key={row.playerId} className={cn('flex min-h-12 items-center gap-3 rounded-phone px-2.5 py-1.5', me && 'bg-overlay')}>
                <span className="w-5 text-right text-xl leading-none text-paper-3 tv-num">{row.rank}</span>
                <Avatar name={nameOf(row.playerId)} playerId={row.playerId} className="size-8" />
                <span className={cn('min-w-0 flex-1 truncate', me ? 'font-bold' : 'font-medium')}>
                  {nameOf(row.playerId)}
                  {me && <span className="font-normal text-paper-2"> (you)</span>}
                </span>
                <span className={cn('text-xl leading-none tv-num', row.rank === 1 && 'text-gold')}>{formatNumber(row.points)}</span>
              </li>
            )
          })}
        </ol>
      )}

      <p className="text-paper-2">
        {asked >= pub.total
          ? 'That was the last question. The winner is crowned soon.'
          : onStage
            ? 'The next question is coming up. Watch the TV.'
            : 'The next question is coming up.'}
      </p>
    </div>
  )
}

/** "You're 4th in the quiz, with 2,350". `more`: questions are still to come. Gold only for the leader. */
function MyRank({ view, more }: { view: QuizPlayerView | null; more: boolean }) {
  if (!view) return null
  return (
    <p className="text-lg font-semibold">
      {view.rank ? (
        <>
          You're <span className={cn(view.rank === 1 && 'text-gold')}>{ordinal(view.rank)}</span> in the quiz, with{' '}
          {formatNumber(view.quizPoints)}
        </>
      ) : (
        <span className="text-paper-2">
          {more ? 'No quiz points yet. The next question is your chance.' : 'No quiz points for you this time.'}
        </span>
      )}
    </p>
  )
}
