import { CheckCircleIcon, CheckIcon, LightningIcon } from '@phosphor-icons/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import Avatar from '@/components/Avatar'
import { SOUNDS } from '@/games/core/sounds'
import { useMomentSound, useMomentSoundAt, useServerTime } from '@/games/quiz/clock'
import { formatNumber, formatSeconds, type QuizGame, type QuizPublicState } from '@/games/quiz/logic'
import { FRESH_MS, LETTERS, momentId, OPTION_STEPS, QUESTION_STEPS, tvOptionSize, tvQuestionSize, URGENT_MS } from '@/games/quiz/look'
import { AnsweredDots, LetterBadge } from '@/games/quiz/parts'
import QuizPodium from '@/games/quiz/Podium'
import { readPublic } from '@/games/quiz/read'
import type { TvViewProps } from '@/games/types'
import type { Player, PromptState, SessionGame } from '@/lib/types'
import { cn } from '@/lib/utils'

/** The house easing (docs/identity.md, Motion). */
const EASE_OUT = [0.22, 1, 0.36, 1] as const
const spring = { type: 'spring', stiffness: 260, damping: 26 } as const

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

/** The answer: each option fills like a bar to its count, the right one gold, then the fastest right answers. */
function Revealed({ pub, players }: { pub: QuizPublicState; players: Player[] }) {
  const question = pub.question!
  const reveal = pub.reveal!
  const reduce = useReducedMotion()
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? 'A guest'
  const most = Math.max(1, reveal.answered)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 short:gap-4">
      <div className="flex shrink-0 items-baseline justify-between gap-6">
        <Eyebrow>
          Question {pub.index + 1} of {pub.total}: the answer
        </Eyebrow>
        <p className="text-3xl font-semibold text-muted-foreground short:text-2xl">
          <span className="font-black text-primary">{reveal.rightCount}</span> of {reveal.answered} got it right
        </p>
      </div>

      <QuestionCard text={question.text} revealing />

      <ol className="grid shrink-0 gap-4 short:gap-3">
        {question.options.map((option, i) => {
          const right = i === reveal.correct
          const count = reveal.counts[i] ?? 0
          return (
            <li key={`${question.key}-${i}`}>
              <OptionRow
                index={i}
                text={option}
                size={tvOptionSize(question.options)}
                right={right}
                dimmed={!right}
                fill={
                  <motion.div
                    className={cn('absolute inset-y-0 left-0', right ? 'bg-linear-to-r from-primary/55 to-primary/30' : 'bg-white/8')}
                    initial={{ width: reduce ? `${(count / most) * 100}%` : 0 }}
                    animate={{ width: `${(count / most) * 100}%` }}
                    transition={{ duration: 0.9, delay: reduce ? 0 : 0.2 + i * 0.1, ease: [0.22, 1, 0.36, 1] }}
                  />
                }
                end={
                  <span className={cn('flex shrink-0 items-center gap-3 font-black tabular-nums', right ? 'text-primary' : 'text-muted-foreground')}>
                    {right && <CheckCircleIcon weight="fill" className="size-10 short:size-8" />}
                    {count}
                  </span>
                }
              />
            </li>
          )
        })}
      </ol>

      <div className="mt-auto flex min-h-14 shrink-0 items-center gap-6 short:min-h-12">
        {reveal.fastest.length > 0 ? (
          <>
            <p className="flex shrink-0 items-center gap-2 text-2xl font-semibold text-muted-foreground short:text-xl">
              <LightningIcon weight="fill" className="text-confetti-teal" />
              Fastest
            </p>
            <ol className="flex min-w-0 flex-1 gap-4">
              {reveal.fastest.map((fast, i) => (
                <motion.li
                  key={fast.playerId}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...spring, delay: reduce ? 0 : 0.6 + i * 0.12 }}
                  className="flex min-w-0 items-center gap-3 rounded-full bg-card/80 py-1.5 pr-5 pl-1.5 ring-1 ring-foreground/10"
                >
                  <Avatar name={nameOf(fast.playerId)} className="size-11 short:size-9" />
                  <span className="truncate text-2xl font-bold short:text-xl">{nameOf(fast.playerId)}</span>
                  <span className="shrink-0 text-2xl font-black text-confetti-teal short:text-xl">{formatSeconds(fast.ms)}</span>
                </motion.li>
              ))}
            </ol>
          </>
        ) : (
          <p className="text-2xl text-muted-foreground short:text-xl">Nobody got this one. On to the next!</p>
        )}
      </div>
    </div>
  )
}

