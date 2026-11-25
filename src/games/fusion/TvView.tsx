import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import Avatar from '@/components/Avatar'
import { SOUNDS } from '@/games/core/sounds'
import type { FusionGame } from '@/games/fusion/logic'
import { LabelChip } from '@/games/fusion/parts'
import {
  lockedTotal,
  readPublic,
  scoringLine,
  showingIndex,
  type FusionCurrent,
  type FusionPublicPicture,
  type FusionPublicState,
  type FusionReveal,
} from '@/games/fusion/shapes'
import { EASE_OUT, firstName, FRESH_MS, momentId, nameOf } from '@/games/fusion/tvLook'
import { Countdown, Leaders, PictureImage, Pips } from '@/games/fusion/tvParts'
import { usePictures, type PictureCache } from '@/games/fusion/usePictures'
import { TILE_CHIP_SIZE, TILE_NAME_SIZE, tileChipFace, wallImageSize, wallLayout, type WallLayout } from '@/games/fusion/wall'
import type { TvViewProps } from '@/games/types'
import { useMomentSound, useMomentSoundAt, useServerTime } from '@/lib/gameClock'
import type { Player, SessionGame } from '@/lib/types'
import { useElementSize } from '@/lib/useElementSize'
import { cn } from '@/lib/utils'

/**
 * The picture moves between its wall tile and the frame (motion's shared
 * layout). Off, or with reduced motion, it crossfades in 300 ms instead: the
 * switch spec risk 1 asks for, should the move stutter on the TV laptop.
 */
const SHARED_LAYOUT = true
/** One picture of the showing crossfades into the next over this long. */
const CROSSFADE_S = 0.6
/** The picture's move between a tile and the frame. */
const MORPH_S = 0.5
/** The tick-tock's length: it starts this long before time runs out, so its bell lands on zero. */
const TICKTOCK_MS = SOUNDS.ticktock.seconds * 1000

type Box = { width: number; height: number }
type View = 'lobby' | 'wall' | 'frame'
type MediaUrl = TvViewProps['mediaUrl']

/** The label chip beside the frame: a letter chip at the question's size. */
const COLUMN_CHIP = 'self-start text-tv-question short:text-tv-answer low:text-tv-name'
/** The frame's big words: "Look closely.", "Who is in it?". */
const COLUMN_HEAD = 'font-extrabold tracking-[-0.01em] leading-[1.08] text-paper text-tv-question short:text-tv-answer low:text-tv-name'
/** The line under them. */
const COLUMN_LINE = 'text-tv-body text-paper-2 short:text-tv-tab low:text-tv-floor'

/**
 * Participant fusion on the TV stage (docs/identity.md, Participant fusion on
 * the TV): the lobby; the showing, each picture large in the frame and
 * crossfading into the next; the wall, every picture at once; a picture asked,
 * in the frame with "Who is in it?", the countdown and the lock-in pips; its
 * reveal, the two people as hero tokens and how many got both. The strap above
 * says where the round is ("Showing 3 of 12", "Picture 4 of 12"), so the stage
 * never repeats it. It draws every moment itself, so its announcements only
 * sound here.
 */
