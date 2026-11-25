import { motion, useReducedMotion } from 'motion/react'
import Avatar from '@/components/Avatar'
import Confetti from '@/components/Confetti'
import { listNames, plural, type FusionGame } from '@/games/fusion/logic'
import { bestDisguise, nameOf, publicOf } from '@/games/fusion/view'
import type { TvViewProps } from '@/games/types'
import { withRanks } from '@/lib/format'
import { cn } from '@/lib/utils'

const EASE_OUT = [0.22, 1, 0.36, 1] as const

// The podium's columns, left to right: second, first, third.
const ORDER = [1, 0, 2]
/**
 * The steps by place (ties share a step), told apart by height, at 1080p and
 * then short: and low:, so the podium and the best disguise under it fit the
 * stage with two band lines at every size (docs/identity.md, The TV's frame).
 */
const STEP = ['h-56 short:h-48 low:h-32', 'h-44 short:h-38 low:h-26', 'h-34 short:h-30 low:h-22']

/**
 * The TV's final screen for Who is fused? (docs/identity.md): who has the
 * sharpest eye, the top three face detectives on paper steps of clearly
 * different heights with their points (the winner's on gold), and the best
 * disguise. The strap already names the game. The logo's confetti bursts
 * once behind it; everything else fades or rises in.
 */
export default function FinalTvView({ game, players, publicState }: TvViewProps<FusionGame>) {
  const reduce = useReducedMotion()
  const pub = publicOf(publicState)
  const winners = game.winners
  const podium = withRanks(pub?.top.slice(0, 3) ?? [])
  const disguise = pub ? bestDisguise(pub.pictures) : null
  const names = winners.map((id) => nameOf(players, id))

  return (
    <div className="relative isolate flex min-h-0 flex-1 flex-col items-center justify-center gap-10 short:gap-6 low:gap-4">
      <Confetti pieces={60} />
      <header className="max-w-full text-center">
        <h2 className="text-tv-question font-black text-balance short:text-tv-answer low:text-tv-score">
          {winners.length > 0
            ? `${listNames(names)} ${winners.length > 1 ? 'have the sharpest eyes' : 'has the sharpest eye'}.`
            : `${game.title} is over`}
        </h2>
        {winners.length === 0 && <p className="mt-3 text-tv-name text-paper-2 short:text-tv-band low:text-tv-field">Nobody scored this time.</p>}
      </header>

      {podium.length > 0 && (
        <ol className="flex max-w-full items-end justify-center gap-6 short:gap-5 low:gap-4" aria-label="The top face detectives">
          {ORDER.filter((i) => podium[i]).map((i, column) => {
            const row = podium[i]
            const name = nameOf(players, row.playerId)
            const wins = winners.includes(row.playerId)
            const place = Math.min(row.rank, 3)
            return (
              <motion.li
                key={row.playerId}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: EASE_OUT, delay: reduce ? 0 : 0.3 + column * 0.2 }}
                className="flex w-[25rem] min-w-0 flex-col items-start short:w-[20rem] low:w-[16rem]"
              >
                <Avatar name={name} playerId={row.playerId} className="size-20 short:size-16 low:size-12" />
                <div
                  className={cn(
                    'mt-3 flex w-full min-w-0 items-start justify-between gap-4 bg-paper pt-4 pr-5 pl-6 text-ink short:mt-2 short:pt-3 short:pl-5 low:pt-2 low:pr-4 low:pl-4',
                    STEP[place - 1],
                  )}
                >
                  <div className="min-w-0">
                    <p className="truncate tv-num text-tv-name short:text-tv-band low:text-tv-field">{name}</p>
                    <p className="mt-1 flex items-baseline gap-2">
                      <span className={cn('tv-num text-tv-name short:text-tv-band low:text-tv-field', wins && 'rounded-chip bg-gold px-2.5 low:px-1.5')}>
                        {row.points}
                      </span>
                      <span className="text-tv-floor font-semibold">{row.points === 1 ? 'point' : 'points'}</span>
                    </p>
                  </div>
                  <span className="shrink-0 wide text-tv-code leading-[0.9] short:text-tv-answer low:text-tv-score">{row.rank}</span>
                </div>
              </motion.li>
            )
          })}
        </ol>
      )}

      {disguise && (
        <p className="max-w-full text-center text-tv-body text-paper-2 short:text-tv-tab low:text-tv-floor">
          Best disguise: <span className="font-bold text-paper">{disguise.label}</span>, only {disguise.revealed.both} of{' '}
          {plural(disguise.revealed.voters, 'guest')} got both
        </p>
      )}
    </div>
  )
}
