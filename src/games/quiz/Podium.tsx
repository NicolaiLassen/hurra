import { motion, useReducedMotion } from 'motion/react'
import Avatar from '@/components/Avatar'
import Piece, { type PieceKind } from '@/components/Piece'
import { formatNumber, joinNames, type QuizPublicState } from '@/games/quiz/logic'
import type { Player, SessionGame } from '@/lib/types'
import { cn } from '@/lib/utils'

const EASE_OUT = [0.22, 1, 0.36, 1] as const

/**
 * The steps by place (ties share a step), told apart by height: paper steps
 * with the name and points in ink and the place in wide Archivo, like the
 * night's podium. 1080p, then short: and low:.
 */
const STEPS = [
  'h-56 short:h-44 low:h-36',
  'h-44 short:h-35 low:h-30',
  'h-34 short:h-27 low:h-24',
]
// Left to right: the second row, the first, the third.
const SLOTS = [1, 0, 2]

/** The cheer's sizes, by the winners' names' length, so a long name stays on one line (it ends in an ellipsis past the last). */
function cheerSize(names: string): string {
  const n = Array.from(names).length
  if (n <= 10) return 'text-tv-code short:text-tv-question low:text-tv-answer'
  if (n <= 16) return 'text-tv-question short:text-tv-answer low:text-tv-score'
  if (n <= 24) return 'text-tv-answer short:text-tv-score low:text-tv-name'
  return 'text-tv-name short:text-tv-band low:text-tv-field'
}

/** The logo's confetti pieces in the logo's colours (public/favicon.svg), never the stock shapes. */
const PIECES: PieceKind[] = ['dot', 'curl', 'wave', 'star']
const PIECE_TONES = ['text-gold', 'text-pink', 'text-guest-teal', 'text-guest-violet']
// A fixed scatter (not random), so pieces keep their places on every render.
const CONFETTI = Array.from({ length: 36 }, (_, i) => ({
  left: (i * 29 + 7) % 100,
  delay: (i % 9) * 0.2,
  duration: 3.2 + ((i * 7) % 10) / 4,
  drift: ((i * 13) % 17) - 8,
  turn: 180 + ((i * 47) % 360),
  kind: PIECES[i % PIECES.length],
  className: cn(PIECE_TONES[(i + Math.floor(i / 4)) % PIECE_TONES.length], ['size-7', 'size-9', 'size-6'][i % 3]),
}))

/**
 * The quiz's final screen (FinalTvView, and TvView once it is done): "Hurra
 * for Ana" with the winner's token and points, the line that saves the third
 * hurra for the night's winner, and the top three on paper steps. Gold only
 * for the winner: their points. The logo's confetti falls twice over it.
 */