export default function TvView({ game, players, publicState, tallies, serverNow, mediaUrl }: TvViewProps<FusionGame>) {
  const pub = readPublic(publicState)
  const cache = usePictures(pub, mediaUrl, serverNow)
  const [ref, box] = useElementSize<HTMLDivElement>()
  const reduce = useReducedMotion() ?? false
  const morph = SHARED_LAYOUT && !reduce

  // The picture on show in the showing, by the database clock, so the TV and every phone agree to the frame.
  const now = useServerTime(serverNow, 200, pub?.phase === 'showing')
  const index = pub ? showingIndex(pub, now) : null
  // The picture in the frame last: back on the wall, its tile takes it back.
  const inFrame =
    pub?.phase === 'showing' && index !== null ? (pub.pictures[index]?.n ?? null) : pub?.phase === 'asking' || pub?.phase === 'reveal' ? (pub.current?.n ?? null) : null
  const [framed, setFramed] = useState<number | null>(null)
  if (inFrame !== null && inFrame !== framed) setFramed(inFrame)

  // Which view is up, and the one before it: a picture asked from the wall grows out of its tile; from anywhere else it fades in.
  const view: View = !pub || pub.phase === 'lobby' ? 'lobby' : pub.phase === 'wall' || pub.phase === 'done' ? 'wall' : 'frame'
  const [views, setViews] = useState<{ now: View; before: View | null }>({ now: view, before: null })
  if (views.now !== view) setViews({ now: view, before: views.now })

  if (!pub) return <p className="m-auto text-tv-name text-paper-2 short:text-tv-band low:text-tv-field">Getting the pictures ready</p>

  return (
    <div ref={ref} data-fusion-phase={pub.phase} className="relative min-h-0 flex-1">
      {box.width > 0 && box.height > 0 && (
        <LayoutGroup id={`fusion-${game.id}`}>
          {/*
            The view that goes fades out over the one that comes, which brings its own parts in; the picture moves between them.
            No initial={false} here: motion would hand it to every part mounted later inside the first view, so a TV opened
            mid-showing would cut each picture and a reveal would land all at once. The wrapper has no entrance of its own.
          */}
          <AnimatePresence>
            <motion.div key={view} className="absolute inset-0" exit={{ opacity: 0 }} transition={{ duration: 0.25, ease: EASE_OUT }}>
              {view === 'lobby' ? (
                <Lobby pub={pub} cache={cache} />
              ) : view === 'wall' ? (
                <Wall pub={pub} players={players} box={box} cache={cache} mediaUrl={mediaUrl} morph={morph} returning={framed} />
              ) : (
                <FramePhase
                  game={game}
                  pub={pub}
                  index={index ?? 0}
                  players={players}
                  locked={pub.current ? (tallies[pub.current.key] ?? 0) : 0}
                  box={box}
                  cache={cache}
                  serverNow={serverNow}
                  mediaUrl={mediaUrl}
                  morph={morph}
                  fromWall={views.before === 'wall'}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </LayoutGroup>
      )}
    </div>
  )
}

/** Before the showing: what the game is and how it scores, in words only, and the pictures loading at the foot. */
function Lobby({ pub, cache }: { pub: FusionPublicState; cache: PictureCache }) {
  const total = pub.pictures.length
  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="my-auto flex max-w-[90rem] flex-col items-start gap-10 short:gap-7 low:gap-5">
        <h2 className="wide text-tv-code text-balance text-paper short:text-tv-question low:text-tv-answer">Two guests, one face</h2>
        <p className="text-tv-name font-semibold text-paper short:text-tv-band low:text-tv-field">
          {total === 1 ? '1 picture. Who is in it?' : `${total} pictures. Who is in each?`}
        </p>
        <p className="max-w-[72rem] text-tv-body text-balance text-paper-2 short:text-tv-tab low:text-tv-floor">
          Each picture shows here first. Then you guess them one by one on your phone: {scoringLine(pub.rules)}
        </p>
      </div>
      {cache.total > 0 && cache.warmed < cache.total && (
        <p className="shrink-0 text-tv-floor text-paper-3">
          Getting the pictures ready: <span className="tv-num">{cache.warmed} of {cache.total}</span>
        </p>
      )}
    </div>
  )
}

/**
 * The frame on the left at the stage's full height, and the column beside it:
 * the showing, a picture asked, its reveal. One frame through all three, so
 * the picture never jumps between them.
 */
function FramePhase({
  game,
  pub,
  index,
  players,
  locked,
  box,
  cache,
  serverNow,
  mediaUrl,
  morph,
  fromWall,
}: {
  game: SessionGame
  pub: FusionPublicState
  index: number
  players: Player[]
  locked: number
  box: Box
  cache: PictureCache
  serverNow: () => number
  mediaUrl: MediaUrl
  morph: boolean
  /** The wall was up before: the picture moves out of its tile. */
  fromWall: boolean
}) {
  const current = pub.current
  const showing = pub.phase === 'showing' || !current
  const picture = showing ? pub.pictures[index] : pub.pictures.find((p) => p.n === current.n)
  if (!picture) return null

  // The frame keeps the pictures' own shape (portrait or square), at most half the stage's width.
  const aspect = cache.frameAspect
  const width = Math.floor(Math.min(box.width / 2, box.height * aspect))
  const height = Math.floor(Math.min(box.height, width / aspect))

  let column: ReactNode
  if (showing) column = <ShowingColumn game={game} pub={pub} index={index} serverNow={serverNow} />
  else if (pub.phase === 'asking') {
    column = <AskingColumn key={current.n} game={game} current={current} picture={picture} locked={locked} guests={players.length} serverNow={serverNow} />
  } else if (picture.revealed) {
    column = <RevealColumn key={current.n} game={game} pub={pub} current={current} picture={picture} reveal={picture.revealed} players={players} serverNow={serverNow} />
  }

  return (
    <div className="absolute inset-0 flex gap-16 short:gap-12 low:gap-10">
      <div className="relative shrink-0" style={{ width, height }}>
        <Frame pub={pub} n={picture.n} mediaUrl={mediaUrl} morph={morph} entering={showing ? 'slow' : morph && fromWall ? 'moves' : 'quick'} />
      </div>
      {/* Inset a little, so the tilted label chip's corners stay inside the stage. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col pt-2">{column}</div>
    </div>
  )
}

/**
 * The picture in the frame: `raised`, the image whole inside it (the raised
 * surface shows round a picture of another shape). A new picture crossfades
 * in over the one before, which stays underneath until it is covered, so the
 * frame never blinks. It carries the picture's layout id, so a picture asked
 * from the wall grows out of its tile and goes back into it after the reveal.
 */
function Frame({
  pub,
  n,
  mediaUrl,
  morph,
  entering,
}: {
  pub: FusionPublicState
  n: number
  mediaUrl: MediaUrl
  morph: boolean
  /** How the frame appears: out of its wall tile, or fading in, slowly into the showing and quickly otherwise. */
  entering: 'moves' | 'slow' | 'quick'
}) {
  const [layers, setLayers] = useState<{ under: number | null; top: number }>({ under: null, top: n })
  if (layers.top !== n) setLayers({ under: layers.top, top: n })
  useEffect(() => {
    if (layers.under === null) return
    const timer = setTimeout(() => setLayers((l) => (l.under === null ? l : { ...l, under: null })), CROSSFADE_S * 1000 + 100)
    return () => clearTimeout(timer)
  }, [layers])

  const shown = layers.under === null ? [layers.top] : [layers.under, layers.top]
  return (
    <motion.div
      layoutId={morph ? pictureLayoutId(n) : undefined}
      layoutCrossfade={false}
      initial={entering === 'moves' ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: entering === 'slow' ? CROSSFADE_S : 0.3, ease: EASE_OUT, layout: { duration: MORPH_S, ease: EASE_OUT } }}
      className="absolute inset-0 overflow-hidden bg-raised"
      style={{ borderRadius: 6 }}
    >
      {shown.map((m) => {
        const picture = pub.pictures.find((p) => p.n === m)
        if (!picture) return null
        const fadesIn = layers.under !== null && m === layers.top
        return (
          <motion.div
            key={m}
            className="absolute inset-0"
            initial={fadesIn ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            transition={{ duration: CROSSFADE_S, ease: EASE_OUT }}
          >
            <PictureImage picture={picture} mediaUrl={mediaUrl} size="full" fit="contain" className="size-full" labelClassName="text-[24cqw]" />
          </motion.div>
        )
      })}
    </motion.div>
  )
}

const pictureLayoutId = (n: number) => `fusion-picture-${n}`

/**
 * The showing's column: the label of the picture on show (landing like a tab
 * with each new picture), "Look closely.", and a pip per picture at its foot.
 * One whoosh as the first picture appears; the crossfades are silent.
 */
function ShowingColumn({ game, pub, index, serverNow }: { game: SessionGame; pub: FusionPublicState; index: number; serverNow: () => number }) {
  const picture = pub.pictures[index]
  const total = pub.pictures.length
  const startedAt = pub.showing?.startedAt ?? null
  // Fresh: the showing began within the last 15 s by the database clock, read once as the column opens.
  const [fresh] = useState(() => startedAt !== null && serverNow() - startedAt < FRESH_MS)
  useMomentSound(fresh ? momentId(game, 'showing', String(startedAt)) : null, 'whoosh')
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, ease: EASE_OUT, delay: 0.2 }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <LabelChip key={picture.n} label={picture.label} className={cn(COLUMN_CHIP, 'animate-tab-land motion-reduce:animate-none')} />
      <h2 className={cn(COLUMN_HEAD, 'mt-8 short:mt-6 low:mt-4')}>Look closely.</h2>
      <p className={cn(COLUMN_LINE, 'mt-4 short:mt-3 low:mt-2')}>You guess after the showing.</p>
      <Pips filled={index + 1} total={total} label={`Picture ${index + 1} of ${total}`} className="mt-auto pt-6" />
    </motion.div>
  )
}

/**
 * A picture asked: its label, "Who is in it?" and how to answer, the quiz's
 * countdown beside them, and the lock-in pips at the foot. The pips' total is
 * the guests less two (spec decision 7), so they never tell the room that
 * someone in the picture has left. A whoosh as it is asked, and the tick-tock
 * over the countdown's last moments, its bell landing as time runs out; an
 * early reveal unmounts this column first, which cancels it.
 */
function AskingColumn({
  game,
  current,
  picture,
  locked,
  guests,
  serverNow,
}: {
  game: SessionGame
  current: FusionCurrent
  picture: FusionPublicPicture
  locked: number
  guests: number
  serverNow: () => number
}) {
  const now = useServerTime(serverNow, 250)
  const [fresh] = useState(() => serverNow() - current.openedAt < FRESH_MS)
  useMomentSound(fresh ? momentId(game, current.key, 'asked') : null, 'whoosh')
  useMomentSoundAt(momentId(game, current.key, 'time'), 'ticktock', current.endsAt - TICKTOCK_MS, serverNow)
  const total = lockedTotal(locked, guests)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, ease: EASE_OUT, delay: 0.25 }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex shrink-0 items-start gap-10 short:gap-8">
        <div className="flex min-w-0 flex-1 flex-col items-start">
          <LabelChip label={picture.label} className={COLUMN_CHIP} />
          <h2 className={cn(COLUMN_HEAD, 'mt-8 short:mt-6 low:mt-4')}>Who is in it?</h2>
          <p className={cn(COLUMN_LINE, 'mt-4 short:mt-3 low:mt-2')}>Pick two on your phone and lock in.</p>
        </div>
        <Countdown left={current.endsAt - now} />
      </div>
      <div className="mt-auto grid shrink-0 gap-4 pt-6 short:gap-3">
        <Pips filled={locked} total={total} label={`${locked} of ${total} have locked in`} />
        <p className="flex items-baseline gap-4 whitespace-nowrap short:gap-3">
          <span className="tv-num text-tv-band text-paper short:text-tv-field low:text-tv-tab">
            {locked} of {total}
          </span>
          <span className="text-tv-body font-medium text-paper-2 short:text-tv-tab low:text-tv-floor">have locked in</span>
        </p>
      </div>
    </motion.div>
  )
}

