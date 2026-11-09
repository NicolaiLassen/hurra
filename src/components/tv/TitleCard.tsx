import { GameControllerIcon } from '@phosphor-icons/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import Logo from '@/components/Logo'
import { TITLE_CARD_MS } from '@/components/tv/scene'
import { getGameModule } from '@/games/registry'
import type { SessionGame } from '@/lib/types'

/**
 * "Hurra presents": the 3 second title card the first time a game takes the
 * stage, over the game's icon, name and description (docs/engine-v2.md, 7.2).
 * The only title card: games don't draw their own. Fades only with reduced
 * motion. The game's screen is already mounted underneath, so it is ready.
 */
export default function TitleCard({ game }: { game: SessionGame | null }) {
  const reduce = useReducedMotion()
  const module = game ? getGameModule(game.game_type) : undefined
  const Icon = module?.icon ?? GameControllerIcon
  const rise = (delay: number) =>
    reduce
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.3, delay } }
      : {
          initial: { opacity: 0, y: 40, scale: 0.92 },
          animate: { opacity: 1, y: 0, scale: 1 },
          transition: { type: 'spring' as const, stiffness: 240, damping: 20, delay },
        }

  return (
    <AnimatePresence>
      {game && (
        <motion.div
          key={`${game.id}:${game.started_at}`}
          role="status"
          className="fixed inset-0 z-30 grid place-items-center overflow-hidden bg-background"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0.3 : 0.45 }}
        >
          {/* A spotlight from above, in the night sky's gold. */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(42% 70% at 50% -8%, color-mix(in oklch, var(--primary) 24%, transparent), transparent 72%), radial-gradient(40% 40% at 10% 100%, color-mix(in oklch, var(--confetti-violet) 14%, transparent), transparent)',
            }}
          />
          <div className="relative flex max-w-6xl flex-col items-center gap-8 px-12 text-center short:gap-6">
            <motion.p {...rise(0)} className="flex items-center gap-4 text-3xl font-semibold tracking-[0.3em] text-primary uppercase short:text-2xl">
              <Logo className="size-12 short:size-10" />
              Hurra presents
            </motion.p>
            <motion.span
              {...rise(0.15)}
              className="grid size-44 place-items-center rounded-[3rem] bg-primary/15 shadow-[0_0_80px_rgb(245_197_66/0.25)] ring-2 ring-primary/40 short:size-36 short:rounded-[2.5rem]"
            >
              <Icon weight="duotone" className="size-24 text-primary short:size-20" />
            </motion.span>
            <motion.h2 {...rise(0.3)} className="text-9xl leading-none font-black tracking-tight text-balance short:text-8xl">
              {game.title}
            </motion.h2>
            {module?.description && (
              <motion.p {...rise(0.45)} className="max-w-5xl text-4xl leading-snug text-balance text-muted-foreground short:text-3xl">
                {module.description}
              </motion.p>
            )}
          </div>
          {/* Drains over the card's 3 seconds. */}
          <motion.span
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-1.5 origin-left bg-primary"
            initial={{ scaleX: 1 }}
            animate={{ scaleX: 0 }}
            transition={{ duration: TITLE_CARD_MS / 1000, ease: 'linear' }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
