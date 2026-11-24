import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { onAirText } from '@/components/tv/news'
import { Stripes, Tab } from '@/components/tv/onAir'
import type { FeedItem } from '@/lib/types'

/** The strap's wipe from its left edge (docs/identity.md, Motion), reaching past its edges so the tilted tab keeps its corners. */
const HIDDEN = 'inset(-2rem 100% -2rem 0rem)'
const SHOWN = 'inset(-2rem 0% -2rem 0rem)'
const EASE_OUT = [0.22, 1, 0.36, 1] as const

/**
 * Big news (news.ts routes it here, with its sound): for 8 seconds a strap
 * takes the whole width of the frame's top row, over the programme strap and
 * the bug, so it never covers the stage (a quiz's answered count included) or
 * the band. The game's title on the tab, pink with the popper's stripes for
 * the hunt's news and gold for anything else on air, then the news on paper
 * with its detail after it. It wipes in from its left edge and fades out;
 * with reduced motion it only fades.
 */
export default function Banner({ item, source }: { item: FeedItem | undefined; source?: string }) {
  const reduce = useReducedMotion()
  const hunt = item?.tone === 'pink'
  return (
    <div data-frame="news" className="pointer-events-none fixed inset-x-[5vw] top-[5vh] z-40" aria-live="polite">
      <AnimatePresence>
        {item && (
          <motion.div
            key={item.id}
            initial={reduce ? { opacity: 0 } : { clipPath: HIDDEN }}
            animate={reduce ? { opacity: 1 } : { clipPath: SHOWN }}
            exit={{ opacity: 0, transition: { duration: 0.14 } }}
            transition={{ duration: reduce ? 0.2 : 0.22, ease: EASE_OUT }}
            // The ground reaches 12 px past the row both ways, so the tilted programme tab underneath never peeks out.
            className="absolute inset-x-0 -top-3 flex h-22 items-center bg-ground short:h-20"
          >
            {hunt && <Stripes size="strap" />}
            <Tab tone={hunt ? 'pink' : 'gold'} size="strap" className="max-w-[36rem] shrink-0">
              {source ?? 'News'}
            </Tab>
            <p className="-ml-1 flex h-16 min-w-0 flex-1 items-center gap-6 bg-paper px-7 text-ink short:h-14 short:gap-5 short:px-6">
              <span className="max-w-full min-w-0 shrink-0 truncate text-tv-band font-bold short:text-tv-field">{onAirText(item.message)}</span>
              {item.detail && <span className="min-w-0 truncate text-tv-body text-ink/75 short:text-tv-tab">{onAirText(item.detail)}</span>}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