/**
 * The reveal: the picture stays, and beside it who is in it, their tokens
 * landing one after the other, how many got both, and the sharpest eyes so
 * far along the foot (the first thing to go when the column runs out of
 * room). The gotcha sting once, as it lands.
 */
function RevealColumn({
  game,
  pub,
  current,
  picture,
  reveal,
  players,
  serverNow,
}: {
  game: SessionGame
  pub: FusionPublicState
  current: FusionCurrent
  picture: FusionPublicPicture
  reveal: FusionReveal
  players: Player[]
  serverNow: () => number
}) {
  const [fresh] = useState(() => current.revealedAt !== null && serverNow() - current.revealedAt < FRESH_MS)
  useMomentSound(fresh ? momentId(game, current.key, 'reveal') : null, 'gotcha')
  const scored = pub.top.filter((row) => row.points > 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <LabelChip label={picture.label} className={COLUMN_CHIP} />
      <p className={cn(COLUMN_LINE, 'mt-6 short:mt-4 low:mt-2')}>It was</p>
      <ol className="mt-4 grid shrink-0 gap-6 short:mt-3 short:gap-4 low:mt-2 low:gap-3">
        {reveal.people.map((id, i) => {
          const name = nameOf(players, id, reveal.names[i])
          return (
            <motion.li
              key={id}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: EASE_OUT, delay: i === 0 ? 0.25 : 0.7 }}
              className="flex min-w-0 items-center gap-8 short:gap-6 low:gap-5"
            >
              <Avatar name={name} playerId={id} className={cn('size-40 short:size-32 low:size-24', i === 0 ? '-rotate-4' : 'rotate-3')} />
              <span className="min-w-0 truncate text-tv-answer leading-[1.1] font-extrabold text-paper short:text-tv-score low:text-tv-name">{name}</span>
            </motion.li>
          )
        })}
      </ol>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, ease: EASE_OUT, delay: 1.4 }} className="mt-8 shrink-0 short:mt-6 low:mt-3">
        <Counts reveal={reveal} />
      </motion.div>
      {scored.length > 0 && (
        <IfRoom>
          <Leaders top={scored} players={players} delay={2} />
        </IfRoom>
      )}
    </div>
  )
}