export default function QuizPodium({ game, players, pub }: { game: SessionGame; players: Player[]; pub: QuizPublicState }) {
  const reduce = useReducedMotion()
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? 'A guest'
  const board = pub.leaderboard.filter((row) => players.some((p) => p.id === row.playerId))
  const top = board.slice(0, 3)
  const winners = game.winners.length > 0 ? game.winners : board.filter((row) => row.rank === 1).map((row) => row.playerId)

  if (top.length === 0) {
    return (
      <div className="my-auto flex flex-col items-start gap-6 short:gap-4">
        <p className="wide text-tv-code text-paper short:text-tv-question low:text-tv-answer">The quiz is over</p>
        <p className="text-tv-name text-paper-2 short:text-tv-band low:text-tv-field">Nobody scored this time.</p>
      </div>
    )
  }

  const names = joinNames(winners.map(nameOf))
  const best = board.find((row) => row.playerId === winners[0])?.points ?? top[0].points
  const rise = (delay: number) =>
    reduce
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.3, delay } }
      : { initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.45, ease: EASE_OUT, delay } }

  return (
    // Its own stacking context, so the confetti falls behind the words and the steps.
    <div className="relative isolate flex min-h-0 flex-1 flex-col">
      {!reduce && <Confetti />}

      <div className="flex min-w-0 shrink-0 items-center gap-12 short:gap-8 low:gap-6">
        {/* Inset by the tilt's overhang, so the stage's clipped edge never cuts a token's corner. */}
        <div className="m-2 flex shrink-0 -space-x-6 short:m-1.5">
          {winners.slice(0, 3).map((id, i) => (
            <motion.div
              key={id}
              initial={reduce ? { opacity: 0 } : { opacity: 0, rotate: 6, scale: 1.08 }}
              animate={{ opacity: 1, rotate: -3, scale: 1 }}
              transition={{ duration: 0.3, ease: EASE_OUT, delay: 0.1 + i * 0.1 }}
            >
              <Avatar
                name={nameOf(id)}
                playerId={id}
                className={cn(winners.length > 1 ? 'size-36 short:size-28 low:size-20' : 'size-52 short:size-40 low:size-28')}
              />
            </motion.div>
          ))}
        </div>
        <div className="min-w-0">
          <motion.p {...rise(0.15)} className={cn('truncate wide leading-[1.02] text-paper', cheerSize(names))}>
            Hurra for {names}
          </motion.p>
          <motion.p {...rise(0.3)} className="mt-4 text-tv-name font-bold text-paper short:mt-3 short:text-tv-band low:mt-2 low:text-tv-field">
            {winners.length > 1 ? 'They share the win with ' : 'Won the quiz with '}
            <span className="tv-num text-gold">{formatNumber(best)}</span> points.
          </motion.p>
          <motion.p {...rise(0.45)} className="mt-2 text-tv-body text-paper-2 short:text-tv-tab low:mt-1 low:text-tv-floor">
            The third hurra is saved for the night's winner.
          </motion.p>
        </div>
      </div>

      <div className="mt-auto flex min-h-0 items-end justify-center gap-6 pt-8 short:gap-5 short:pt-6 low:gap-4 low:pt-4">
        {SLOTS.filter((slot) => slot < top.length).map((slot) => {
          const row = top[slot]
          const place = Math.min(row.rank, 3)
          const wins = row.rank === 1
          return (
            <motion.div
              key={row.playerId}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: EASE_OUT, delay: reduce ? 0 : 0.5 + (2 - slot) * 0.2 }}
              className="flex w-[25rem] min-w-0 flex-col items-start short:w-[20rem] low:w-[16rem]"
            >
              <Avatar name={nameOf(row.playerId)} playerId={row.playerId} className="size-20 short:size-16 low:size-12" />
              <div
                className={cn(
                  'mt-3 flex w-full min-w-0 items-start justify-between gap-4 bg-paper pt-4 pr-5 pl-6 text-ink short:mt-2 short:pt-3 short:pl-5 low:pt-2 low:pr-4 low:pl-4',
                  STEPS[place - 1],
                )}
              >
                <div className="min-w-0">
                  <p className="truncate tv-num text-tv-name short:text-tv-band low:text-tv-field">{nameOf(row.playerId)}</p>
                  <p className="mt-1 flex items-center">
                    <span
                      className={cn(
                        'tv-num text-tv-name short:text-tv-band low:text-tv-field',
                        wins && 'rounded-chip bg-gold px-2.5 low:px-1.5',
                      )}
                    >
                      {formatNumber(row.points)}
                    </span>
                  </p>
                </div>
                <span className="shrink-0 wide text-tv-code leading-[0.9] short:text-tv-answer low:text-tv-score">{row.rank}</span>
              </div>
            </motion.div>
          )
        })}
      </div>

      {board.length > 3 && (
        <ol className="mt-6 flex max-w-full shrink-0 flex-wrap justify-center gap-x-10 gap-y-2 overflow-hidden short:mt-4 short:gap-x-8 low:hidden">
          {board.slice(3, 8).map((row) => (
            <li key={row.playerId} className="flex min-w-0 items-baseline gap-3 text-tv-body short:text-tv-tab">
              <span className="tv-num text-paper-3">{row.rank}</span>
              <span className="max-w-[14rem] truncate font-semibold text-paper">{nameOf(row.playerId)}</span>
              <span className="tv-num text-paper-2">{formatNumber(row.points)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function Confetti() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {CONFETTI.map((piece, i) => (
        <motion.span
          key={i}
          className={cn('absolute top-0', piece.className)}
          style={{ left: `${piece.left}%` }}
          initial={{ y: '-10vh', x: 0, rotate: 0, opacity: 0 }}
          animate={{ y: '110vh', x: `${piece.drift}vw`, rotate: piece.turn, opacity: [0, 1, 1, 0.7] }}
          transition={{ duration: piece.duration, delay: piece.delay, ease: 'easeIn', repeat: 1, repeatDelay: 0.4 }}
        >
          <Piece kind={piece.kind} className="size-full" />
        </motion.span>
      ))}
    </div>
  )
}
