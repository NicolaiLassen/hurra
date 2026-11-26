import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react'
import { useEffect, useState, type CSSProperties } from 'react'
import Avatar from '@/components/Avatar'
import { SOUNDS } from '@/games/core/sounds'
import type { FusionGame } from '@/games/fusion/logic'
import { LabelChip, Placeholder } from '@/games/fusion/parts'
import {
  lockedTotal,
  readPublic,
  scoringLine,
  SUSPENSE_MS,
  type FusionCurrent,
  type FusionPublicPicture,
  type FusionPublicState,
  type FusionReveal,
} from '@/games/fusion/shapes'
import { ARRIVE_MS, arriveIn, LEADERS_FROM_PX, revealOriginals, SIDE_SHARE, type OriginalStatus } from '@/games/fusion/reveal'
import { beatAt, FLIP_AT, FLIP_MS, hopPath, hopPathFrom, litAt, playsSuspense, tickTimes, type Beat, type Hop } from '@/games/fusion/suspense'
import { EASE_OUT, firstName, FRESH_MS, momentId } from '@/games/fusion/tvLook'
import { Countdown, Leaders, NameChip, PictureImage, Pips } from '@/games/fusion/tvParts'
import { useOriginals } from '@/games/fusion/useOriginals'
import { usePictures, type PictureCache } from '@/games/fusion/usePictures'
import { playerNamed } from '@/games/fusion/view'
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
/** The picture's move between a tile and the frame. */
const MORPH_S = 0.5
/** The tick-tock's length: it starts this long before time runs out, so its bell lands on zero. */
const TICKTOCK_MS = SOUNDS.ticktock.seconds * 1000

type Box = { width: number; height: number }
type View = 'lobby' | 'wall' | 'frame'
type MediaUrl = TvViewProps['mediaUrl']

/** The label chip beside the frame: a letter chip at the question's size. */
const COLUMN_CHIP = 'self-start text-tv-question short:text-tv-answer low:text-tv-name'
/** The frame's big words: "Who is in it?". */
const COLUMN_HEAD = 'font-extrabold tracking-[-0.01em] leading-[1.08] text-paper text-tv-question short:text-tv-answer low:text-tv-name'
/** The line under them. */
const COLUMN_LINE = 'text-tv-body text-paper-2 short:text-tv-tab low:text-tv-floor'

/**
 * Where the TV is with the picture asked: playing the suspense (`live`), at
 * which beat, and which placeholder the highlight is on; else the end, the
 * picture in the frame beside its countdown.
 */
type Suspense = { live: boolean; beat: Beat; lit: number | null; path: readonly Hop[]; from: number }

const SETTLED: Suspense = { live: false, beat: 'in', lit: null, path: [], from: 0 }

/**
 * Participant fusion on the TV stage (docs/identity.md, Participant fusion on
 * the TV): the lobby; the wall, every picture at once, the ones not asked yet
 * as placeholders; a picture asked: the suspense (a highlight hops across the
 * placeholders, lands on the one asked, it grows to the middle, its "?"
 * pulses and its face flips in), then the picture in the frame with "Who is
 * in it?", the countdown and the lock-in pips; its reveal, the picture in the
 * middle with the two people's own photos sliding in beside it, each named on
 * a paper chip, and how many got both. The strap above says where the round
 * is ("Picture 4 of 12"), so the stage never repeats it. It draws every moment
 * itself, so its announcements only sound here.
 */
