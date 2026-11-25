import { motion, useReducedMotion } from 'motion/react'
import Avatar from '@/components/Avatar'
import type { TvViewProps } from '@/games/types'
import type { Player } from '@/lib/types'
import { cn } from '@/lib/utils'
import type { SoundtrackPublicState } from '../types'
import { Photo } from './parts'
import { topHeading } from './words'

/** The house easing (docs/identity.md, Motion). */
const EASE_OUT = [0.22, 1, 0.36, 1] as const

/**
 * Lydspor's top 5 after every few reveals, in the standings' style (spec
 * section 9): solid raised rows, the leader's rank and points gold and
 * everyone else's paper, the points since the last top 5 on an overlay chip.
 * After the last reveal the points count each own average, as the crown
 * will, with "+3 own photo" on its own chip; and "These had no song" beside
 * it: the photos that fit no song, with their captions.
 */
export default function TopFive({ pub, players, mediaUrl }: { pub: SoundtrackPublicState; players: Player[]; mediaUrl: TvViewProps['mediaUrl'] }) {
  const reduce = useReducedMotion()
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? 'A guest'
  const extras = pub.extras && pub.extras.length > 0 ? pub.extras : null
  // At the first top 5 every gain is the whole score: the chips would only repeat it.
  const gains = pub.top.some((row) => row.gained !== row.points - row.credit)

  return (
    <div className="flex min-h-0 flex-1 gap-[4.5%] short:gap-[4%]">
      <div className="flex min-w-0 flex-1 flex-col">
        <h2 className="shrink-0 wide text-tv-band text-paper short:text-tv-field low:text-tv-tab">{topHeading(pub.revealed, pub.playedAt.length)}</h2>
        {pub.top.length === 0 ? (
          <p className="my-auto text-tv-name text-paper-2 short:text-tv-band low:text-tv-field">No points yet. The next songs can change that.</p>
        ) : (
          <ol className="mt-8 grid shrink-0 gap-3 short:mt-6 short:gap-2.5 low:mt-4 low:gap-2">
            {pub.top.map((row, i) => {
              const leads = row.rank === 1
              return (
                <motion.li
                  key={row.playerId}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease: EASE_OUT, delay: reduce ? 0 : 0.15 + (pub.top.length - 1 - i) * 0.12 }}
                  className="flex h-24 min-w-0 items-center gap-8 rounded-tile bg-raised pr-10 pl-8 short:h-20 short:gap-6 short:pr-8 short:pl-6 low:h-15 low:gap-5 low:pl-5"
                >
                  <span
                    className={cn(
                      'w-[2ch] shrink-0 text-right tv-num text-tv-score short:text-tv-name low:text-tv-field',
                      leads ? 'text-gold' : 'text-paper-3',
                    )}
                  >
                    {row.rank}
                  </span>
                  <Avatar name={nameOf(row.playerId)} playerId={row.playerId} className="size-16 short:size-14 low:size-11" />
                  <span className="min-w-0 flex-1 truncate text-tv-name font-bold text-paper short:text-tv-band low:text-tv-field">
                    {nameOf(row.playerId)}
                  </span>
                  {gains && row.gained > 0 && (
                    <span className="shrink-0 rounded-chip bg-overlay px-3.5 py-1 tv-num text-tv-field text-paper-2 short:text-tv-tab low:px-2.5 low:py-0.5 low:text-tv-floor">
                      +{row.gained}
                    </span>
                  )}
                  {/* After the last reveal: the own average for a photo they are in, counted as the crown will. */}
                  {row.credit > 0 && (
                    <span className="shrink-0 rounded-chip bg-overlay px-3.5 py-1 text-tv-field font-bold whitespace-nowrap text-paper-2 short:text-tv-tab low:px-2.5 low:py-0.5 low:text-tv-floor">
                      <span className="tv-num">+{row.credit}</span> own photo
                    </span>
                  )}
                  <span
                    className={cn(
                      'w-[3ch] shrink-0 text-right tv-num text-tv-score short:text-tv-name low:text-tv-field',
                      leads ? 'text-gold' : 'text-paper',
                    )}
                  >
                    {row.points}
                  </span>
                </motion.li>
              )
            })}
          </ol>
        )}
      </div>

      {extras && (
        <motion.aside
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: reduce ? 0 : 0.9 }}
          aria-label="These had no song"
          className="flex w-[38%] min-w-0 shrink-0 flex-col"
        >
          <h3 className="shrink-0 text-tv-field font-bold text-paper-2 short:text-tv-body low:text-tv-tab">These had no song</h3>
          <ul className="mt-6 grid min-h-0 grid-cols-2 content-start gap-4 short:mt-4 short:gap-3 low:mt-3 low:gap-2.5">
            {extras.map((photo, i) => (
              <li key={i} className="relative aspect-[6/5] min-h-0 overflow-hidden rounded-tile bg-overlay">
                <Photo path={photo.path} mediaUrl={mediaUrl} alt={photo.caption} className="absolute inset-0 size-full" />
                <span className="absolute bottom-3 left-0 line-clamp-2 max-w-[94%] bg-paper py-1 pr-3.5 pl-3.5 text-tv-floor leading-[1.12] font-bold break-words text-ink low:bottom-2 low:pr-2.5 low:pl-2.5">
                  {photo.caption}
                </span>
              </li>
            ))}
          </ul>
        </motion.aside>
      )}
    </div>
  )
}
