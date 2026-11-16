import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import AnnouncementIconView from '@/components/AnnouncementIconView'
import Callout from '@/components/Callout'
import { spring } from '@/components/tv/look'
import { BANNER_MS } from '@/components/tv/news'
import { announcementTone } from '@/lib/announcement'
import { CALLOUT_TONE } from '@/lib/callout'
import type { FeedItem } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * An announcement slides in at the bottom for 8 seconds: the shared callout at
 * TV size, with its game's title above it and a bar along the bottom that
 * drains while it shows. A winner the whole room should hear (`interrupt`)
 * gets a soft gold glow. Its sound is played by whoever chose it (useNews).
 */
export default function Banner({ item, eyebrow }: { item: FeedItem | undefined; eyebrow?: string }) {
  const reduceMotion = useReducedMotion()
  const tone = announcementTone(item?.tone)

  // Above the corner gutter, centred, as wide as the text needs up to 4xl (5xl on big screens).
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center px-8">
      {/* popLayout: a banner on its way out leaves the row and fades where it is
          (pinned by its bottom edge), so the next one rises in the centre. */}
      <AnimatePresence mode="popLayout" anchorY="bottom">
        {item && (
          <motion.div
            key={item.id}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 64 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 32 }}
            transition={reduceMotion ? { duration: 0.2 } : spring}
            className={cn('max-w-4xl rounded-3xl 2xl:max-w-5xl', item.interrupt && 'shadow-[0_0_64px_color-mix(in_oklab,var(--color-gold)_35%,transparent)]')}
          >
            <Callout
              size="tv"
              tone={tone}
              icon={<AnnouncementIconView name={item.icon} />}
              eyebrow={eyebrow}
              title={item.message}
              detail={item.detail}
            >
              {!reduceMotion && (
                <motion.span
                  aria-hidden
                  className={cn('absolute inset-x-0 bottom-0 h-1 origin-left', CALLOUT_TONE[tone].bar)}
                  initial={{ scaleX: 1 }}
                  animate={{ scaleX: 0 }}
                  transition={{ duration: BANNER_MS / 1000, ease: 'linear' }}
                />
              )}
            </Callout>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
