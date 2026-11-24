import { CheckIcon } from '@phosphor-icons/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import Avatar from '@/components/Avatar'
import { SOUNDS } from '@/games/core/sounds'
import { useMomentSound, useMomentSoundAt, useServerTime } from '@/games/quiz/clock'
import { formatNumber, formatSeconds, type QuizGame, type QuizPublicState } from '@/games/quiz/logic'
import { FRESH_MS, LETTERS, momentId, OPTION_STEPS, QUESTION_STEPS, URGENT_MS } from '@/games/quiz/look'
import { AnsweredDots, LetterBadge } from '@/games/quiz/parts'
import QuizPodium from '@/games/quiz/Podium'
import { readPublic } from '@/games/quiz/read'
import type { TvViewProps } from '@/games/types'
import type { Player, PromptState, SessionGame } from '@/lib/types'
import { cn } from '@/lib/utils'

/** The house easing (docs/identity.md, Motion). */
const EASE_OUT = [0.22, 1, 0.36, 1] as const

/**
 * The quiz on the TV stage (docs/identity.md, The quiz on the TV): the lobby,
 * each question with its countdown and the answers coming in, the reveal, and
 * the leaderboard after each question. The strap above says where the quiz is
 * ("Question 3 of 10"), so the stage doesn't repeat it. It draws the moments
 * itself, so its announcements only sound on the stage.
 */
export default function TvView({ game, players, publicState, prompts, tallies, serverNow, finished }: TvViewProps<QuizGame>) {
  const pub = readPublic(publicState)
  if (!pub) return <Waiting>Getting the quiz ready…</Waiting>
  if (finished || pub.phase === 'done') return <QuizPodium game={game} players={players} pub={pub} />

  const prompt = pub.question ? prompts.find((p) => p.key === pub.question!.key) : undefined
  switch (pub.phase) {
    case 'lobby':
      return <Lobby total={pub.total} />
    case 'question':
      return pub.question ? (
        <Asking game={game} pub={pub} prompt={prompt} answered={tallies[pub.question.key] ?? 0} guests={players.length} serverNow={serverNow} />
      ) : null
    case 'reveal':
      return pub.question && pub.reveal ? <Revealed pub={pub} players={players} /> : <Waiting>The answer is coming up…</Waiting>
    case 'leaderboard':
      return <Leaderboard key={pub.index} pub={pub} players={players} />
  }
}

function Waiting({ children }: { children: ReactNode }) {
  return <p className="m-auto text-tv-name text-paper-2 short:text-tv-band low:text-tv-field">{children}</p>
}

/** Before the first question: what the quiz is and how it scores, with the four letters guests will see. */
function Lobby({ total }: { total: number }) {
  return (
    <div className="my-auto flex max-w-[90rem] flex-col items-start gap-10 short:gap-7 low:gap-5">
      {/* Inset a little, so the tilted chips' corners stay inside the safe area. */}
      <div className="flex gap-6 px-1.5 short:gap-5" aria-hidden>
        {LETTERS.map((letter, i) => (
          <LetterBadge key={letter} index={i} className="size-28 text-tv-question short:size-22 short:text-tv-answer low:size-16 low:text-tv-band" />
        ))}
      </div>
      <h2 className="wide text-tv-code text-paper short:text-tv-question low:text-tv-answer">Quiz time</h2>
      <p className="text-tv-name font-semibold text-paper short:text-tv-band low:text-tv-field">
        {total} {total === 1 ? 'question' : 'questions'}. Answer on your phone.
      </p>
      <p className="max-w-[72rem] text-tv-body text-balance text-paper-2 short:text-tv-tab low:text-tv-floor">
        A right answer scores 500 to 1,000 points. The faster you are, the more you get.
      </p>
    </div>
  )
}

/** The tick-tock's length: it starts this long before time runs out, so its bell lands on zero. */
const TICKTOCK_MS = SOUNDS.ticktock.seconds * 1000

/**
 * A question on the screen: the question with the countdown beside it, the
 * answers in a 2 by 2 grid (A and B on top, C and D below, always in their
 * places), and the pips filling in as guests answer.
 */
