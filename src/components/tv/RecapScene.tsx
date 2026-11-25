import {
  ChatCircleDotsIcon,
  CrownIcon,
  GameControllerIcon,
  HandCoinsIcon,
  LightningIcon,
  UsersThreeIcon,
  type Icon,
} from '@phosphor-icons/react'
import { animate, AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import AnnouncementIconView from '@/components/AnnouncementIconView'
import Avatar from '@/components/Avatar'
import AvatarBadge from '@/components/AvatarBadge'
import Confetti from '@/components/Confetti'
import Logo from '@/components/Logo'
import {
  chapterHighlights,
  clockTime,
  numberTiles,
  RACE_PLAY_MS,
  raceFrames,
  recapSlides,
  shownLeadChanges,
  slideKey,
  slideMs,
  type NumberTile,
  type RecapSlide,
} from '@/components/tv/recapSlides'
import type { Highlight, Tone } from '@/games/core/Game'
import { getGameModule } from '@/games/registry'
import { announcementTone } from '@/lib/announcement'
import { GUEST_BG, guestLook } from '@/lib/guest'
import { listNames, type RecapDoc } from '@/lib/recap'
import { playSound } from '@/lib/sound'
import { cn } from '@/lib/utils'

/**
 * The recap on the TV (docs/engine-v2.md, 7.2): slides from the published
 * RecapDoc that advance every 8 seconds and loop. The night in numbers, the
 * race of the top 8, one slide per chapter, the lead changes and the final
 * podium with confetti. Reduced motion: no race animation, fades only. A new
 * version of the recap starts the show again from the top. In the frame's
 * language (docs/identity.md): solid raised cards, nothing under the TV's
 * floor, no glow, rings or gold washes, and gold only for the leader and the
 * winners.
 */
export default function RecapScene({
  doc,
  partyName,
  startAt = 0,
}: {
  doc: RecapDoc
  partyName: string
  /** The slide to open on (dev fixtures, to look at one slide). */
  startAt?: number
}) {
  const reduce = useReducedMotion()
  const slides = useMemo(() => recapSlides(doc), [doc])
  const [show, setShow] = useState(() => ({ doc, index: Math.min(Math.max(0, startAt), slides.length - 1), loop: 0 }))
  let { index, loop } = show
  if (show.doc !== doc) {
    setShow({ doc, index: 0, loop: 0 })
    index = 0
    loop = 0
  }
  const slide = slides[Math.min(index, slides.length - 1)]
  const ms = slideMs(slide)

  useEffect(() => {
    const timer = setTimeout(
      () => setShow((s) => (s.index + 1 >= slides.length ? { ...s, index: 0, loop: s.loop + 1 } : { ...s, index: s.index + 1 })),
      ms,
    )
    return () => clearTimeout(timer)
  }, [index, loop, ms, slides.length])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-8 short:gap-5">
      <header className="flex shrink-0 items-center gap-5">
        <Logo className="size-14 ring-0 short:size-12" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-tv-band font-black short:text-tv-field">{partyName}</p>
          <p className="text-tv-tab text-paper-2 short:text-tv-floor">Recap of the night</p>
        </div>
        <Progress count={slides.length} index={index} loop={loop} ms={ms} />
      </header>
      <div className="relative min-h-0 flex-1">
        <AnimatePresence mode="wait">
          <motion.section
            key={`${loop}:${slideKey(slide)}`}
            className="absolute inset-0 flex flex-col"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -16 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
          >
            <Slide slide={slide} doc={doc} partyName={partyName} />
          </motion.section>
        </AnimatePresence>
      </div>
    </div>
  )
}

function Slide({ slide, doc, partyName }: { slide: RecapSlide; doc: RecapDoc; partyName: string }) {
  switch (slide.kind) {
    case 'numbers':
      return <NumbersSlide doc={doc} partyName={partyName} />
    case 'race':
      return <RaceSlide doc={doc} />
    case 'chapter':
      return <ChapterSlide doc={doc} index={slide.index} />
    case 'leads':
      return <LeadsSlide doc={doc} />
    case 'podium':
      return <PodiumSlide doc={doc} />
  }
}

/** One segment per slide: the ones shown are full, the current one fills over its time. */
function Progress({ count, index, loop, ms }: { count: number; index: number; loop: number; ms: number }) {
  return (
    <ol aria-label={`Slide ${index + 1} of ${count}`} className="flex shrink-0 gap-2">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="h-2 w-10 overflow-hidden rounded-chip bg-rule short:w-8">
          {i < index && <span className="block h-full w-full bg-paper-3" />}
          {i === index && (
            <motion.span
              key={`${loop}:${index}`}
              className="block h-full origin-left bg-paper"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: ms / 1000, ease: 'linear' }}
            />
          )}
        </li>
      ))}
    </ol>
  )
}

