import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
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
import { ARRIVE_MS, arriveIn, LEADERS_FROM_PX, revealOriginals, SIDE_SHARE, type OriginalStatus } from '@/games/fusion/reveal'
import { EASE_OUT, firstName, FRESH_MS, momentId, nameOf } from '@/games/fusion/tvLook'
import { Countdown, Leaders, NameChip, PictureImage, Pips } from '@/games/fusion/tvParts'
import { useOriginals } from '@/games/fusion/useOriginals'
import { usePictures, type PictureCache } from '@/games/fusion/usePictures'
import { TILE_CHIP_SIZE, TILE_NAME_SIZE, wallChipFace, wallImageSize, wallLayout, type ChipFace, type WallLayout } from '@/games/fusion/wall'
import type { TvViewProps } from '@/games/types'
import { useMomentSound, useMomentSoundAt, useServerTime } from '@/lib/gameClock'
import type { Player, SessionGame } from '@/lib/types'
import { usePlayerPhoto } from '@/lib/photoIndex'
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
 * reveal, the picture in the middle with the two people's own photos sliding
 * in beside it, each named on a paper chip, and how many got both. The strap above
 * says where the round is ("Showing 3 of 12", "Picture 4 of 12"), so the stage
 * never repeats it. It draws every moment itself, so its announcements only
 * sound here.
 */
