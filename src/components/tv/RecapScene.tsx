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
import { useEffect, useMemo, useState } from 'react'
import AnnouncementIconView from '@/components/AnnouncementIconView'
import Avatar from '@/components/Avatar'
import Logo from '@/components/Logo'
import { CARD } from '@/components/tv/look'
import { Eyebrow } from '@/components/tv/parts'
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
import type { Highlight } from '@/games/core/Game'
import { getGameModule } from '@/games/registry'
import { announcementTone } from '@/lib/announcement'
import { CALLOUT_TONE } from '@/lib/callout'
import { listNames, type RecapDoc } from '@/lib/recap'
import { playSound } from '@/lib/sound'
import { cn } from '@/lib/utils'

/**
 * The recap on the TV (docs/engine-v2.md, 7.2): slides from the published
 * RecapDoc that advance every 8 seconds and loop. The night in numbers, the
 * race of the top 8, one slide per chapter, the lead changes and the final
 * podium with confetti. Reduced motion: no race animation, fades only. A new
 * version of the recap starts the show again from the top.
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
        <Logo className="size-14 short:size-12" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-3xl font-black tracking-tight short:text-2xl">{partyName}</p>
          <p className="text-xl text-muted-foreground short:text-lg">Recap of the night</p>
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
        <li key={i} className="h-2 w-10 overflow-hidden rounded-full bg-white/15 short:w-8">
          {i < index && <span className="block h-full w-full bg-primary/70" />}
          {i === index && (
            <motion.span
              key={`${loop}:${index}`}
              className="block h-full origin-left bg-primary"
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
        <span className="block text-primary">the night in numbers</span>
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
              className={cn(CARD, 'flex w-72 flex-col items-center gap-3 px-6 py-8 short:w-60 short:py-6')}
            >
              <Icon weight="duotone" className="size-12 text-primary short:size-10" />
              <CountUp value={tile.value} className="text-8xl leading-none font-black tabular-nums short:text-7xl" />
              <span className="text-2xl text-muted-foreground short:text-xl">{tile.label}</span>
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

const RACE_COLORS = ['bg-primary', 'bg-confetti-pink', 'bg-confetti-teal', 'bg-confetti-violet']

/** The race: bars for the top 8 grow through the night in about 10 s, overtaking each other. */
function RaceSlide({ doc }: { doc: RecapDoc }) {
  const reduce = useReducedMotion()
  const frames = useMemo(() => raceFrames(doc), [doc])
  const last = frames.length - 1
  const [frame, setFrame] = useState(reduce ? last : 0)
  const max = useMemo(() => Math.max(1, ...frames.flatMap((f) => f.rows.map((r) => r.total))), [frames])
  // Colours by final place, so a bar keeps its colour while it overtakes.
  const colour = useMemo(() => new Map(frames[last]?.rows.map((r, i) => [r.playerId, RACE_COLORS[i % RACE_COLORS.length]])), [frames, last])

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
        <p className="text-7xl font-black text-muted-foreground/50 tabular-nums short:text-6xl">{clockTime(current.at)}</p>
      </div>
      <ol className="grid min-h-0 flex-1 content-center gap-3 short:gap-2">
        {current.rows.map((row, i) => (
          <motion.li
            key={row.playerId}
            layout={!reduce}
            transition={{ type: 'spring', stiffness: 300, damping: 32 }}
            className="flex h-16 items-center gap-5 short:h-12 short:gap-4"
          >
            <span className="w-10 text-right text-3xl font-black text-muted-foreground tabular-nums short:text-2xl">{i + 1}</span>
            <Avatar name={row.name} className="size-12 text-lg short:size-10 short:text-base" />
            <span className="w-60 truncate text-3xl font-bold short:w-48 short:text-2xl">{row.name}</span>
            <div className="h-10 min-w-0 flex-1 short:h-8">
              <motion.div
                className={cn('h-full rounded-full', colour.get(row.playerId) ?? 'bg-primary')}
                initial={false}
                animate={{ width: `${(Math.max(0, row.total) / max) * 100}%` }}
                transition={{ duration: reduce ? 0 : 0.25, ease: 'linear' }}
              />
            </div>
            <span className="w-24 text-right text-4xl font-black text-primary tabular-nums short:text-3xl">{row.total}</span>
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
        <p className="flex items-center gap-3 text-2xl font-semibold tracking-widest text-muted-foreground uppercase short:text-xl">
          <Icon weight="duotone" className="size-8 text-primary short:size-7" />
          {when}
          {chapter.round > 1 && <span>· Round {chapter.round}</span>}
        </p>
        <h2 className="mt-3 text-8xl leading-none font-black tracking-tight short:text-7xl">{chapter.title}</h2>
      </header>

      {names.length > 0 && (
        <div className="flex min-w-0 items-center gap-8">
          <div className="flex shrink-0 -space-x-5 pt-9 short:pt-7">
            {chapter.winners.slice(0, 4).map((w) => (
              <div key={w.id} className="relative">
                <Avatar name={w.name} className="size-28 text-4xl ring-4 ring-background short:size-20 short:text-3xl" />
                <CrownIcon
                  weight="fill"
                  className="absolute -top-9 left-1/2 size-12 -translate-x-1/2 text-primary drop-shadow-[0_0_18px_rgb(245_197_66/0.6)] short:-top-7 short:size-9"
                />
              </div>
            ))}
          </div>
          <p className="min-w-0 text-6xl font-black text-balance short:text-5xl">
            {listNames(names)} <span className="text-4xl font-semibold text-muted-foreground short:text-3xl">won</span>
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

function HighlightCard({ highlight }: { highlight: Highlight }) {
  const tone = CALLOUT_TONE[announcementTone(highlight.tone)]
  return (
    <div className={cn(CARD, 'flex h-full items-start gap-5 p-6 short:gap-4 short:p-5')}>
      <span className={cn('grid size-14 shrink-0 place-items-center rounded-full [&_svg]:size-7 short:size-12', tone.icon)}>
        <AnnouncementIconView name={highlight.icon ?? 'star'} />
      </span>
      <div className="min-w-0">
        <p className="text-3xl leading-tight font-bold text-balance short:text-2xl">{highlight.title}</p>
        {highlight.detail && <p className="mt-2 text-2xl text-muted-foreground short:text-xl">{highlight.detail}</p>}
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
      <ol className="grid gap-5 border-l-4 border-primary/30 pl-10 short:gap-3 short:pl-8">
        {leads.map((lead, i) => (
          <motion.li
            key={`${lead.at}:${lead.playerId}`}
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={reduce ? { duration: 0.4 } : { type: 'spring', stiffness: 220, damping: 24, delay: 0.2 + i * 0.25 }}
            className="relative flex min-w-0 items-center gap-6 short:gap-4"
          >
            <span aria-hidden className="absolute top-1/2 -left-[3.2rem] size-6 -translate-y-1/2 rounded-full bg-primary ring-4 ring-background short:-left-[2.7rem] short:size-5" />
            <span className="w-32 shrink-0 text-4xl font-black text-muted-foreground tabular-nums short:w-28 short:text-3xl">{clockTime(lead.at)}</span>
            <Avatar name={lead.name} className="size-14 text-xl short:size-11 short:text-base" />
            <span className="min-w-0 truncate text-5xl font-bold short:text-4xl">{lead.name}</span>
            <span className="shrink-0 text-3xl text-muted-foreground short:text-2xl">took the lead</span>
          </motion.li>
        ))}
      </ol>
    </div>
  )
}

// Left to right: 2nd, 1st, 3rd.
const PODIUM_SLOTS = [1, 0, 2]
const PODIUM_STEPS = [
  { avatar: 'size-36 text-5xl ring-[6px] ring-primary short:size-28 short:text-4xl', pedestal: 'h-56 from-primary/45 short:h-36', points: 'text-primary' },
  { avatar: 'size-28 text-4xl ring-4 ring-slate-300/80 short:size-20 short:text-3xl', pedestal: 'h-40 from-slate-300/25 short:h-24', points: 'text-slate-200' },
  { avatar: 'size-28 text-4xl ring-4 ring-amber-600/80 short:size-20 short:text-3xl', pedestal: 'h-28 from-amber-600/30 short:h-16', points: 'text-amber-500' },
]

/** The recaps whose podium has cheered on this TV: a fanfare once per version, not on every loop. */
const cheered = new Set<number>()

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
    <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-8 overflow-hidden short:gap-5">
      {!reduce && <Confetti />}
      <div className="text-center">
        <Eyebrow>The final podium</Eyebrow>
        <motion.h2
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6, rotate: -4 }}
          animate={{ opacity: 1, scale: 1, rotate: -2 }}
          transition={reduce ? { duration: 0.4 } : { type: 'spring', stiffness: 280, damping: 14 }}
          className="mt-3 text-8xl font-black tracking-tight text-balance text-primary drop-shadow-[0_0_40px_rgb(245_197_66/0.4)] short:text-7xl"
        >
          Hurra for {listNames(winners)}!
        </motion.h2>
      </div>
      <div className="flex items-end justify-center gap-8 short:gap-6">
        {PODIUM_SLOTS.filter((slot) => slot < top.length).map((slot) => {
          const row = top[slot]
          const place = rank.get(row.playerId) ?? slot + 1
          const step = PODIUM_STEPS[Math.min(place, 3) - 1]
          return (
            <motion.div
              key={row.playerId}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 60 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reduce ? { duration: 0.4 } : { type: 'spring', stiffness: 220, damping: 22, delay: 0.4 + (2 - slot) * 0.3 }}
              className="flex w-72 flex-col items-center short:w-60"
            >
              {place === 1 && (
                <CrownIcon weight="fill" className="mb-2 size-14 text-primary drop-shadow-[0_0_20px_rgb(245_197_66/0.6)] short:size-10" />
              )}
              <Avatar name={row.name} className={step.avatar} />
              <p className="mt-3 w-full truncate text-center text-3xl font-bold short:mt-2 short:text-2xl">{row.name}</p>
              <p className={cn('text-4xl font-black tabular-nums short:text-3xl', step.points)}>{row.points}</p>
              <div className={cn('mt-3 grid w-full place-items-center rounded-t-3xl bg-linear-to-b to-transparent', step.pedestal)}>
                <span className={cn('text-6xl font-black opacity-70 short:text-4xl', step.points)}>{place}</span>
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

// A fixed scatter (not random), so pieces keep their places on every render.
const CONFETTI = Array.from({ length: 48 }, (_, i) => ({
  left: (i * 29 + 7) % 100,
  delay: (i % 12) * 0.15,
  duration: 3.2 + ((i * 7) % 10) / 4,
  drift: ((i * 13) % 17) - 8,
  turn: 360 + ((i * 47) % 360),
  className: cn(
    ['bg-primary', 'bg-confetti-pink', 'bg-confetti-teal', 'bg-confetti-violet'][i % 4],
    ['size-3 rounded-full', 'h-5 w-2 rounded-sm', 'h-2 w-5 rounded-sm'][i % 3],
  ),
}))

function Confetti() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {CONFETTI.map((piece, i) => (
        <motion.span
          key={i}
          className={cn('absolute top-0', piece.className)}
          style={{ left: `${piece.left}%` }}
          initial={{ y: '-10vh', x: 0, rotate: 0, opacity: 0 }}
          animate={{ y: '110vh', x: `${piece.drift}vw`, rotate: piece.turn, opacity: [0, 1, 1, 0.7] }}
          transition={{ duration: piece.duration, delay: piece.delay, ease: 'easeIn', repeat: 1, repeatDelay: 0.3 }}
        />
      ))}
    </div>
  )
}
