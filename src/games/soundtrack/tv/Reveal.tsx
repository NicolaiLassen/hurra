import { motion, useReducedMotion } from 'motion/react'
import { Tab } from '@/components/tv/onAir'
import type { TvViewProps } from '@/games/types'
import { cn } from '@/lib/utils'
import { letterOf, photoShown, wallMoment, type SoundtrackPublicState, type SoundtrackReveal } from '../types'
import { linesOver, useStepDown } from './hooks'
import { LetterChip, Photo } from './parts'
import { NOBODY_LINE, revealCounts, storyLine, wallRevealCounts } from './words'

/** The house easing (docs/identity.md, Motion). */
const EASE_OUT = [0.22, 1, 0.36, 1] as const

/**
 * The title's and the singer's sizes, largest first: the title in wide
 * Archivo at 104 px at 1080p, the singer at 66, each with its short: and low:
 * step. The reveal steps down while the title or the singer takes a third
 * line, a word runs past the column, or the column runs past the stage.
 */
const STEPS = [
  ['text-[length:6.5rem] short:text-tv-code low:text-tv-question', 'text-tv-answer short:text-tv-score low:text-tv-name'],
  ['text-tv-code short:text-tv-question low:text-tv-answer', 'text-tv-answer short:text-tv-score low:text-tv-name'],
  ['text-tv-question short:text-tv-answer low:text-tv-score', 'text-tv-score short:text-tv-name low:text-tv-band'],
  ['text-tv-answer short:text-tv-score low:text-tv-name', 'text-tv-score short:text-tv-name low:text-tv-band'],
  ['text-tv-score short:text-tv-name low:text-tv-band', 'text-tv-name short:text-tv-band low:text-tv-field'],
  ['text-tv-name short:text-tv-band low:text-tv-field', 'text-tv-band short:text-tv-field low:text-tv-body'],
  ['text-tv-band short:text-tv-field low:text-tv-body', 'text-tv-field short:text-tv-body low:text-tv-floor'],
] as const

/** With typed moments on the wall, each part's delay in seconds, by its usual one: the tab, moment, title, singer, counts, story. */
const WALL_DELAY: Readonly<Record<number, number>> = { 0.1: 0.4, 0.15: 1, 0.2: 1.9, 0.35: 2.8, 0.5: 3.7, 0.65: 4.3 }

/** The column runs past its room, or a line marked to fit doesn't. */
const tooBig = (el: HTMLElement) => {
  const inner = el.firstElementChild as HTMLElement | null
  return (inner !== null && inner.getBoundingClientRect().height > el.clientHeight + 1) || linesOver(el)
}

/**
 * A song revealed (spec section 9): its photo with the letter and the caption
 * on a paper strap, and beside it the song's number on a paper tab, the title
 * in wide Archivo, who sings it, how many got each part (of the guests who
 * could score on it, the host's accepts included, so a figure changes in
 * place when the host accepts during the story: nothing moves, no sound),
 * and who tells the story. Key it on the song. With typed moments on, the
 * photo is the song's own (no letter, no caption) and its moment comes first
 * in the column, above the title; the TV never shows what anyone typed.
 * With typed moments on the wall, the photo with its letter comes in first,
 * then the moment, the title and the singer one after the other, and four
 * counts (the picture first), by team in a game played in teams.
 */
