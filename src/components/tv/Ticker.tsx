import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import AnnouncementIconView from '@/components/AnnouncementIconView'
import { RAIL } from '@/components/tv/look'
import { announcementTone } from '@/lib/announcement'
import type { FeedItem } from '@/lib/types'
import { cn } from '@/lib/utils'

const TONE_TEXT = {
  gold: 'text-primary',
  pink: 'text-confetti-pink',
  teal: 'text-confetti-teal',
  violet: 'text-confetti-violet',
  red: 'text-destructive',
}

/**
 * The quiet one-line ticker under the rail: news from a game running in the
 * background while another holds the stage, without sound (docs/engine-v2.md,
 * 7.2). It sits in the bottom gutter, below the rail's column, so it never
 * takes room from the cards.
 */
export default function Ticker({ item, source }: { item: FeedItem | undefined; source?: string }) {
  const reduce = useReducedMotion()
  return (
    <div className={cn('pointer-events-none absolute right-10 bottom-3 short:right-8', RAIL)} aria-live="polite">
      <AnimatePresence mode="popLayout">
        {item && (
          <motion.p
            key={item.id}
            data-fit="ticker"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            className="flex h-11 min-w-0 items-center gap-2.5 rounded-full bg-card/80 px-4 text-lg ring-1 ring-foreground/10 backdrop-blur short:h-10 short:text-base"
          >
            <AnnouncementIconView name={item.icon} className={cn('size-5 shrink-0', TONE_TEXT[announcementTone(item.tone)])} />
            <span className="min-w-0 truncate">
              <span className="font-semibold">{item.message}</span>
              {source && <span className="text-muted-foreground"> · {source}</span>}
            </span>
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}