function Asking({
  game,
  pub,
  prompt,
  answered,
  guests,
  serverNow,
}: {
  game: SessionGame
  pub: QuizPublicState
  prompt: PromptState | undefined
  answered: number
  guests: number
  serverNow: () => number
}) {
  const question = pub.question!
  const now = useServerTime(serverNow, 250)
  const openedAt = prompt?.opened_at ?? null
  // A whoosh when the question appears, and the tick-tock over the countdown's last moments: its bell lands as
  // time runs out. An early Reveal now unmounts this view first, which cancels it.
  useMomentSound(openedAt === null || now - openedAt < FRESH_MS ? momentId(game, question.key, 'asked') : null, 'whoosh')
  useMomentSoundAt(momentId(game, question.key, 'answer'), 'ticktock', question.endsAt - TICKTOCK_MS, serverNow)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start gap-12 short:gap-8">
        <Question key={question.key} text={question.text} />
        <Countdown left={question.endsAt - now} />
      </div>
      <Options key={question.key} options={question.options} />
      <AnsweredDots count={answered} total={guests} screen="tv" className="mt-10 shrink-0 short:mt-6 low:mt-4" />
    </div>
  )
}

/**
 * The time left as one big figure in the condensed numerals, with "seconds
 * left" under it. Paper, and gold only for its last seconds, while the
 * tick-tock plays (the tick-tock's timing is Asking's, unchanged). Two figures
 * wide, so the question beside it never moves.
 */
function Countdown({ left }: { left: number }) {
  const seconds = Math.max(0, Math.ceil(left / 1000))
  const over = seconds === 0
  return (
    <div role="timer" aria-label={over ? "Time's up" : `${seconds} seconds left`} className="flex shrink-0 flex-col items-end">
      <span
        aria-hidden
        className={cn(
          'min-w-[2ch] text-right tv-num text-tv-count transition-colors duration-300 short:text-tv-lead low:text-tv-cheer',
          over ? 'text-paper-3' : left <= URGENT_MS ? 'text-gold' : 'text-paper',
        )}
      >
        {seconds}
      </span>
      <span aria-hidden className="mt-1 text-tv-body font-semibold whitespace-nowrap text-paper-2 short:text-tv-tab low:text-tv-floor">
        {over ? "Time's up" : seconds === 1 ? 'second left' : 'seconds left'}
      </span>
    </div>
  )
}

/**
 * Steps a size down, from `first` to `last`, while `tooBig` (a stable
 * function) says the element doesn't fit. Measured after layout and before
 * paint, so the bigger size is never seen, and again whenever the element's
 * room changes (a line joins the band below the stage). It only steps down;
 * key the component on its content, so new content starts again from its own
 * first guess.
 */
function useStepDown<T extends HTMLElement>(first: number, last: number, tooBig: (el: T) => boolean) {
  const ref = useRef<T>(null)
  const [step, setStep] = useState(first)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && step < last && tooBig(el)) setStep(step + 1)
  }, [step, last, tooBig])
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (tooBig(el)) setStep((s) => Math.min(last, s + 1))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [last, tooBig])
  return [ref, step] as const
}

/** More than two lines: its height past two line heights. */
const overTwoLines = (el: HTMLElement) => el.getBoundingClientRect().height > 2 * parseFloat(getComputedStyle(el).lineHeight) + 2

/**
 * The question in the reading face: 86 px at 1080p, two lines at most. It
 * steps down while it takes a third line, so a long one gets the largest size
 * that keeps it to two. Key it on the question.
 */
function Question({ text }: { text: string }) {
  const [ref, step] = useStepDown<HTMLHeadingElement>(0, QUESTION_STEPS.length - 1, overTwoLines)
  return (
    <h2
      ref={ref}
      data-quiz-lines="question"
      className={cn('min-w-0 flex-1 font-extrabold tracking-[-0.01em] text-balance break-words text-paper', QUESTION_STEPS[step], 'leading-[1.08]')}
    >
      {text}
    </h2>
  )
}

/** Any tile whose answer runs past its edges, or holds a word too long for its line. */
const anyTileOverflows = (grid: HTMLElement) =>
  Array.from(grid.querySelectorAll<HTMLElement>('[data-quiz-fit]')).some((tile) => {
    const text = tile.querySelector<HTMLElement>('[data-quiz-text]')
    return tile.scrollHeight > tile.clientHeight + 1 || (text !== null && text.scrollWidth > text.clientWidth + 1)
  })

/**
 * The answers in a 2 by 2 grid of dark tiles, each with its tilted letter chip
 * in the quiz key: A and B on top, C and D below, the same places as on every
 * phone (true or false is one row). The grid takes the room the question
 * leaves, up to the mockup's tile size; all the answers share one size, the
 * largest at which each fits its tile without breaking a word. At the reveal
 * (`reveal`), the right one comes forward on paper with a check and how many
 * picked it, and the others step back to the darker raised surface with their
 * counts. Key it on the question.
 */