/** How the room did: "9 of 21 got both, 6 got one", or the words for nobody. */
function Counts({ reveal }: { reveal: FusionReveal }) {
  const words = 'text-tv-body font-medium text-paper-2 short:text-tv-tab low:text-tv-floor'
  const { both, one, voters } = reveal
  if (voters === 0) return <p className={words}>Nobody guessed this one.</p>
  if (both === 0) return <p className={words}>{one > 0 ? `Nobody got both. ${one} got one.` : 'Nobody got either of them.'}</p>
  return (
    <p className="flex flex-wrap items-baseline gap-x-4 short:gap-x-3">
      <span className="tv-num text-tv-band text-paper short:text-tv-field low:text-tv-tab">
        {both} of {voters}
      </span>
      <span className={words}>{one > 0 ? `got both, ${one} got one` : 'got both'}</span>
    </p>
  )
}

/** Its children at the foot of the room left, or nothing while they don't fit whole. */
function IfRoom({ children }: { children: ReactNode }) {
  const [slotRef, slot] = useElementSize<HTMLDivElement>()
  const [innerRef, inner] = useElementSize<HTMLDivElement>()
  // The row keeps a gap above it, as the column's other parts do.
  const fits = inner.height > 0 && inner.height + 24 <= slot.height
  return (
    <div ref={slotRef} className="relative min-h-0 flex-1">
      <div ref={innerRef} className={cn('absolute inset-x-0 bottom-0', !fits && 'invisible')}>
        {children}
      </div>
    </div>
  )
}