export default function TvView({ game, players, publicState, tallies, serverNow, mediaUrl }: TvViewProps<FusionGame>) {
  const pub = readPublic(publicState)
  const cache = usePictures(pub, mediaUrl, serverNow)
  // The two people's own photos load from the render that first brings the reveal: no sooner is still secret.
  const originals = useOriginals(revealOriginals(pub), mediaUrl)
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
                  originals={originals}
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
        {/* The strap already counts the pictures ("12 pictures, starting soon"): the stage asks the question. */}
        <p className="text-tv-name font-semibold text-paper short:text-tv-band low:text-tv-field">{total === 1 ? 'Who is in it?' : 'Who is in each picture?'}</p>
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
  originals,
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
  /** The two people's own photos of the picture revealed now, as they load. */
  originals: [OriginalStatus, OriginalStatus]
}) {
  const current = pub.current
  const showing = pub.phase === 'showing' || !current
  const picture = showing ? pub.pictures[index] : pub.pictures.find((p) => p.n === current.n)
  // The picture this frame showed asked: its reveal moves it to the middle rather than fading it in.
  const [asked, setAsked] = useState<number | null>(pub.phase === 'asking' ? (current?.n ?? null) : null)
  if (pub.phase === 'asking' && current && asked !== current.n) setAsked(current.n)
  if (!picture) return null

  // The pictures' own shape (portrait or square), in the frame and in the reveal.
  const aspect = cache.frameAspect
  if (pub.phase === 'reveal' && current && picture.revealed) {
    return (
      <RevealStage
        key={current.n}
        game={game}
        pub={pub}
        current={current}
        picture={picture}
        reveal={picture.revealed}
        players={players}
        box={box}
        aspect={aspect}
        serverNow={serverNow}
        mediaUrl={mediaUrl}
        morph={morph}
        moves={morph && asked === current.n}
        originals={originals}
      />
    )
  }
  // The frame at the stage's full height, at most half its width.
  const width = Math.floor(Math.min(box.width / 2, box.height * aspect))
  const height = Math.floor(Math.min(box.height, width / aspect))

  let column: ReactNode
  if (showing) column = <ShowingColumn game={game} pub={pub} index={index} serverNow={serverNow} />
  else if (pub.phase === 'asking') {
    column = <AskingColumn key={current.n} game={game} current={current} picture={picture} locked={locked} guests={players.length} serverNow={serverNow} />
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
          <p className={cn(COLUMN_LINE, 'mt-4 short:mt-3 low:mt-2')}>{now < current.endsAt ? 'Pick two on your phone and lock in.' : 'The answer is coming.'}</p>
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
 * The reveal, the round's big moment: the picture moves to the middle of the
 * stage and grows to its height; after a beat the two people come in, the
 * first from the left and the second from the right, each as their own photo
 * (from the settings), else their profile photo, else their token, named on a
 * tilted paper chip: Ana + Bo = this picture. Then one line of how the room
 * did, and the sharpest eyes so far along the foot where the stage has room.
 * A person comes in once their photo has loaded (useOriginals), or late, and
 * the picture is there first, so a slow photo never pops in over a finished
 * scene. The gotcha sting once, as it lands.
 */
function RevealStage({
  game,
  pub,
  current,
  picture,
  reveal,
  players,
  box,
  aspect,
  serverNow,
  mediaUrl,
  morph,
  moves,
  originals,
}: {
  game: SessionGame
  pub: FusionPublicState
  current: FusionCurrent
  picture: FusionPublicPicture
  reveal: FusionReveal
  players: Player[]
  box: Box
  /** The picture's shape: width over height, portrait or square. */
  aspect: number
  serverNow: () => number
  mediaUrl: MediaUrl
  morph: boolean
  /** It was asked in this frame: it moves to the middle (else it fades in). */
  moves: boolean
  originals: [OriginalStatus, OriginalStatus]
}) {
  const [fresh] = useState(() => current.revealedAt !== null && serverNow() - current.revealedAt < FRESH_MS)
  useMomentSound(fresh ? momentId(game, current.key, 'reveal') : null, 'gotcha')
  const scored = pub.top.filter((row) => row.points > 0)
  const leaders = scored.length > 0 && box.height >= LEADERS_FROM_PX
  const names = reveal.people.map((id, i) => nameOf(players, id, reveal.names[i]))
  const arrived = [useArrival(originals[0], ARRIVE_MS[0]), useArrival(originals[1], ARRIVE_MS[1])]
  const both = arrived[0] && arrived[1]

  // The three sized by the row's own room (a size container): the picture as tall as the row allows, or narrower
  // where the three would be wider than the stage, and each person a square SIDE_SHARE of its height.
  const sizes = {
    '--a': aspect,
    '--k': SIDE_SHARE,
    '--g': 'clamp(32px, 3.6cqw, 64px)',
    '--fh': 'min(100cqh, (100cqw - 2 * var(--g)) / (var(--a) + 2 * var(--k)))',
    '--side': 'calc(var(--fh) * var(--k))',
  } as CSSProperties

  return (
    // The pictures take the room the words leave (flex-1, min-h-0, sized by the row's own height): the words never
    // give up height. The foot's padding keeps the last line's descenders inside the stage's clip.
    <div className="absolute inset-0 flex flex-col gap-6 pb-2 short:gap-5 short:pb-1.5 low:gap-4 low:pb-1">
      <div className="relative min-h-0 flex-1" style={{ containerType: 'size' }}>
        <ol aria-label={`${picture.label} was ${names[0]} and ${names[1]}`} className="absolute inset-0 flex items-center justify-center gap-(--g)" style={sizes}>
          <Person slot={0} id={reveal.people[0]} name={names[0]} path={reveal.originals[0]} status={originals[0]} arrived={arrived[0]} mediaUrl={mediaUrl} />
          <li data-reveal-part="picture" className="@container relative shrink-0" style={{ width: 'calc(var(--fh) * var(--a))', height: 'var(--fh)' }}>
            <Frame pub={pub} n={picture.n} mediaUrl={mediaUrl} morph={morph} entering={moves ? 'moves' : 'quick'} />
            {picture.image !== null && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, ease: EASE_OUT, delay: moves ? MORPH_S : 0.2 }}
                className="pointer-events-none absolute top-[5cqw] left-[5cqw] flex max-w-[90cqw]"
                style={{ fontSize: TILE_CHIP_SIZE }}
              >
                <LabelChip label={picture.label} />
              </motion.span>
            )}
          </li>
          <Person slot={1} id={reveal.people[1]} name={names[1]} path={reveal.originals[1]} status={originals[1]} arrived={arrived[1]} mediaUrl={mediaUrl} />
        </ol>
      </div>
      {/* Always laid out, so the pictures never move when the words come in. */}
      <motion.div
        data-reveal-part="counts"
        initial={{ opacity: 0 }}
        animate={{ opacity: both ? 1 : 0 }}
        transition={{ duration: 0.4, ease: EASE_OUT, delay: both ? 0.7 : 0 }}
        className="flex shrink-0 justify-center"
      >
        <Counts reveal={reveal} />
      </motion.div>
      {leaders && (
        // Laid out (and hidden) from the start too; it comes in after the counts, once both people are in.
        <div data-reveal-part="leaders" className={cn('flex shrink-0 justify-center', !both && 'invisible')}>
          <Leaders key={both ? 'in' : 'waiting'} top={scored} players={players} delay={both ? 1.2 : 0} />
        </div>
      )}
    </div>
  )
}

/**
 * Whether a person has come in yet: at their beat once their photo is ready
 * (or they have none), at ARRIVE_LATEST_MS at the latest while it loads.
 */