function Options({ options, reveal }: { options: readonly string[]; reveal?: { correct: number; counts: readonly number[] } }) {
  const reduce = useReducedMotion()
  const [ref, step] = useStepDown<HTMLOListElement>(0, OPTION_STEPS.length - 1, anyTileOverflows)
  return (
    <ol
      ref={ref}
      className={cn(
        'mt-10 grid min-h-0 flex-1 grid-cols-2 gap-7 short:mt-6 short:gap-5 low:mt-4 low:gap-3',
        options.length > 2
          ? 'max-h-[26rem] grid-rows-2 short:max-h-[21rem]'
          : 'max-h-[calc((26rem-1.75rem)/2)] grid-rows-1 short:max-h-[calc((21rem-1.25rem)/2)]',
      )}
    >
      {options.map((option, i) => {
        const right = reveal !== undefined && i === reveal.correct
        const back = reveal !== undefined && !right
        const count = reveal?.counts[i] ?? 0
        return (
          <motion.li
            key={i}
            initial={reduce || reveal ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: EASE_OUT, delay: 0.1 + i * 0.06 }}
            data-quiz-fit={`option-${LETTERS[i] ?? i}`}
            className={cn(
              'flex min-h-0 min-w-0 items-center gap-10 overflow-hidden rounded-tile py-3 pr-8 pl-7 short:gap-7 short:pr-6 short:pl-5 low:gap-5 low:py-2 low:pl-4',
              right ? 'bg-paper text-ink' : back ? 'bg-raised text-paper-3' : 'bg-overlay text-paper',
            )}
          >
            <LetterBadge
              index={i}
              className={cn(
                'size-32 text-tv-code short:size-24 short:text-tv-answer low:size-16 low:text-tv-band',
                back && 'bg-rule text-paper-3',
              )}
            />
            {/* Words break only between words; a word too long for its line steps the size down instead (the last size may break it). */}
            <span
              data-quiz-text
              className={cn('min-w-0 flex-1 font-bold', step === OPTION_STEPS.length - 1 && 'break-words', OPTION_STEPS[step], 'leading-[1.1]')}
            >
              {option}
            </span>
            {reveal && (
              <motion.span
                initial={reduce ? { opacity: 0 } : { opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, ease: EASE_OUT, delay: reduce ? 0 : 0.25 + i * 0.08 }}
                className="flex shrink-0 flex-col items-end whitespace-nowrap"
              >
                <Picked count={count} right={right} />
              </motion.span>
            )}
          </motion.li>
        )
      })}
    </ol>
  )
}

/** How many picked an answer, stacked to stay narrow: the figure (with a check on the right one) over "picked it", or "Nobody". */
function Picked({ count, right }: { count: number; right: boolean }) {
  const words = 'text-tv-body font-semibold short:text-tv-tab low:text-tv-floor'
  return (
    <>
      <span className="flex items-center gap-2.5 low:gap-1.5">
        {right && <CheckIcon weight="bold" className="size-11 short:size-9 low:size-7" />}
        {count > 0 ? <span className="tv-num text-tv-score short:text-tv-name low:text-tv-field">{count}</span> : <span className={words}>Nobody</span>}
      </span>
      {count > 0 && <span className={cn(words, 'leading-[1.1]')}>picked it</span>}
    </>
  )
}

/**
 * The answer: the question stays, the right answer comes forward in its tile
 * and the others step back, then how many got it right and the fastest right
 * answers along the bottom, where the pips were.
 */
