import { CrownIcon, DetectiveIcon } from '@phosphor-icons/react'
import { motion, useReducedMotion } from 'motion/react'
import Avatar from '@/components/Avatar'
import ConfettiBurst from '@/games/fusion/ConfettiBurst'
import { listNames, plural, type FusionGame } from '@/games/fusion/logic'
import { bestDisguise, nameOf, publicOf } from '@/games/fusion/view'
import type { TvViewProps } from '@/games/types'
import { withRanks } from '@/lib/format'
import { cn } from '@/lib/utils'

// The podium's columns, left to right: second, first, third.
const ORDER = [1, 0, 2]
const STEP = ['h-[34vh] short:h-[30vh]', 'h-[26vh] short:h-[22vh]', 'h-[20vh] short:h-[16vh]']

/**
 * The TV's final screen for fusion: the top three face detectives on a podium
 * with giant rank numerals behind them, confetti, and the best disguise.
 */
export default function FinalTvView({ game, players, publicState }: TvViewProps<FusionGame>) {
  const reduce = useReducedMotion()
  const pub = publicOf(publicState)
  const winners = game.winners
  const podium = withRanks(pub?.top.slice(0, 3) ?? [])
  const disguise = pub ? bestDisguise(pub.pictures) : null
  const names = winners.map((id) => nameOf(players, id))

  return (
    <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-10 short:gap-6">
      <ConfettiBurst pieces={60} />
      <header className="text-center">
        <p className="flex items-center justify-center gap-3 text-2xl font-semibold tracking-widest text-confetti-violet uppercase short:text-xl">
          <DetectiveIcon weight="duotone" className="size-8" />
          {game.title}
        </p>
        <h2 className="mt-2 text-7xl font-black text-balance short:text-6xl">
          {winners.length > 0
            ? `${listNames(names)} ${winners.length > 1 ? 'have the sharpest eyes' : 'has the sharpest eye'}!`
            : `${game.title} is over`}
        </h2>
        {winners.length === 0 && <p className="mt-3 text-3xl text-muted-foreground">Nobody scored this time.</p>}
      </header>

      {podium.length > 0 && (
        <ol className="flex items-end justify-center gap-8" aria-label="The top face detectives">
          {ORDER.filter((i) => podium[i]).map((i, column) => {
            const row = podium[i]
            const name = nameOf(players, row.playerId)
            const crowned = winners.includes(row.playerId)
            return (
              <motion.li
                key={row.playerId}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 80 }}
                animate={{ opacity: 1, y: 0 }}
                transition={reduce ? { duration: 0.5 } : { type: 'spring', stiffness: 200, damping: 20, delay: 0.3 + column * 0.2 }}
                className="flex w-72 flex-col items-center gap-4 short:w-60"
              >
                <div className="relative">
                  <Avatar
                    name={name}
                    className={cn(i === 0 ? 'size-36 text-5xl short:size-28 short:text-4xl' : 'size-28 text-4xl short:size-24 short:text-3xl')}
                  />
                  {crowned && (
                    <CrownIcon
                      weight="fill"
                      className="absolute -top-9 left-1/2 size-14 -translate-x-1/2 text-primary drop-shadow-[0_0_18px_rgb(245_197_66/0.6)]"
                    />
                  )}
                </div>
                <p className="w-full truncate text-center text-4xl font-black short:text-3xl">{name}</p>
                <div
                  className={cn(
                    'relative grid w-full place-items-center overflow-hidden rounded-t-3xl ring-1',
                    STEP[i],
                    i === 0 ? 'bg-primary/20 ring-primary/50' : 'bg-card ring-foreground/10',
                  )}
                >
                  <span
                    aria-hidden
                    className="absolute -bottom-6 text-[14rem] leading-none font-black text-foreground/8 short:text-[11rem]"
                  >
                    {row.rank}
                  </span>
                  <p className="relative text-center">
                    <span className="block text-6xl font-black text-primary tabular-nums short:text-5xl">{row.points}</span>
                    <span className="text-xl text-muted-foreground">{row.points === 1 ? 'point' : 'points'}</span>
                  </p>
                </div>
              </motion.li>
            )
          })}
        </ol>
      )}

      {disguise && (
        <p className="text-3xl text-muted-foreground short:text-2xl">
          Best disguise: <span className="font-bold text-foreground">{disguise.label}</span>, only{' '}
          {disguise.revealed.both} of {plural(disguise.revealed.voters, 'guest')} got both
        </p>
      )}
    </div>
  )
}
