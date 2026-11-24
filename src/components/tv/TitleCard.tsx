import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import Logo from '@/components/Logo'
import { Tab } from '@/components/tv/onAir'
import { TITLE_CARD_MS } from '@/components/tv/scene'
import { getGameModule } from '@/games/registry'
import type { SessionGame } from '@/lib/types'

/**
 * "Hurra presents": the 3 second title card the first time a game takes the
 * stage, with the gong (useTitleCard), over the plain studio ground
 * (docs/engine-v2.md, 7.2). The gold tab lands, then the game's name in wide
 * Archivo and its description. The only title card: games don't draw their
 * own. Fades only with reduced motion. The game's screen is already mounted
 * underneath, so it is ready.
 */
export default function TitleCard({ game }: { game: SessionGame | null }) {
  const reduce = useReducedMotion()
  const module = game ? getGameModule(game.game_type) : undefined
  const rise = (delay: number) =>
    reduce
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.3, delay } }
      : {
          initial: { opacity: 0, y: 32 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const, delay },
        }

  return (
    <AnimatePresence>
      {game && (
        <motion.div
          key={`${game.id}:${game.started_at}`}
          role="status"
          className="fixed inset-0 z-30 flex flex-col justify-center overflow-hidden bg-ground px-[5vw] py-[5vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0.3 : 0.45 }}
        >
          <div className="flex max-w-full flex-col items-start gap-10 short:gap-7">
            <motion.div
              initial={reduce ? { opacity: 0 } : { opacity: 0, rotate: 6, scale: 1.08 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              transition={reduce ? { duration: 0.3 } : { duration: 0.18, ease: [0.34, 1.4, 0.64, 1] }}
              className="flex items-center gap-5"
            >
              <Logo className="size-16 ring-0 short:size-14" />
              <Tab size="strap">Hurra presents</Tab>
            </motion.div>
            <motion.h2 {...rise(0.15)} className="max-w-full wide text-tv-cheer leading-[0.95] text-balance break-words text-paper short:text-tv-code">
              {game.title}
            </motion.h2>
            {module?.description && (
              <motion.p {...rise(0.3)} className="max-w-[60rem] text-tv-name leading-snug text-balance text-paper-2 short:text-tv-band">
                {module.description}
              </motion.p>
            )}
          </div>
          {/* Drains over the card's 3 seconds, along the bottom of the safe area. */}
          <motion.span
            aria-hidden
            className="absolute inset-x-[5vw] bottom-[5vh] h-1.5 origin-left bg-gold"
            initial={{ scaleX: 1 }}
            animate={{ scaleX: 0 }}
            transition={{ duration: TITLE_CARD_MS / 1000, ease: 'linear' }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