/** The top five by quiz points. Rows start in the order before this question, then move to their new places. */
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
    <div className="flex min-h-0 flex-1 flex-col gap-6 short:gap-4">
      <div className="flex shrink-0 items-baseline justify-between gap-6">
        <Eyebrow>Leaderboard</Eyebrow>
        <p className="text-3xl font-semibold text-muted-foreground short:text-2xl">
          After question {pub.index + 1} of {pub.total}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="m-auto text-4xl text-muted-foreground">No points yet. Plenty of questions to go!</p>
      ) : (
        <ol className="grid shrink-0 gap-4 short:gap-3">
          <AnimatePresence initial={false}>
            {shown.map((row) => {
              // Ties share a rank, before and after.
              const rank = moved ? row.rank : before.findIndex((other) => other.points === row.points) + 1
              return (
                <motion.li
                  key={row.playerId}
                  layout
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.92 }}
                  transition={spring}
                  className={cn(
                    'relative flex h-24 items-center gap-6 rounded-3xl bg-card/85 px-7 ring-1 ring-foreground/10 backdrop-blur short:h-18 short:gap-4',
                    moved && row.rank === 1 && 'bg-primary/15 ring-2 ring-primary',
                  )}
                >
                  <span className="w-12 text-right text-4xl font-black text-muted-foreground tabular-nums short:text-3xl">
                    {rank}
                  </span>
                  <Avatar name={nameOf(row.playerId)} className="size-16 short:size-12" />
                  <span className="min-w-0 flex-1 truncate text-4xl font-bold short:text-3xl">{nameOf(row.playerId)}</span>
                  {moved && row.gained > 0 && (
                    <motion.span
                      initial={{ opacity: 0, y: 12, scale: 0.6 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ type: 'spring', stiffness: 320, damping: 18 }}
                      className="shrink-0 rounded-full bg-confetti-teal px-4 py-1 text-2xl font-black text-background short:text-xl"
                    >
                      +{formatNumber(row.gained)}
                    </motion.span>
                  )}
                  <motion.span
                    key={moved ? 'after' : 'before'}
                    initial={{ scale: moved ? 1.3 : 1 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 14 }}
                    className="w-44 shrink-0 text-right text-5xl font-black text-primary short:w-36 short:text-4xl"
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

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-2xl font-semibold tracking-widest text-muted-foreground uppercase short:text-xl">{children}</p>
}

/** The question on a large dark card. Children sit on it, like the countdown bar along its bottom edge. */
function QuestionCard({ text, revealing = false, children }: { text: string; revealing?: boolean; children?: React.ReactNode }) {
  const reduce = useReducedMotion()
  return (
    <motion.section
      // At the reveal the card is already on screen: it only settles into its smaller size.
      initial={revealing ? false : reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring}
      className="relative shrink-0 overflow-hidden rounded-[2.5rem] bg-card px-12 pt-9 pb-11 shadow-2xl shadow-black/40 ring-1 ring-foreground/10 short:rounded-[2rem] short:px-9 short:pt-7 short:pb-9"
    >
      <p className={cn('leading-[1.12] font-black text-balance', tvQuestionSize(text, revealing))}>{text}</p>
      {children}
    </motion.section>
  )
}

/** One option: its letter badge and text on a dark row; at the reveal it fills to its count. */
function OptionRow({
  index,
  text,
  size,
  right = false,
  dimmed = false,
  fill,
  end,
}: {
  index: number
  text: string
  size: string
  right?: boolean
  dimmed?: boolean
  fill?: React.ReactNode
  end?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'relative flex min-h-24 items-center gap-6 overflow-hidden rounded-3xl bg-card/90 py-3 pr-8 pl-4 ring-1 ring-foreground/10 transition-opacity duration-500 short:min-h-18 short:gap-4',
        right && 'ring-2 ring-primary',
        dimmed && !right && 'opacity-45',
      )}
    >
      {fill}
      <LetterBadge index={index} className="relative size-16 rounded-2xl text-4xl short:size-12 short:text-2xl" />
      <span className={cn('relative min-w-0 flex-1 leading-tight font-semibold break-words', size)}>{text}</span>
      {end && <span className={cn('relative', size)}>{end}</span>}
    </div>
  )
}