function useArrival(status: OriginalStatus, beat: number): boolean {
  const [mountedAt] = useState(() => performance.now())
  const [arrived, setArrived] = useState(false)
  useEffect(() => {
    if (arrived) return
    const timer = setTimeout(() => setArrived(true), arriveIn(status, performance.now() - mountedAt, beat))
    return () => clearTimeout(timer)
  }, [arrived, status, beat, mountedAt])
  return arrived
}

/**
 * One of the two in the picture, a square beside it: their own photo, else
 * their profile photo, else their token (whose slate says the name already,
 * so it gets no chip), sliding in from its side once `arrived`, then named on
 * a tilted paper chip across its foot. Its place is laid out from the start.
 */
function Person({
  slot,
  id,
  name,
  path,
  status,
  arrived,
  mediaUrl,
}: {
  slot: 0 | 1
  id: string
  name: string
  path: string | null
  status: OriginalStatus
  arrived: boolean
  mediaUrl: MediaUrl
}) {
  const photo = usePlayerPhoto(id, name)
  const own = path !== null && status !== 'failed'
  const named = own || photo !== null
  return (
    <li data-reveal-part={`person-${slot + 1}`} className="relative shrink-0" style={{ width: 'var(--side)', height: 'var(--side)' }}>
      {arrived && (
        <motion.div
          className="absolute inset-0"
          initial={{ opacity: 0, x: slot === 0 ? -SLIDE_PX : SLIDE_PX }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.55, ease: EASE_OUT }}
        >
          {own ? (
            <PictureImage
              picture={{ label: name, image: path }}
              mediaUrl={mediaUrl}
              size="full"
              fit="cover"
              alt={`${firstName(name)}'s own photo`}
              className="size-full rounded-tile"
            />
          ) : (
            <Avatar name={name} playerId={id} className="size-full" />
          )}
          {named && (
            <span className="absolute inset-x-0 bottom-0 flex translate-y-1/2 justify-center px-[6%]">
              <NameChip
                name={firstName(name)}
                first={slot === 0}
                className="animate-tab-land text-tv-answer [animation-delay:350ms] motion-reduce:animate-none short:text-tv-score low:text-tv-name"
              />
            </span>
          )}
        </motion.div>
      )}
    </li>
  )
}

/** How far a person slides in from their side. */
const SLIDE_PX = 120

/** How the room did: "9 of 21 got both, 6 got one", or the words for nobody. A line tall enough for g and y at every size. */
function Counts({ reveal }: { reveal: FusionReveal }) {
  const words = 'text-tv-body leading-[1.3] font-medium text-paper-2 short:text-tv-tab short:leading-[1.3] low:text-tv-floor low:leading-[1.3]'
  const { both, one, voters } = reveal
  if (voters === 0) return <p className={words}>Nobody guessed this one.</p>
  if (both === 0) return <p className={words}>{one > 0 ? `Nobody got both. ${one} got one.` : 'Nobody got either of them.'}</p>
  return (
    <p className="flex flex-wrap items-baseline justify-center gap-x-4 short:gap-x-3">
      <span className="tv-num text-tv-band text-paper short:text-tv-field low:text-tv-tab">
        {both} of {voters}
      </span>
      <span className={words}>{one > 0 ? `got both, ${one} got one` : 'got both'}</span>
    </p>
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
  const face = wallChipFace(
    pub.pictures.filter((p) => p.image !== null).map((p) => p.label),
    layout.tileWidth,
  )
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
          face={face}
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
  face,
  size,
  mediaUrl,
  morph,
  returning,
  delay,
}: {
  picture: FusionPublicPicture
  players: Player[]
  layout: WallLayout
  /** The wall's one chip face (wallChipFace). */
  face: ChipFace
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
            {/* A letter chip, every one on the wall in the condensed face where the wide one would cut a label short. */}
            <span
              className={cn(
                'inline-block max-w-full -rotate-2 truncate rounded-chip bg-paper py-[0.12em] leading-none text-ink',
                face === 'wide' ? 'wide px-[0.3em]' : 'tv-num px-[0.24em]',
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
        'absolute inset-x-[5cqw] bottom-[5cqw] flex flex-col items-start gap-[2.5cqw]',
        wipe && 'animate-strap-in [animation-delay:500ms] motion-reduce:animate-none',
      )}
    >
      {mode === 'names' ? (
        names.map((name, i) => <NameChip key={reveal.people[i]} name={firstName(name)} first={i === 0} style={{ fontSize: TILE_NAME_SIZE }} />)
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