export default function Reveal({
  pub,
  reveal,
  mediaUrl,
  players = [],
}: {
  pub: SoundtrackPublicState
  reveal: SoundtrackReveal
  mediaUrl: TvViewProps['mediaUrl']
  /** The party's players, for their teams. */
  players?: readonly { id: string; team_id?: string | null }[]
}) {
  const reduce = useReducedMotion()
  const [ref, step] = useStepDown<HTMLDivElement>(STEPS.length - 1, tooBig)
  const [titleSize, singerSize] = STEPS[step]
  const photo = reveal.event >= 0 ? pub.wall[reveal.event] : undefined
  const typed = photoShown(pub)
  const onWall = wallMoment(pub)
  const teamOf = (id: string) => players.find((p) => p.id === id)?.team_id ?? null
  const counts = onWall ? wallRevealCounts(reveal, teamOf) : revealCounts(reveal, pub.momentTyped)
  const rise = (base: number) => {
    // On the wall the parts come one after the other, slower, while the photo sinks in.
    const delay = onWall ? (WALL_DELAY[base] ?? base) : base
    return reduce
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.3, delay } }
      : { initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4, ease: EASE_OUT, delay } }
  }

  return (
    <div className="flex min-h-0 flex-1 items-center gap-[4.5%] short:gap-[4%]">
      <motion.figure
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.45, ease: EASE_OUT }}
        className="relative aspect-[6/5] max-h-full w-[47%] shrink-0 overflow-hidden rounded-tile bg-overlay short:w-[45%] low:w-[42%]"
      >
        {photo && (
          <Photo
            path={photo.path}
            mediaUrl={mediaUrl}
            alt={typed ? `Song ${reveal.n}’s photo` : `Photo ${letterOf(reveal.event)}`}
            className="absolute inset-0 size-full"
          />
        )}
        {!typed && reveal.event >= 0 && (
          <LetterChip
            index={reveal.event}
            className="absolute top-6 left-6 size-18 text-tv-band short:top-5 short:left-5 short:size-15 short:text-tv-field low:size-13 low:text-tv-tab"
          />
        )}
        {!typed && reveal.caption && (
          <figcaption className="absolute bottom-8 left-0 line-clamp-2 max-w-[92%] bg-paper py-3 pr-7 pl-7 text-tv-band leading-[1.1] font-bold break-words text-ink short:bottom-6 short:py-2.5 short:pr-6 short:pl-6 short:text-tv-field low:bottom-4 low:py-2 low:pr-5 low:pl-5 low:text-tv-tab">
            {reveal.caption}
          </figcaption>
        )}
      </motion.figure>

      {/* The column measures its inner block, centred with auto margins, so it only ever runs past the bottom. */}
      <div ref={ref} className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <div className="my-auto flex min-w-0 flex-col items-start">
          <motion.div {...rise(0.1)} className="pl-1">
            <Tab tone="paper" size="strap">
              Song {reveal.n}
            </Tab>
          </motion.div>

          {pub.momentTyped && reveal.moment && (
            <motion.div {...rise(0.15)} className="mt-9 w-full min-w-0 short:mt-6 low:mt-4">
              <p className="on-air text-tv-floor text-paper-2">Moment</p>
              <p data-fit-lines="3" className={cn('mt-1 font-extrabold text-balance break-words text-paper', singerSize, 'leading-[1.1]')}>
                {reveal.moment}
              </p>
            </motion.div>
          )}

          <motion.div {...rise(0.2)} className="mt-9 w-full min-w-0 short:mt-6 low:mt-4">
            <p className="on-air text-tv-floor text-paper-2">Title</p>
            <h2 data-fit-lines="2" className={cn('mt-1 wide break-words text-paper', titleSize, 'leading-[1.02]')}>
              {reveal.title}
            </h2>
          </motion.div>

          <motion.div {...rise(0.35)} className="mt-8 w-full min-w-0 short:mt-5 low:mt-3">
            <p className="on-air text-tv-floor text-paper-2">Who sings it</p>
            <p data-fit-lines="2" className={cn('mt-1 font-extrabold break-words text-paper', singerSize, 'leading-[1.1]')}>
              {reveal.singer}
            </p>
          </motion.div>

          <motion.dl
            {...rise(0.5)}
            className="mt-9 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-6 gap-y-2 short:mt-6 short:gap-x-5 low:mt-4 low:gap-y-1"
          >
            {counts.length === 0 ? (
              <dd className="col-span-2 text-tv-field text-paper-2 short:text-tv-body low:text-tv-tab">{NOBODY_LINE}</dd>
            ) : (
              counts.map((count) => (
                <div key={count.part} className="contents">
                  <dt className="tv-num text-tv-score whitespace-nowrap text-paper short:text-tv-name low:text-tv-band">{count.figure}</dt>
                  <dd className="min-w-0 truncate text-tv-field text-paper-2 short:text-tv-body low:text-tv-tab">{count.words}</dd>
                </div>
              ))
            )}
          </motion.dl>

          {storyLine(pub.storyteller) !== null && (
            <motion.p
              {...rise(0.65)}
              className="mt-9 text-tv-band leading-[1.15] font-bold text-balance text-paper short:mt-6 short:text-tv-field low:mt-4 low:text-tv-tab"
            >
              {storyLine(pub.storyteller)}
            </motion.p>
          )}
        </div>
      </div>
    </div>
  )
}