const NUMBER_ICONS: Record<NumberTile['key'], Icon> = {
  guests: UsersThreeIcon,
  games: GameControllerIcon,
  answers: ChatCircleDotsIcon,
  moves: LightningIcon,
  awards: HandCoinsIcon,
}

function NumbersSlide({ doc, partyName }: { doc: RecapDoc; partyName: string }) {
  const reduce = useReducedMotion()
  return (
    <div className="m-auto flex w-full flex-col items-center gap-14 short:gap-10">
      <h2 className="max-w-6xl text-center text-7xl leading-tight font-black tracking-tight short:text-6xl">
        <span className="block truncate">{partyName}:</span>
        <span className="block text-paper-2">the night in numbers</span>
      </h2>
      <ul className="flex flex-wrap justify-center gap-6">
        {numberTiles(doc).map((tile, i) => {
          const Icon = NUMBER_ICONS[tile.key]
          return (
            <motion.li
              key={tile.key}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 30, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={reduce ? { duration: 0.4 } : { type: 'spring', stiffness: 220, damping: 20, delay: 0.15 + i * 0.12 }}
              className="flex w-72 flex-col items-center gap-3 rounded-tile bg-raised px-6 py-8 short:w-60 short:py-6"
            >
              <Icon weight="duotone" className="size-12 text-paper-2 short:size-10" />
              <CountUp value={tile.value} className="text-8xl leading-none tv-num short:text-7xl" />
              <span className="text-tv-tab text-paper-2 short:text-tv-floor">{tile.label}</span>
            </motion.li>
          )
        })}
      </ul>
    </div>
  )
}

/** Counts up to a number once (straight to it with reduced motion). */
function CountUp({ value, className }: { value: number; className?: string }) {
  const reduce = useReducedMotion()
  const count = useMotionValue(reduce ? value : 0)
  const shown = useTransform(count, (v) => Math.round(v).toLocaleString('en-US'))
  useEffect(() => {
    if (reduce) {
      count.set(value)
      return
    }
    const controls = animate(count, value, { duration: 1.4, ease: [0.22, 1, 0.36, 1], delay: 0.3 })
    return () => controls.stop()
  }, [count, value, reduce])
  return <motion.span className={className}>{shown}</motion.span>
}

/**
 * The race: bars for the top 8 grow through the night in about 10 s,
 * overtaking each other. Each bar is in its guest's own colour (identity,
 * the colour of their token), and only the leader's points are gold.
 */
function RaceSlide({ doc }: { doc: RecapDoc }) {
  const reduce = useReducedMotion()
  const frames = useMemo(() => raceFrames(doc), [doc])
  const last = frames.length - 1
  const [frame, setFrame] = useState(reduce ? last : 0)
  const max = useMemo(() => Math.max(1, ...frames.flatMap((f) => f.rows.map((r) => r.total))), [frames])

  useEffect(() => {
    if (reduce || last < 1) return
    const step = RACE_PLAY_MS / last
    const started = performance.now()
    const timer = setInterval(() => {
      const next = Math.min(last, Math.floor((performance.now() - started) / step))
      setFrame(next)
      if (next === last) clearInterval(timer)
    }, Math.max(50, step))
    return () => clearInterval(timer)
  }, [last, reduce])

  const current = frames[Math.min(reduce ? last : frame, last)]
  if (!current) return null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-8 short:gap-5">
      <div className="flex shrink-0 items-end justify-between gap-8">
        <div>
          <Eyebrow>Points through the night, top {current.rows.length}</Eyebrow>
          <h2 className="mt-2 text-7xl font-black tracking-tight short:text-6xl">The race</h2>
        </div>
        <p className="text-7xl text-paper-3 tv-num short:text-6xl">{clockTime(current.at)}</p>
      </div>
      <ol className="grid min-h-0 flex-1 content-center gap-3 short:gap-2">
        {current.rows.map((row, i) => (
          <motion.li
            key={row.playerId}
            layout={!reduce}
            transition={{ type: 'spring', stiffness: 300, damping: 32 }}
            className="flex h-16 items-center gap-5 short:h-12 short:gap-4"
          >
            <span className="w-12 text-right tv-num text-tv-band text-paper-3 short:w-10 short:text-tv-field">{i + 1}</span>
            <Avatar name={row.name} playerId={row.playerId} className="size-12 short:size-10" />
            <span className="w-64 truncate tv-num text-tv-band short:w-52 short:text-tv-field">{row.name}</span>
            <div className="h-10 min-w-0 flex-1 short:h-8">
              <motion.div
                className={cn('h-full rounded-chip', GUEST_BG[guestLook(row.name).color])}
                initial={false}
                animate={{ width: `${(Math.max(0, row.total) / max) * 100}%` }}
                transition={{ duration: reduce ? 0 : 0.25, ease: 'linear' }}
              />
            </div>
            <span className={cn('w-24 text-right tv-num text-tv-name short:text-tv-band', i === 0 ? 'text-gold' : 'text-paper')}>{row.total}</span>
          </motion.li>
        ))}
      </ol>
    </div>
  )
}