/**
 * Every picture at once, as big as the stage allows (wall.ts lays them out),
 * each with its label chip; revealed ones carry their two first names on a
 * solid band (or their tokens, on tiles too small for 28 px text). The
 * pictures hang one after the other as the wall appears; the one that was in
 * the frame moves back into its tile, and its names wipe in.
 */
function Wall({
  pub,
  players,
  box,
  cache,
  mediaUrl,
  morph,
  returning,
}: {
  pub: FusionPublicState
  players: Player[]
  box: Box
  cache: PictureCache
  mediaUrl: MediaUrl
  morph: boolean
  returning: number | null
}) {
  const layout = wallLayout(pub.pictures.length, box.width, box.height, cache.wallAspect)
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  const size = wallImageSize(Math.max(layout.tileWidth, layout.tileHeight), dpr)
  // The hanging takes at most about half a second, whatever the count.
  const stagger = Math.min(0.04, 0.5 / Math.max(1, pub.pictures.length))
  return (
    <ul
      aria-label="The pictures"
      className="absolute inset-0 grid content-center justify-center"
      style={{ gridTemplateColumns: `repeat(${layout.columns}, ${layout.tileWidth}px)`, gridAutoRows: `${layout.tileHeight}px`, gap: layout.gap }}
    >
      {pub.pictures.map((picture, i) => (
        <Tile
          key={picture.n}
          picture={picture}
          players={players}
          layout={layout}
          size={size}
          mediaUrl={mediaUrl}
          morph={morph}
          returning={picture.n === returning}
          delay={picture.n === returning ? 0 : i * stagger}
        />
      ))}
    </ul>
  )
}

