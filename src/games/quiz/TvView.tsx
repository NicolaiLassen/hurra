import { CheckCircleIcon, LightningIcon, QuestionIcon } from '@phosphor-icons/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'
import Avatar from '@/components/Avatar'
import { useMomentSound, useServerTime } from '@/games/quiz/clock'
import { formatNumber, formatSeconds, type QuizGame, type QuizPublicState } from '@/games/quiz/logic'
import { FRESH_MS, LETTERS, momentId, tvOptionSize, tvQuestionSize } from '@/games/quiz/look'
import { AnsweredDots, DrainBar, LetterBadge, SecondsLeft } from '@/games/quiz/parts'
import QuizPodium from '@/games/quiz/Podium'
import { readPublic } from '@/games/quiz/read'
import type { TvViewProps } from '@/games/types'
import type { Player, PromptState, SessionGame } from '@/lib/types'
import { cn } from '@/lib/utils'

const spring = { type: 'spring', stiffness: 260, damping: 26 } as const

/**
 * The quiz on the TV stage: the lobby, each question with its draining bar and
 * the answers coming in, the reveal, and the leaderboard after each question.
 * It draws the moments itself, so its announcements only sound on the stage.
 */
export default function TvView({ game, players, publicState, prompts, tallies, serverNow, finished }: TvViewProps<QuizGame>) {
  const pub = readPublic(publicState)
  if (!pub) return <p className="m-auto text-3xl text-muted-foreground">Getting the quiz ready…</p>
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
      return pub.question && pub.reveal ? (
        <Revealed game={game} pub={pub} prompt={prompt} players={players} serverNow={serverNow} />
      ) : (
        <p className="m-auto text-4xl text-muted-foreground">The answer is coming up…</p>
      )
    case 'leaderboard':
      return <Leaderboard key={pub.index} pub={pub} players={players} />
  }
}

function Lobby({ total }: { total: number }) {
  return (
    <div className="m-auto flex max-w-5xl flex-col items-center gap-8 text-center short:gap-6">
      <span className="grid size-36 rotate-3 place-items-center rounded-[2.5rem] bg-primary/15 ring-2 ring-primary/40 short:size-28">
        <QuestionIcon weight="duotone" className="size-20 text-primary short:size-16" />
      </span>
      <div>
        <h2 className="text-8xl font-black tracking-tight short:text-7xl">Quiz time</h2>
        <p className="mt-4 text-4xl text-muted-foreground short:text-3xl">
          {total} {total === 1 ? 'question' : 'questions'}. Answer on your phone.
        </p>
      </div>
      <div className="flex gap-4" aria-hidden>
        {LETTERS.map((letter, i) => (
          <LetterBadge key={letter} index={i} className="size-16 rounded-2xl text-3xl short:size-14" />
        ))}
      </div>
      <p className="text-2xl text-muted-foreground short:text-xl">
        A right answer scores 500 to 1,000 points. The faster you are, the more you get.
      </p>
    </div>
  )
}

/** A question on the screen: the card with its draining bar, the options, the dots filling in. */
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
  // A whoosh when the question appears, and the tick-tock as time runs out: its bell lands on the reveal.
  useMomentSound(openedAt === null || now - openedAt < FRESH_MS ? momentId(game, question.key, 'asked') : null, 'whoosh')
  const timeUp = now >= question.endsAt
  useMomentSound(timeUp && now - question.endsAt < FRESH_MS ? momentId(game, question.key, 'answer') : null, 'ticktock')

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 short:gap-4">
      <div className="flex shrink-0 items-baseline justify-between gap-6">
        <Eyebrow>
          Question {pub.index + 1} of {pub.total}
        </Eyebrow>
        <SecondsLeft endsAt={question.endsAt} serverNow={serverNow} className="text-5xl short:text-4xl" />
      </div>

      <QuestionCard key={question.key} text={question.text}>
        <DrainBar startsAt={openedAt} endsAt={question.endsAt} serverNow={serverNow} className="absolute inset-x-0 bottom-0 h-3 short:h-2" />
      </QuestionCard>

      <ol className="grid shrink-0 gap-4 short:gap-3">
        {question.options.map((option, i) => (
          <motion.li
            key={`${question.key}-${i}`}
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...spring, delay: 0.15 + i * 0.08 }}
          >
            <OptionRow index={i} text={option} size={tvOptionSize(question.options)} dimmed={timeUp} />
          </motion.li>
        ))}
      </ol>

      <AnsweredDots count={answered} total={guests} screen="tv" className="mt-auto shrink-0 text-3xl short:text-2xl" />
    </div>
  )
}

/** The answer: each option fills like a bar to its count, the right one gold, then the fastest right answers. */
function Revealed({
  game,
  pub,
  prompt,
  players,
  serverNow,
}: {
  game: SessionGame
  pub: QuizPublicState
  prompt: PromptState | undefined
  players: Player[]
  serverNow: () => number
}) {
  const question = pub.question!
  const reveal = pub.reveal!
  const reduce = useReducedMotion()
  const [revealedAt] = useState(() => prompt?.revealed_at ?? serverNow())
  // Unless it already rolled when time ran out.
  useMomentSound(serverNow() - revealedAt < FRESH_MS ? momentId(game, question.key, 'answer') : null, 'ticktock')
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
                  <Avatar name={nameOf(fast.playerId)} className="size-11 text-base short:size-9" />
                  <span className="truncate text-2xl font-bold short:text-xl">{nameOf(fast.playerId)}</span>
                  <span className="shrink-0 text-2xl font-black text-confetti-teal tabular-nums short:text-xl">{formatSeconds(fast.ms)}</span>
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
                  <Avatar name={nameOf(row.playerId)} className="size-16 text-2xl short:size-12 short:text-lg" />
                  <span className="min-w-0 flex-1 truncate text-4xl font-bold short:text-3xl">{nameOf(row.playerId)}</span>
                  {moved && row.gained > 0 && (
                    <motion.span
                      initial={{ opacity: 0, y: 12, scale: 0.6 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ type: 'spring', stiffness: 320, damping: 18 }}
                      className="shrink-0 rounded-full bg-confetti-teal px-4 py-1 text-2xl font-black text-background tabular-nums short:text-xl"
                    >
                      +{formatNumber(row.gained)}
                    </motion.span>
                  )}
                  <motion.span
                    key={moved ? 'after' : 'before'}
                    initial={{ scale: moved ? 1.3 : 1 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 14 }}
                    className="w-44 shrink-0 text-right text-5xl font-black text-primary tabular-nums short:w-36 short:text-4xl"
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