function ChapterSlide({ doc, index }: { doc: RecapDoc; index: number }) {
  const reduce = useReducedMotion()
  const chapter = doc.chapters[index]
  if (!chapter) return null
  const Icon = getGameModule(chapter.gameType)?.icon ?? GameControllerIcon
  const highlights = chapterHighlights(chapter)
  const when =
    chapter.finishedAt === null ? `Since ${clockTime(chapter.startedAt)}` : `${clockTime(chapter.startedAt)} to ${clockTime(chapter.finishedAt)}`
  const names = chapter.winners.map((w) => w.name)

  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-10 short:gap-7">
      <header>
        <p className="flex items-center gap-3 text-tv-tab font-semibold tracking-widest text-paper-2 uppercase short:text-tv-floor">
          <Icon weight="duotone" className="size-8 text-paper-2 short:size-7" />
          {when}
          {chapter.round > 1 && <span>· Round {chapter.round}</span>}
        </p>
        <h2 className="mt-3 text-8xl leading-none font-black tracking-tight short:text-7xl">{chapter.title}</h2>
      </header>

      {names.length > 0 && (
        <div className="flex min-w-0 items-center gap-8">
          <div className="flex shrink-0 gap-4 short:gap-3">
            {chapter.winners.slice(0, 4).map((w) => (
              <div key={w.id} className="relative">
                <Avatar name={w.name} playerId={w.id} className="size-28 short:size-20" />
                <AvatarBadge icon={CrownIcon} tone="gold" size="lg" />
              </div>
            ))}
          </div>
          <p className="min-w-0 text-6xl font-black text-balance short:text-5xl">
            {listNames(names)} <span className="text-4xl font-semibold text-paper-2 short:text-3xl">won</span>
          </p>
        </div>
      )}

      {highlights.length > 0 && (
        <ul className="grid grid-cols-3 gap-6 short:gap-4">
          {highlights.map((highlight, i) => (
            <motion.li
              key={`${highlight.title}:${i}`}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reduce ? { duration: 0.4 } : { type: 'spring', stiffness: 220, damping: 22, delay: 0.3 + i * 0.15 }}
            >
              <HighlightCard highlight={highlight} />
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** A highlight's icon chip by its job, as on a callout: gold for a win, pink for the hunt, paper for the rest (guest colours are identity only). */
const HIGHLIGHT_CHIP: Record<Tone, string> = {
  gold: 'bg-gold text-ink',
  pink: 'bg-pink text-ink',
  red: 'bg-pink text-ink',
  teal: 'bg-paper text-ink',
  violet: 'bg-paper text-ink',
}

function HighlightCard({ highlight }: { highlight: Highlight }) {
  return (
    <div className="flex h-full items-start gap-5 rounded-tile bg-raised p-6 short:gap-4 short:p-5">
      <span
        className={cn(
          'grid size-14 shrink-0 place-items-center rounded-chip [&_svg]:size-7 short:size-12',
          // No tone is no job: paper, since gold is a win's.
          highlight.tone ? HIGHLIGHT_CHIP[announcementTone(highlight.tone)] : 'bg-paper text-ink',
        )}
      >
        <AnnouncementIconView name={highlight.icon ?? 'star'} />
      </span>
      <div className="min-w-0">
        <p className="text-tv-field leading-tight font-bold text-balance short:text-tv-tab">{highlight.title}</p>
        {highlight.detail && <p className="mt-2 text-tv-tab text-paper-2 short:text-tv-floor">{highlight.detail}</p>}
      </div>
    </div>
  )
}

function LeadsSlide({ doc }: { doc: RecapDoc }) {
  const reduce = useReducedMotion()
  const leads = shownLeadChanges(doc)
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-10 short:gap-6">
      <div>
        <Eyebrow>Who led, and when</Eyebrow>
        <h2 className="mt-2 text-7xl font-black tracking-tight short:text-6xl">Lead changes</h2>
      </div>
      <ol className="grid gap-5 border-l-4 border-rule pl-10 short:gap-3 short:pl-8">
        {leads.map((lead, i) => (
          <motion.li
            key={`${lead.at}:${lead.playerId}`}
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={reduce ? { duration: 0.4 } : { type: 'spring', stiffness: 220, damping: 24, delay: 0.2 + i * 0.25 }}
            className="relative flex min-w-0 items-center gap-6 short:gap-4"
          >
            <span aria-hidden className="absolute top-1/2 -left-[3.15rem] size-5 -translate-y-1/2 rounded-chip bg-paper short:-left-[2.65rem] short:size-4" />
            <span className="w-32 shrink-0 tv-num text-tv-name text-paper-3 short:w-28 short:text-tv-band">{clockTime(lead.at)}</span>
            <Avatar name={lead.name} playerId={lead.playerId} className="size-14 short:size-11" />
            <span className="min-w-0 truncate text-5xl font-bold short:text-4xl">{lead.name}</span>
            <span className="shrink-0 text-tv-body text-paper-2 short:text-tv-tab">took the lead</span>
          </motion.li>
        ))}
      </ol>
    </div>
  )
}

// Left to right: 2nd, 1st, 3rd.
const PODIUM_SLOTS = [1, 0, 2]
/** The steps by place (ties share a step), told apart by height, at 1080p and then short:. */
const PODIUM_STEPS = ['h-64 short:h-48', 'h-48 short:h-36', 'h-36 short:h-28']

/** The recaps whose podium has cheered on this TV: a fanfare once per version, not on every loop. */
const cheered = new Set<number>()

/**
 * The night's winners, like a game's winner screen: the cheer in wide paper,
 * untilted, and the top three on paper steps of clearly different heights,
 * their tokens above, the name and points in ink, the place in wide; the
 * winners' points on gold and their crown. The logo's confetti bursts once.
 */
function PodiumSlide({ doc }: { doc: RecapDoc }) {
  const reduce = useReducedMotion()
  const rank = new Map(doc.standings.map((r) => [r.playerId, r.rank]))
  const top = doc.podium.slice(0, 3)
  const winners = top.filter((row) => row.points === top[0]?.points).map((row) => row.name)

  useEffect(() => {
    if (cheered.has(doc.generatedAt)) return
    cheered.add(doc.generatedAt)
    void playSound('fanfare')
  }, [doc.generatedAt])

  return (
    <div className="relative isolate flex min-h-0 flex-1 flex-col items-center justify-center gap-10 short:gap-6">
      <Confetti pieces={60} />
      <div className="max-w-full text-center">
        <Eyebrow>The final podium</Eyebrow>
        <motion.h2
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="mt-3 wide text-tv-question text-balance text-paper short:text-tv-answer"
        >
          Hurra for {listNames(winners)}
        </motion.h2>
      </div>
      <ol className="flex max-w-full items-end justify-center gap-6 short:gap-5" aria-label="The night's top three">
        {PODIUM_SLOTS.filter((slot) => slot < top.length).map((slot) => {
          const row = top[slot]
          const place = rank.get(row.playerId) ?? slot + 1
          const wins = place === 1
          return (
            <motion.li
              key={row.playerId}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: reduce ? 0 : 0.4 + (2 - slot) * 0.2 }}
              className="flex w-[25rem] min-w-0 flex-col items-start short:w-[20rem]"
            >
              <span className="relative">
                <Avatar name={row.name} playerId={row.playerId} className="size-24 short:size-18" />
                {wins && <AvatarBadge icon={CrownIcon} tone="gold" size="lg" />}
              </span>
              <div
                className={cn(
                  'mt-3 flex w-full min-w-0 items-start justify-between gap-4 bg-paper pt-4 pr-5 pl-6 text-ink short:mt-2 short:pt-3 short:pl-5',
                  PODIUM_STEPS[Math.min(place, 3) - 1],
                )}
              >
                <div className="min-w-0">
                  <p className="truncate tv-num text-tv-name short:text-tv-band">{row.name}</p>
                  <p className="mt-1 flex items-baseline gap-2">
                    <span className={cn('tv-num text-tv-name short:text-tv-band', wins && 'rounded-chip bg-gold px-2.5')}>{row.points}</span>
                    <span className="text-tv-floor font-semibold">{row.points === 1 ? 'point' : 'points'}</span>
                  </p>
                </div>
                <span className="shrink-0 wide text-tv-code leading-[0.9] short:text-tv-answer">{place}</span>
              </div>
            </motion.li>
          )
        })}
      </ol>
    </div>
  )
}

/** A small label over a slide's title, at the TV's floor at least. */
function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-tv-floor font-semibold tracking-widest text-paper-2 uppercase">{children}</p>
}
