import { CrownIcon, TrophyIcon } from '@phosphor-icons/react'
import { motion, useReducedMotion } from 'motion/react'
import Avatar from '@/components/Avatar'
import { formatNumber, joinNames, type QuizPublicState } from '@/games/quiz/logic'
import type { Player, SessionGame } from '@/lib/types'
import { cn } from '@/lib/utils'

const spring = { type: 'spring', stiffness: 220, damping: 22 } as const

// By rank (ties share a step): gold, silver, bronze.
const STEPS = [
  {
    avatar: 'size-36 text-5xl ring-[6px] ring-primary short:size-28 short:text-4xl',
    pedestal: 'h-52 from-primary/45 short:h-32',
    points: 'text-primary',
  },
  {
    avatar: 'size-28 text-4xl ring-4 ring-slate-300/80 short:size-20 short:text-3xl',
    pedestal: 'h-36 from-slate-300/25 short:h-20',
    points: 'text-slate-200',
  },
  {
    avatar: 'size-28 text-4xl ring-4 ring-amber-600/80 short:size-20 short:text-3xl',
    pedestal: 'h-24 from-amber-600/30 short:h-14',
    points: 'text-amber-500',
  },
]
// Left to right: the second row, the first, the third.
const SLOTS = [1, 0, 2]

// A fixed scatter (not random), so pieces keep their places on every render.
const CONFETTI = Array.from({ length: 40 }, (_, i) => ({
  left: (i * 29 + 7) % 100,
  delay: (i % 10) * 0.18,
  duration: 3 + ((i * 7) % 10) / 4,
  drift: ((i * 13) % 17) - 8,
  turn: 360 + ((i * 47) % 360),
  className: cn(
    ['bg-primary', 'bg-confetti-pink', 'bg-confetti-teal', 'bg-confetti-violet'][i % 4],
    ['size-3 rounded-full', 'h-5 w-2 rounded-sm', 'h-2 w-5 rounded-sm'][i % 3],
  ),
}))

/** The quiz's final screen: "Hurra!", the top three on a podium, and confetti. */
export default function QuizPodium({ game, players, pub }: { game: SessionGame; players: Player[]; pub: QuizPublicState }) {
  const reduce = useReducedMotion()
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? 'A guest'
  const board = pub.leaderboard.filter((row) => players.some((p) => p.id === row.playerId))
  const top = board.slice(0, 3)
  const winners = game.winners.length > 0 ? game.winners : board.filter((row) => row.rank === 1).map((row) => row.playerId)

  if (top.length === 0) {
    return (
      <div className="m-auto flex flex-col items-center gap-6 text-center">
        <TrophyIcon weight="duotone" className="size-28 text-primary/70 short:size-20" />
        <p className="text-6xl font-black short:text-5xl">The quiz is over</p>
        <p className="text-3xl text-muted-foreground short:text-2xl">Nobody scored this time.</p>
      </div>
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-hidden short:gap-4">
      {!reduce && <Confetti />}
      <motion.p
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.5, rotate: -6 }}
        animate={{ opacity: 1, scale: 1, rotate: -3 }}
        transition={{ type: 'spring', stiffness: 300, damping: 14 }}
        className="text-9xl font-black tracking-tight text-primary [text-shadow:0_0_40px_rgb(245_197_66/0.45)] short:text-8xl"
      >
        Hurra!
      </motion.p>
      <p className="max-w-full truncate text-4xl font-bold short:text-3xl">
        {joinNames(winners.map(nameOf))} {winners.length > 1 ? 'share the win' : 'wins the quiz'}
      </p>

      <div className="flex items-end justify-center gap-6 short:gap-4">
        {SLOTS.filter((slot) => slot < top.length).map((slot) => {
          const row = top[slot]
          const step = STEPS[Math.min(row.rank, 3) - 1]
          return (
            <motion.div
              key={row.playerId}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 60 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: reduce ? 0 : 0.3 + (2 - slot) * 0.25 }}
              className="flex w-72 flex-col items-center short:w-56"
            >
              {row.rank === 1 && (
                <CrownIcon
                  weight="fill"
                  className="mb-2 size-14 text-primary drop-shadow-[0_0_20px_rgb(245_197_66/0.6)] short:size-10"
                />
              )}
              <Avatar name={nameOf(row.playerId)} className={step.avatar} />
              <p className="mt-3 w-full truncate text-center text-3xl font-bold short:mt-2 short:text-2xl">{nameOf(row.playerId)}</p>
              <p className={cn('text-4xl font-black tabular-nums short:text-3xl', step.points)}>{formatNumber(row.points)}</p>
              <div className={cn('mt-3 grid w-full place-items-center rounded-t-3xl bg-linear-to-b to-transparent', step.pedestal)}>
                <span className={cn('text-6xl font-black opacity-70 short:text-4xl', step.points)}>{row.rank}</span>
              </div>
            </motion.div>
          )
        })}
      </div>

      {board.length > 3 && (
        <ol className="flex max-w-full flex-wrap justify-center gap-3 short:hidden">
          {board.slice(3, 8).map((row) => (
            <li key={row.playerId} className="flex items-center gap-2 rounded-full bg-card/80 py-1.5 pr-4 pl-1.5 ring-1 ring-foreground/10">
              <span className="w-7 text-right text-xl font-bold text-muted-foreground tabular-nums">{row.rank}</span>
              <Avatar name={nameOf(row.playerId)} className="size-8 text-xs" />
              <span className="max-w-48 truncate text-xl font-semibold">{nameOf(row.playerId)}</span>
              <span className="text-xl font-black text-primary tabular-nums">{formatNumber(row.points)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function Confetti() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {CONFETTI.map((piece, i) => (
        <motion.span
          key={i}
          className={cn('absolute top-0', piece.className)}
          style={{ left: `${piece.left}%` }}
          initial={{ y: '-10vh', x: 0, rotate: 0, opacity: 0 }}
          animate={{ y: '110vh', x: `${piece.drift}vw`, rotate: piece.turn, opacity: [0, 1, 1, 0.7] }}
          transition={{ duration: piece.duration, delay: piece.delay, ease: 'easeIn', repeat: 2, repeatDelay: 0.4 }}
        />
      ))}
    </div>
  )
}
