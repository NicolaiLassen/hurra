import { CrownIcon, GameControllerIcon, TrophyIcon } from '@phosphor-icons/react'
import { motion, useReducedMotion } from 'motion/react'
import AnnouncementIconView from '@/components/AnnouncementIconView'
import Avatar from '@/components/Avatar'
import Callout from '@/components/Callout'
import { CARD } from '@/components/tv/look'
import { Eyebrow } from '@/components/tv/parts'
import { topOfGame, winnerNames } from '@/components/tv/scene'
import { getGameModule } from '@/games/registry'
import type { TvViewProps } from '@/games/types'
import { announcementTone } from '@/lib/announcement'
import { listNames } from '@/lib/recap'
import { cn } from '@/lib/utils'

/** Winners' avatars shown at most; the line names everyone. */
const AVATARS = 4

/**
 * The final screen of a game without one of its own (docs/engine-v2.md, 7.2):
 * its title, the winners' avatars with a crown (or "{title} is over" when
 * nobody won), this game's top 5 and its last room-wide announcement.
 */
export default function FinalScreen({ game, players, gamePoints, feed }: TvViewProps) {
  const reduce = useReducedMotion()
  const Icon = getGameModule(game.game_type)?.icon ?? GameControllerIcon
  const names = winnerNames(game, players)
  const winners = players.filter((p) => game.winners.includes(p.id))
  const top = topOfGame(gamePoints, players)
  const last = feed[0]
  const enter = (delay: number) =>
    reduce
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.4 } }
      : { initial: { opacity: 0, y: 30 }, animate: { opacity: 1, y: 0 }, transition: { type: 'spring' as const, stiffness: 220, damping: 22, delay } }

  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-10 short:gap-6">
      <motion.header {...enter(0)}>
        <p className="flex items-center gap-3 text-2xl font-semibold tracking-widest text-primary uppercase short:text-xl">
          <TrophyIcon weight="fill" />
          Final result
        </p>
        <h2 className="mt-2 flex items-center gap-4 text-7xl font-black tracking-tight short:text-6xl">
          <Icon weight="duotone" className="size-16 shrink-0 text-primary short:size-12" />
          <span className="min-w-0 truncate">{game.title}</span>
        </h2>
      </motion.header>

      <motion.div {...enter(0.2)} className="flex min-w-0 items-center gap-10 short:gap-8">
        {winners.length > 0 ? (
          <>
            <div className="flex shrink-0 -space-x-6 pt-10 short:pt-8">
              {winners.slice(0, AVATARS).map((p) => (
                <div key={p.id} className="relative">
                  <Avatar name={p.name} className="size-32 text-5xl ring-4 ring-background short:size-24 short:text-4xl" />
                  <CrownIcon
                    weight="fill"
                    className="absolute -top-10 left-1/2 size-14 -translate-x-1/2 text-primary drop-shadow-[0_0_20px_rgb(245_197_66/0.6)] short:-top-8 short:size-11"
                  />
                </div>
              ))}
            </div>
            <p className="min-w-0 text-6xl leading-tight font-black text-balance short:text-5xl">
              {listNames(names)}{' '}
              <span className="text-4xl font-semibold text-muted-foreground short:text-3xl">
                {names.length > 1 ? 'share the win' : 'wins'}
              </span>
            </p>
          </>
        ) : (
          <p className="text-5xl font-bold text-muted-foreground short:text-4xl">{game.title} is over</p>
        )}
      </motion.div>

      {(top.length > 0 || last) && (
        <motion.div {...enter(0.4)} className="grid min-h-0 grid-cols-2 items-start gap-8 short:gap-6">
          {top.length > 0 && (
            <section className={cn(CARD, 'p-6 short:p-5')}>
              <Eyebrow className="mb-4 short:mb-3">Top 5 in {game.title}</Eyebrow>
              <ol className="grid grid-cols-1 gap-2">
                {top.map((row, i) => (
                  <li key={row.player.id} className="flex items-center gap-3">
                    <span className="w-7 text-right text-2xl font-bold text-muted-foreground tabular-nums short:text-xl">{i + 1}</span>
                    <Avatar name={row.player.name} className="size-10 text-sm short:size-9" />
                    <span className="min-w-0 flex-1 truncate text-2xl font-semibold short:text-xl">{row.player.name}</span>
                    <span className="text-3xl font-black text-primary tabular-nums short:text-2xl">{row.points}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {last && (
            <Callout
              size="tv"
              tone={announcementTone(last.tone)}
              icon={<AnnouncementIconView name={last.icon} />}
              eyebrow="Last news"
              title={last.message}
              detail={last.detail}
            />
          )}
        </motion.div>
      )}
    </div>
  )
}