function Revealed({ pub, players }: { pub: QuizPublicState; players: Player[] }) {
  const question = pub.question!
  const reveal = pub.reveal!
  const reduce = useReducedMotion()
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? 'A guest'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start">
        <Question key={question.key} text={question.text} />
      </div>
      <Options key={question.key} options={question.options} reveal={reveal} />
      <div className="mt-10 flex min-w-0 shrink-0 items-center justify-between gap-10 short:mt-6 short:gap-8 low:mt-4 low:gap-6">
        {reveal.rightCount > 0 ? (
          <p className="flex shrink-0 items-baseline gap-4 whitespace-nowrap short:gap-3">
            <span className="tv-num text-tv-band text-paper short:text-tv-field low:text-tv-tab">
              {reveal.rightCount} of {reveal.answered}
            </span>
            <span className="text-tv-body font-medium text-paper-2 short:text-tv-tab low:text-tv-floor">got it right</span>
          </p>
        ) : (
          <p className="text-tv-body font-medium text-paper-2 short:text-tv-tab low:text-tv-floor">
            {reveal.answered === 0 ? 'Nobody answered this one.' : 'Nobody got this one.'}
          </p>
        )}
        {reveal.fastest.length > 0 && (
          <div className="flex min-w-0 items-center gap-8 short:gap-6 low:gap-5">
            <p className="shrink-0 text-tv-body font-medium text-paper-2 short:text-tv-tab low:text-tv-floor">Fastest</p>
            <ol className="flex min-w-0 items-center gap-8 short:gap-6 low:gap-5">
              {reveal.fastest.map((fast, i) => (
                <motion.li
                  key={fast.playerId}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: EASE_OUT, delay: reduce ? 0 : 0.6 + i * 0.12 }}
                  className="flex min-w-0 items-center gap-3"
                >
                  <Avatar name={nameOf(fast.playerId)} playerId={fast.playerId} className="size-12 short:size-10 low:size-8" />
                  <span className="max-w-[14rem] min-w-0 truncate text-tv-body font-bold text-paper short:max-w-[11rem] short:text-tv-tab low:text-tv-floor">
                    {nameOf(fast.playerId)}
                  </span>
                  <span className="shrink-0 tv-num text-tv-body text-paper-2 short:text-tv-tab low:text-tv-floor">{formatSeconds(fast.ms)}</span>
                </motion.li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The top five by quiz points after a question. Rows start in the order before
 * this question, then move to their new places. The leader's rank and points
 * are gold (the leader is one of gold's jobs); everyone else is paper, with
 * what they gained on a quiet chip.
 */
function Leaderboard({ pub, players }: { pub: QuizPublicState; players: Player[] }) {
  const reduce = useReducedMotion()
  const [moved, setMoved] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setMoved(true), reduce ? 0 : 1200)
    return () => clearTimeout(timer)
  }, [reduce])

  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? 'A guest'
  const order = new Map(players.map((p, i) => [p.id, i]))
  const rows = pub.leaderboard.filter((row) => order.has(row.playerId))
  const before = rows
    .map((row) => ({ ...row, points: row.points - row.gained }))
    .filter((row) => row.points > 0)
    .sort((a, b) => b.points - a.points || (order.get(a.playerId) ?? 0) - (order.get(b.playerId) ?? 0))
  const shown = (moved ? rows : before).slice(0, 5)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h2 className="shrink-0 wide text-tv-band text-paper short:text-tv-field low:text-tv-tab">The quiz so far</h2>
      {rows.length === 0 ? (
        <p className="m-auto text-tv-name text-paper-2 short:text-tv-band low:text-tv-field">No points yet. Plenty of questions to go.</p>
      ) : (
        <ol className="mt-8 grid shrink-0 gap-3 short:mt-6 short:gap-2.5 low:mt-4 low:gap-2">
          <AnimatePresence initial={false}>
            {shown.map((row) => {
              // Ties share a rank, before and after.
              const rank = moved ? row.rank : before.findIndex((other) => other.points === row.points) + 1
              const leads = rank === 1
              return (
                <motion.li
                  key={row.playerId}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5, ease: EASE_OUT }}
                  className="flex h-24 min-w-0 items-center gap-8 rounded-tile bg-raised pr-10 pl-8 short:h-20 short:gap-6 short:pr-8 short:pl-6 low:h-15 low:gap-5 low:pl-5"
                >
                  <span className={cn('w-[2ch] shrink-0 text-right tv-num text-tv-score short:text-tv-name low:text-tv-field', leads ? 'text-gold' : 'text-paper-3')}>
                    {rank}
                  </span>
                  <Avatar name={nameOf(row.playerId)} playerId={row.playerId} className="size-16 short:size-14 low:size-11" />
                  <span className="min-w-0 flex-1 truncate text-tv-name font-bold text-paper short:text-tv-band low:text-tv-field">
                    {nameOf(row.playerId)}
                  </span>
                  {moved && row.gained > 0 && (
                    <motion.span
                      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, ease: EASE_OUT }}
                      className="shrink-0 rounded-chip bg-overlay px-3.5 py-1 tv-num text-tv-field text-paper-2 short:text-tv-tab low:px-2.5 low:py-0.5 low:text-tv-floor"
                    >
                      +{formatNumber(row.gained)}
                    </motion.span>
                  )}
                  <motion.span
                    key={moved ? 'after' : 'before'}
                    initial={reduce ? false : { scale: moved ? 1.12 : 1 }}
                    animate={{ scale: 1 }}
                    transition={{ duration: 0.4, ease: EASE_OUT }}
                    className={cn(
                      'w-[5ch] shrink-0 text-right tv-num text-tv-score short:text-tv-name low:text-tv-field',
                      leads ? 'text-gold' : 'text-paper',
                    )}
                  >
                    {formatNumber(row.points)}
                  </motion.span>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ol>
      )}
    </div>
  )
}