export default function TvView({ game, players, publicState, tallies, serverNow, mediaUrl }: TvViewProps<FusionGame>) {
  const pub = readPublic(publicState)
  const cache = usePictures(pub, mediaUrl)
  // The two people's own photos load from the render that first brings the reveal: no sooner is still secret.
  const originals = useOriginals(revealOriginals(pub), mediaUrl)
  const [ref, box] = useElementSize<HTMLDivElement>()
  const reduce = useReducedMotion() ?? false
  const morph = SHARED_LAYOUT && !reduce
  const suspense = useSuspense(pub, serverNow, reduce)
  useSuspenseSounds(game, pub, suspense, serverNow)

  // The picture in the frame last: back on the wall, its tile takes it back.
  const inFrame = pub?.phase === 'asking' || pub?.phase === 'reveal' ? (pub.current?.n ?? null) : null
  const [framed, setFramed] = useState<number | null>(null)
  if (inFrame !== null && inFrame !== framed) setFramed(inFrame)

  // Which view is up, and the one before it: a picture asked grows out of its tile on the wall, where the highlight landed.
  const hopping = pub?.phase === 'asking' && suspense.live && suspense.beat === 'hop' && !reduce
  const view: View =
    !pub || (pub.phase === 'lobby' && !hopping) ? 'lobby' : pub.phase === 'wall' || pub.phase === 'done' || hopping ? 'wall' : 'frame'
  const [views, setViews] = useState<{ now: View; before: View | null }>({ now: view, before: null })
  if (views.now !== view) setViews({ now: view, before: views.now })

  if (!pub) return <p className="m-auto text-tv-name text-paper-2 short:text-tv-band low:text-tv-field">Getting the pictures ready</p>

  return (
    <div ref={ref} data-fusion-phase={pub.phase} data-fusion-beat={pub.phase === 'asking' ? suspense.beat : undefined} className="relative min-h-0 flex-1">
      {box.width > 0 && box.height > 0 && (
        <LayoutGroup id={`fusion-${game.id}`}>
          {/*
            The view that goes fades out over the one that comes, which brings its own parts in; the picture moves between them.
            No initial={false} here: motion would hand it to every part mounted later inside the first view, so a TV opened
            mid-round would cut each picture and a reveal would land all at once. The wrapper has no entrance of its own.
          */}
          <AnimatePresence>
            <motion.div key={view} className="absolute inset-0" exit={{ opacity: 0 }} transition={{ duration: 0.25, ease: EASE_OUT }}>
              {view === 'lobby' ? (
                <Lobby pub={pub} />
              ) : view === 'wall' ? (
                <Wall
                  pub={pub}
                  players={players}
                  box={box}
                  cache={cache}
                  mediaUrl={mediaUrl}
                  morph={morph}
                  returning={pub.phase === 'asking' ? null : framed}
                  lit={hopping ? suspense.lit : null}
                  asking={pub.phase === 'asking' ? (pub.current?.n ?? null) : null}
                />
              ) : (
                <FramePhase
                  game={game}
                  pub={pub}
                  players={players}
                  locked={pub.current ? (tallies[pub.current.key] ?? 0) : 0}
                  box={box}
                  cache={cache}
                  serverNow={serverNow}
                  mediaUrl={mediaUrl}
                  morph={morph}
                  reduce={reduce}
                  fromWall={views.before === 'wall'}
                  suspense={suspense}
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

/**
 * The suspense of the picture asked, by the database clock: whether this TV
 * plays it (it was up as the ask came in, or opened right as it did; a TV
 * that opens in the middle shows the end), its beat, and where the highlight
 * is. The clock ticks fast only while it plays. With reduced motion there are
 * no hops: the frame fades in with the placeholder and the face fades in.
 */
function useSuspense(pub: FusionPublicState | null, serverNow: () => number, reduce: boolean): Suspense {
  const asking = pub?.phase === 'asking' && pub.current ? pub.current : null
  const key = asking ? `${asking.key}:${asking.openedAt}` : null
  // What the TV showed before this render: a TV that was up as the ask came in saw it happen.
  const [seen, setSeen] = useState<{ key: string | null; mounted: boolean; live: boolean; from: number }>(() => {
    const from = asking ? serverNow() - asking.openedAt : 0
    return { key, mounted: true, live: asking !== null && playsSuspense(from, false), from }
  })
  if (seen.key !== key) {
    const from = asking ? serverNow() - asking.openedAt : 0
    setSeen({ key, mounted: true, live: asking !== null && playsSuspense(from, true), from })
  }
  const live = asking !== null && seen.key === key && seen.live
  // Fast only while it plays: the countdown after it has its own clock.
  const now = useServerTime(serverNow, 50, live && serverNow() - asking.openedAt < SUSPENSE_MS)
  if (!asking || !live) return SETTLED
  const elapsed = now - asking.openedAt
  if (elapsed >= SUSPENSE_MS) return { ...SETTLED, live: true }
  // The pictures still to come, the one asked among them, in the wall's order.
  const candidates = pub!.pictures.filter((p) => p.revealed === null).map((p) => p.n)
  const path = reduce ? [] : hopPathFrom(hopPath(candidates, asking.n), Math.max(0, seen.from))
  return { live: true, beat: beatAt(elapsed), lit: reduce ? null : litAt(path, elapsed), path, from: seen.from }
}

/**
 * The suspense's sounds, each once and only on a TV that plays it: a soft
 * tick (the pop) on the hops that tickTimes picks, and the whoosh as the face
 * flips in.
 */
function useSuspenseSounds(game: SessionGame, pub: FusionPublicState | null, suspense: Suspense, serverNow: () => number) {
  const current = pub?.phase === 'asking' ? pub.current : null
  const ticks = current && suspense.live ? tickTimes(suspense.path) : []
  const at = current?.openedAt ?? 0
  const id = (moment: string) => (current && suspense.live ? momentId(game, current.key, moment) : null)
  // At most four ticks: the hops' rule leaves two or three on a full wall.
  useMomentSoundAt(ticks.length > 0 ? id('tick-0') : null, 'pop', at + (ticks[0] ?? 0), serverNow)
  useMomentSoundAt(ticks.length > 1 ? id('tick-1') : null, 'pop', at + (ticks[1] ?? 0), serverNow)
  useMomentSoundAt(ticks.length > 2 ? id('tick-2') : null, 'pop', at + (ticks[2] ?? 0), serverNow)
  useMomentSoundAt(ticks.length > 3 ? id('tick-3') : null, 'pop', at + (ticks[3] ?? 0), serverNow)
  useMomentSoundAt(id('asked'), 'whoosh', at + FLIP_AT, serverNow)
}

/** Before the first picture: what the game is and how it scores, in words only. */
function Lobby({ pub }: { pub: FusionPublicState }) {
  const total = pub.pictures.length
  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="my-auto flex max-w-[90rem] flex-col items-start gap-10 short:gap-7 low:gap-5">
        <h2 className="wide text-tv-code text-balance text-paper short:text-tv-question low:text-tv-answer">Two guests, one face</h2>
        {/* The strap already counts the pictures ("12 pictures, starting soon"): the stage asks the question. */}
        <p className="text-tv-name font-semibold text-paper short:text-tv-band low:text-tv-field">{total === 1 ? 'Who is in it?' : 'Who is in each picture?'}</p>
        <p className="max-w-[72rem] text-tv-body text-balance text-paper-2 short:text-tv-tab low:text-tv-floor">
          {total === 1 ? 'The picture comes up here' : 'The pictures come up here one at a time, and nobody knows which is next'}. Guess who is in it on your phone:{' '}
          {scoringLine(pub.rules)}
        </p>
      </div>
    </div>
  )
}

/**
 * The frame on the left at the stage's full height, and the column beside it:
 * a picture asked, its reveal. While the suspense plays, the frame stands in
 * the middle on its own, the placeholder's "?" pulses and the face flips in;
 * then it moves to its place and the column comes in. One frame through all
 * of it, so the picture never jumps.
 */
function FramePhase({
  game,
  pub,
  players,
  locked,
  box,
  cache,
  serverNow,
  mediaUrl,
  morph,
  reduce,
  fromWall,
  suspense,
  originals,
}: {
  game: SessionGame
  pub: FusionPublicState
  players: Player[]
  locked: number
  box: Box
  cache: PictureCache
  serverNow: () => number
  mediaUrl: MediaUrl
  morph: boolean
  reduce: boolean
  /** The wall was up before: the picture moves out of its tile. */
  fromWall: boolean
  suspense: Suspense
  /** The two people's own photos of the picture revealed now, as they load. */
  originals: [OriginalStatus, OriginalStatus]
}) {
  const current = pub.current
  const picture = current ? pub.pictures.find((p) => p.n === current.n) : undefined
  // The picture this frame showed asked: its reveal moves it to the middle rather than fading it in.
  const [asked, setAsked] = useState<number | null>(pub.phase === 'asking' ? (current?.n ?? null) : null)
  if (pub.phase === 'asking' && current && asked !== current.n) setAsked(current.n)
  // The shape the frame keeps through the suspense: the image comes in during it, and the frame never jumps.
  const [shape] = useState(() => cache.frameAspect)
  if (!picture || !current) return null

  if (pub.phase === 'reveal' && picture.revealed) {
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
        aspect={cache.frameAspect}
        serverNow={serverNow}
        mediaUrl={mediaUrl}
        morph={morph}
        moves={morph && asked === current.n}
        originals={originals}
      />
    )
  }
  const aspect = suspense.live ? shape : cache.frameAspect
  // The frame at the stage's full height, at most half its width.
  const width = Math.floor(Math.min(box.width / 2, box.height * aspect))
  const height = Math.floor(Math.min(box.height, width / aspect))
  const settled = suspense.beat === 'in'
  // The face flips in at its beat once its image is in (or has failed, or there is none): the placeholder holds till then.
  const imageIn = picture.image === null || cache.ready(picture.image)
  const before = suspense.beat === 'hop' || suspense.beat === 'grow' || suspense.beat === 'pulse'
  const face = suspense.live && (before || !imageIn) ? 'placeholder' : 'picture'

  return (
    <div className={cn('absolute inset-0 flex gap-16 short:gap-12 low:gap-10', !settled && 'justify-center')}>
      <div className="relative shrink-0" style={{ width, height }}>
        <Frame
          pub={pub}
          n={picture.n}
          mediaUrl={mediaUrl}
          morph={morph}
          reduce={reduce}
          entering={morph && fromWall ? 'moves' : 'quick'}
          face={face}
          pulse={suspense.live && suspense.beat === 'pulse'}
          flips={suspense.live}
        />
      </div>
      {/* Inset a little, so the tilted label chip's corners stay inside the stage. */}
      {settled && (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col pt-2">
          <AskingColumn key={current.n} game={game} current={current} picture={picture} locked={locked} guests={players.length} serverNow={serverNow} />
        </div>
      )}
    </div>
  )
}

/**
 * The picture in the frame: `raised`, the image whole inside it (the raised
 * surface shows round a picture of another shape). It carries the picture's
 * layout id, so a picture asked from the wall grows out of its tile and goes
 * back into it after the reveal. While the suspense plays it shows the
 * placeholder, whose "?" pulses once, then the face flips in (a fade with
 * reduced motion).
 */
function Frame({
  pub,
  n,
  mediaUrl,
  morph,
  reduce = false,
  entering,
  face = 'picture',
  pulse = false,
  flips = false,
}: {
  pub: FusionPublicState
  n: number
  mediaUrl: MediaUrl
  morph: boolean
  reduce?: boolean
  /** How the frame appears: out of its wall tile, or fading in. */
  entering: 'moves' | 'quick'
  /** What it shows: the placeholder until the face flips in. */
  face?: 'placeholder' | 'picture'
  /** The placeholder's "?" pulses once. */
  pulse?: boolean
  /** The face flips in here (the suspense plays), rather than standing there from the start. */
  flips?: boolean
}) {
  const picture = pub.pictures.find((p) => p.n === n)
  if (!picture) return null
  const image = <PictureImage picture={picture} mediaUrl={mediaUrl} size="full" fit="contain" className="size-full" labelClassName="text-[24cqw]" />
  return (
    <motion.div
      layoutId={morph ? pictureLayoutId(n) : undefined}
      layoutCrossfade={false}
      initial={entering === 'moves' ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, ease: EASE_OUT, layout: { duration: MORPH_S, ease: EASE_OUT } }}
      className="absolute inset-0 overflow-hidden bg-raised"
      style={{ borderRadius: 6 }}
    >
      {!flips ? (
        image
      ) : reduce ? (
        // A calm fade: the face comes in over the placeholder.
        <>
          <Placeholder label={picture.label} className="absolute inset-0" />
          <motion.div className="absolute inset-0" initial={false} animate={{ opacity: face === 'picture' ? 1 : 0 }} transition={{ duration: FLIP_MS / 1000, ease: EASE_OUT }}>
            {image}
          </motion.div>
        </>
      ) : (
        <div className="absolute inset-0" style={{ perspective: 2400 }}>
          <motion.div
            className="absolute inset-0"
            style={{ transformStyle: 'preserve-3d' }}
            initial={false}
            animate={{ rotateY: face === 'picture' ? 180 : 0 }}
            transition={{ duration: FLIP_MS / 1000, ease: EASE_OUT }}
          >
            <div className="absolute inset-0 [backface-visibility:hidden]">
              <PulsingPlaceholder label={picture.label} pulse={pulse} />
            </div>
            <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]">{image}</div>
          </motion.div>
        </div>
      )}
    </motion.div>
  )
}

/** The frame's placeholder, its "?" pulsing once at its beat. */
function PulsingPlaceholder({ label, pulse }: { label: string; pulse: boolean }) {
  return (
    <Placeholder
      label={label}
      className="absolute inset-0"
      mark={(mark) => (
        <motion.span className="inline-block" initial={false} animate={pulse ? { scale: [1, 1.14, 1] } : { scale: 1 }} transition={{ duration: 0.3, ease: EASE_OUT }}>
          {mark}
        </motion.span>
      )}
    />
  )
}

const pictureLayoutId = (n: number) => `fusion-picture-${n}`

/**
 * A picture asked: its label, "Who is in it?" and how to answer, the quiz's
 * countdown beside them, and the lock-in pips at the foot. The pips' total is
 * everyone here: everyone guesses every picture. The tick-tock over the
 * countdown's last moments, its bell landing as time runs out; an early
 * reveal unmounts this column first, which cancels it. The countdown starts
 * at `startsAt`, once the suspense is over: until then it holds the full time.
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
  useMomentSoundAt(momentId(game, current.key, 'time'), 'ticktock', current.endsAt - TICKTOCK_MS, serverNow)
  const total = lockedTotal(locked, guests)
  const left = current.endsAt - Math.max(now, current.startsAt)

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
        <Countdown left={left} />
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
  const names = reveal.names
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
          <Person slot={0} name={names[0]} players={players} path={reveal.originals[0]} status={originals[0]} arrived={arrived[0]} mediaUrl={mediaUrl} />
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
          <Person slot={1} name={names[1]} players={players} path={reveal.originals[1]} status={originals[1]} arrived={arrived[1]} mediaUrl={mediaUrl} />
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
 * the profile photo of the guest with their name, else a token (whose slate
 * says the name already, so it gets no chip), sliding in from its side once
 * `arrived`, then named on a tilted paper chip across its foot. Its place is
 * laid out from the start.
 */
function Person({
  slot,
  name,
  players,
  path,
  status,
  arrived,
  mediaUrl,
}: {
  slot: 0 | 1
  name: string
  players: readonly Player[]
  path: string | null
  status: OriginalStatus
  arrived: boolean
  mediaUrl: MediaUrl
}) {
  // The guest here with this name, if anyone joined with it: their profile photo and token.
  const id = playerNamed(players, name)?.id
  const photo = usePlayerPhoto(id, id === undefined ? undefined : name)
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
            <Avatar name={name} playerId={id} src={id === undefined ? null : undefined} className="size-full" />
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
 * each with its label chip: a picture not asked yet as a placeholder (a drawn
 * head and shoulders with a "?"), lit while the suspense's highlight is on it;
 * revealed ones carry their two first names on paper chips (or their tokens,
 * on tiles too small for 28 px text). The pictures hang one after the other
 * as the wall appears; the one that was in the frame moves back into its
 * tile, and its names wipe in.
 */
function Wall({
  pub,
  players,
  box,
  cache,
  mediaUrl,
  morph,
  returning,
  lit,
  asking,
}: {
  pub: FusionPublicState
  players: Player[]
  box: Box
  cache: PictureCache
  mediaUrl: MediaUrl
  morph: boolean
  returning: number | null
  /** The placeholder the suspense's highlight is on. */
  lit: number | null
  /** The picture being asked while the highlight hops: it stays a placeholder until it grows to the middle. */
  asking: number | null
}) {
  const layout = wallLayout(pub.pictures.length, box.width, box.height, cache.wallAspect)
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  const size = wallImageSize(Math.max(layout.tileWidth, layout.tileHeight), dpr)
  // The hanging takes at most about half a second, whatever the count; the wall the suspense hops on is up at once.
  const stagger = asking !== null ? 0 : Math.min(0.04, 0.5 / Math.max(1, pub.pictures.length))
  // Every label on the wall in one face; placeholders carry theirs as pictures do.
  const face = wallChipFace(
    pub.pictures.filter((p) => p.image !== null || !p.asked || p.n === asking).map((p) => p.label),
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
          hidden={!picture.asked || picture.n === asking}
          lit={picture.n === lit}
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
  hidden,
  lit,
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
  /** Not asked yet (or being asked, before its face flips in): its placeholder. */
  hidden: boolean
  /** The suspense's highlight is on it. */
  lit: boolean
  delay: number
}) {
  const revealed = picture.revealed
  const moves = morph && returning
  // A placeholder carries its label chip; an asked picture without an image shows its label large instead.
  const chip = hidden || picture.image !== null
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
        {hidden ? (
          <Placeholder label={picture.label} lit={lit} className="size-full" />
        ) : (
          <PictureImage picture={picture} mediaUrl={mediaUrl} size={size} fit="cover" className="size-full" labelClassName="text-[24cqw]" />
        )}
      </motion.div>
      {/* Over the picture, not moving with it: they come in once it has landed. */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, ease: EASE_OUT, delay: moves ? MORPH_S * 0.9 : delay }}
        className="pointer-events-none absolute inset-0"
      >
        {chip && (
          <span className="absolute top-[5cqw] left-[5cqw] flex max-w-[90cqw]" style={{ fontSize: TILE_CHIP_SIZE }}>
            {/* A letter chip, every one on the wall in the condensed face where the wide one would cut a label short. */}
            <span
              className={cn(
                'inline-block max-w-full -rotate-2 truncate rounded-chip bg-paper py-[0.12em] leading-none text-ink',
                face === 'wide' ? 'wide px-[0.3em]' : 'tv-num px-[0.24em]',
                // On a lit placeholder (paper) the chip stands on ink, so it doesn't vanish into it.
                lit && 'bg-ink text-paper',
              )}
            >
              {picture.label}
            </span>
          </span>
        )}
        {revealed && !hidden && <NameBand reveal={revealed} players={players} mode={layout.mode} wipe={returning} />}
      </motion.div>
    </li>
  )
}

/** A revealed tile's names: the two first names on paper chips at the picture's foot, or their tokens. */
function NameBand({ reveal, players, mode, wipe }: { reveal: FusionReveal; players: Player[]; mode: WallLayout['mode']; wipe: boolean }) {
  const names = reveal.names
  return (
    <div
      aria-label={`${names[0]} and ${names[1]}`}
      className={cn(
        'absolute inset-x-[5cqw] bottom-[5cqw] flex flex-col items-start gap-[2.5cqw]',
        wipe && 'animate-strap-in [animation-delay:500ms] motion-reduce:animate-none',
      )}
    >
      {mode === 'names' ? (
        names.map((name, i) => <NameChip key={i} name={firstName(name)} first={i === 0} style={{ fontSize: TILE_NAME_SIZE }} />)
      ) : (
        <div className="flex gap-[5cqw]">
          {names.map((name, i) => {
            const id = playerNamed(players, name)?.id
            return <Avatar key={i} name={name} playerId={id} src={id === undefined ? null : undefined} className="size-[34cqw]" />
          })}
        </div>
      )}
    </div>
  )
}