function Tile({
  picture,
  players,
  layout,
  size,
  mediaUrl,
  morph,
  returning,
  delay,
}: {
  picture: FusionPublicPicture
  players: Player[]
  layout: WallLayout
  size: 'thumb' | 'full'
  mediaUrl: MediaUrl
  morph: boolean
  /** It was in the frame last: it moves back in, and its names wipe in after. */
  returning: boolean
  delay: number
}) {
  const revealed = picture.revealed
  const moves = morph && returning
  return (
    <li className="@container relative">
      <motion.div
        layoutId={morph ? pictureLayoutId(picture.n) : undefined}
        layoutCrossfade={false}
        initial={moves ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, ease: EASE_OUT, delay, layout: { duration: MORPH_S, ease: EASE_OUT } }}
        className="absolute inset-0 overflow-hidden bg-raised"
        style={{ borderRadius: 6 }}
      >
        <PictureImage picture={picture} mediaUrl={mediaUrl} size={size} fit="cover" className="size-full" labelClassName="text-[24cqw]" />
      </motion.div>
      {/* Over the picture, not moving with it: they come in once it has landed. */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, ease: EASE_OUT, delay: moves ? MORPH_S * 0.9 : delay }}
        className="pointer-events-none absolute inset-0"
      >
        {picture.image !== null && (
          <span className="absolute top-[5cqw] left-[5cqw] flex max-w-[90cqw]" style={{ fontSize: TILE_CHIP_SIZE }}>
            {/* A letter chip, in the condensed face where the wide one would cut the label short. */}
            <span
              className={cn(
                'inline-block max-w-full -rotate-2 truncate rounded-chip bg-paper py-[0.12em] leading-none text-ink',
                tileChipFace(picture.label, layout.tileWidth) === 'wide' ? 'wide px-[0.3em]' : 'tv-num px-[0.24em]',
              )}
            >
              {picture.label}
            </span>
          </span>
        )}
        {revealed && <NameBand reveal={revealed} players={players} mode={layout.mode} wipe={returning} />}
      </motion.div>
    </li>
  )
}

/** A revealed tile's band: solid ground across the picture's bottom, the two first names one per line, or their tokens. */
function NameBand({ reveal, players, mode, wipe }: { reveal: FusionReveal; players: Player[]; mode: WallLayout['mode']; wipe: boolean }) {
  const names = reveal.people.map((id, i) => nameOf(players, id, reveal.names[i]))
  return (
    <div
      aria-label={`${names[0]} and ${names[1]}`}
      className={cn(
        'absolute inset-x-0 bottom-0 bg-ground px-[6cqw] py-[3.5cqw]',
        wipe && 'animate-strap-in [animation-delay:500ms] motion-reduce:animate-none',
      )}
    >
      {mode === 'names' ? (
        names.map((name, i) => (
          <p key={reveal.people[i]} className="truncate tv-num leading-[1.1] text-paper" style={{ fontSize: TILE_NAME_SIZE }}>
            {firstName(name)}
          </p>
        ))
      ) : (
        <div className="flex gap-[5cqw]">
          {reveal.people.map((id, i) => (
            <Avatar key={id} name={names[i]} playerId={id} className="size-[34cqw]" />
          ))}
        </div>
      )}
    </div>
  )
}
