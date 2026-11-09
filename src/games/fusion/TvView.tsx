import { CrownIcon, DetectiveIcon, QuestionIcon } from '@phosphor-icons/react'
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import Avatar from '@/components/Avatar'
import AvatarBadge from '@/components/AvatarBadge'
import ConfettiBurst from '@/games/fusion/ConfettiBurst'
import { plural, type FusionGame, type FusionPhase, type FusionPublicPicture, type FusionPublicState } from '@/games/fusion/logic'
import { PictureArt } from '@/games/fusion/parts'
import { countsLine, fitTiles, nameOf, publicOf, totalVotes } from '@/games/fusion/view'
import type { TvViewProps } from '@/games/types'
import type { Player } from '@/lib/types'
import { useElementSize } from '@/lib/useElementSize'
import { cn } from '@/lib/utils'

/** The picture alone fills the stage this long... */
const PICTURE_MS = 2000
/** ...then the two people stay up this long before the wall comes back. */
const PEOPLE_MS = 9000
/** A reveal older than this doesn't replay (a TV that reloads or reconnects). */
const FRESH_MS = 15_000

const spring: Transition = { type: 'spring', stiffness: 220, damping: 26 }

/**
 * The TV while fusion holds the stage: the wall of numbered pictures, the
 * revealed ones with their two people, and each new reveal as a moment of its
 * own (the picture fills the stage, then the two names spring in).
 */
export default function TvView({ players, publicState, tallies, serverNow, mediaUrl, finished }: TvViewProps<FusionGame>) {
  const pub = publicOf(publicState)
  if (!pub) {
    return <div className="grid min-h-0 flex-1 place-items-center text-3xl text-muted-foreground">Hanging the pictures…</div>
  }
  const total = pub.pictures.length
  const revealed = pub.pictures.filter((p) => p.revealed).length
  const leader = pub.top[0]

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-6 short:gap-4">
      <header className="flex shrink-0 items-end justify-between gap-8">
        <div className="min-w-0">
          <p className="flex items-center gap-3 text-2xl font-semibold tracking-widest text-confetti-violet uppercase short:text-xl">
            <DetectiveIcon weight="duotone" className="size-8 short:size-7" />
            Who is fused?
          </p>
          <h2 className="mt-1 text-5xl font-black text-balance short:text-4xl">
            {finished || pub.phase === 'done'
              ? 'Final result'
              : pub.phase === 'voting'
                ? 'Find the prints on the wall. Vote on your phone!'
                : revealed === 0
                  ? 'Voting is closed. Time for the reveal!'
                  : `${revealed} of ${total} revealed`}
          </h2>
        </div>
        {pub.phase === 'voting' ? (
          <p className="shrink-0 text-right">
            <span key={totalVotes(tallies)} className="animate-count-pop block text-7xl font-black text-primary tabular-nums short:text-6xl">
              {totalVotes(tallies)}
            </span>
            <span className="text-2xl text-muted-foreground">votes so far</span>
          </p>
        ) : (
          leader && (
            <div className="flex shrink-0 items-center gap-4">
              <div className="relative">
                <Avatar name={nameOf(players, leader.playerId)} className="size-16 text-xl" />
                <AvatarBadge icon={CrownIcon} tone="gold" size="lg" />
              </div>
              <div>
                <p className="text-xl text-muted-foreground">Sharpest eye{pub.phase === 'done' ? '' : ' so far'}</p>
                <p className="max-w-[18rem] truncate text-3xl font-bold">
                  {nameOf(players, leader.playerId)} <span className="text-primary tabular-nums">{leader.points}</span>
                </p>
              </div>
            </div>
          )
        )}
      </header>

      <PictureWall pub={pub} players={players} tallies={tallies} mediaUrl={mediaUrl} />
      <RevealMoment pub={pub} players={players} serverNow={serverNow} mediaUrl={mediaUrl} />
    </div>
  )
}

/** Every picture, as big as the screen allows: 4 get big tiles, 40 still fit. */
function PictureWall({
  pub,
  players,
  tallies,
  mediaUrl,
}: {
  pub: FusionPublicState
  players: Player[]
  tallies: Readonly<Record<string, number>>
  mediaUrl: TvViewProps['mediaUrl']
}) {
  const [ref, { width, height }] = useElementSize<HTMLDivElement>()
  const gap = pub.pictures.length > 20 ? 12 : 20
  const fit = fitTiles(pub.pictures.length, width, height, { aspect: 0.8, gap })

  return (
    <div ref={ref} className="min-h-0 flex-1">
      {width > 0 && (
        <ul
          className="grid h-full content-center justify-center"
          style={{
            gridTemplateColumns: `repeat(${fit.columns}, ${Math.floor(fit.tileWidth)}px)`,
            gridAutoRows: `${Math.floor(fit.tileHeight)}px`,
            gap,
          }}
        >
          {pub.pictures.map((picture) => (
            <Tile
              key={picture.n}
              picture={picture}
              players={players}
              phase={pub.phase}
              votes={tallies[picture.key] ?? 0}
              latest={pub.lastReveal?.n === picture.n}
              mediaUrl={mediaUrl}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

// Text in a tile is sized to the tile (container query units), so 4 big tiles
// and 40 small ones read the same way.
function Tile({
  picture,
  players,
  phase,
  votes,
  latest,
  mediaUrl,
}: {
  picture: FusionPublicPicture
  players: Player[]
  phase: FusionPhase
  votes: number
  latest: boolean
  mediaUrl: TvViewProps['mediaUrl']
}) {
  const revealed = picture.revealed
  return (
    <li
      className={cn(
        '@container relative overflow-hidden rounded-3xl bg-card ring-1 ring-foreground/10 transition-shadow duration-700',
        latest && 'ring-4 ring-confetti-violet shadow-[0_0_40px_rgb(167_139_250/0.45)]',
      )}
    >
      <PictureArt
        picture={picture}
        mediaUrl={mediaUrl}
        size="full"
        className={cn('absolute inset-0 size-full transition-opacity duration-700', revealed && 'opacity-60')}
        numberClassName="text-[length:42cqw]"
      />
      <span className="absolute top-[4cqw] left-[4cqw] max-w-[80cqw] truncate rounded-full bg-background/85 px-[4cqw] py-[1.5cqw] text-[length:8cqw] leading-none font-black">
        {picture.label}
      </span>
      {revealed ? (
        <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-background via-background/85 to-transparent px-[5cqw] pt-[16cqw] pb-[5cqw]">
          <div className="flex -space-x-[3cqw]">
            {revealed.people.map((id, i) => (
              <Avatar
                key={id}
                name={nameOf(players, id, revealed.names?.[i])}
                className="size-[16cqw] text-[length:6cqw] ring-[0.8cqw] ring-background"
              />
            ))}
          </div>
          {revealed.people.map((id, i) => (
            <p key={id} className="mt-[1.5cqw] truncate text-[length:8.5cqw] leading-tight font-bold">
              {nameOf(players, id, revealed.names?.[i])}
            </p>
          ))}
          <p className="mt-[1cqw] truncate text-[length:6cqw] text-muted-foreground">{countsLine(revealed, true)}</p>
        </div>
      ) : (
        <span className="absolute right-[4cqw] bottom-[4cqw] flex items-center gap-[1.5cqw] rounded-full bg-background/85 px-[4cqw] py-[1.5cqw] text-[length:7cqw] font-semibold tabular-nums">
          {phase === 'voting' ? (
            plural(votes, 'vote')
          ) : (
            <>
              <QuestionIcon weight="bold" />
              Who?
            </>
          )}
        </span>
      )}
    </li>
  )
}

/**
 * A new reveal takes the stage: the picture alone for 2 s, then the two
 * people spring in beside it with confetti and the counts, then the wall.
 * The reveal's sound comes with its announcement (stageBanners 'sound-only').
 */
function RevealMoment({
  pub,
  players,
  serverNow,
  mediaUrl,
}: {
  pub: FusionPublicState
  players: Player[]
  serverNow: () => number
  mediaUrl: TvViewProps['mediaUrl']
}) {
  const reduce = useReducedMotion()
  const [moment, setMoment] = useState<{ n: number; at: number; stage: 'picture' | 'people' } | null>(null)
  // The clock is read when a reveal arrives, not on every render.
  const clock = useRef(serverNow)
  useEffect(() => {
    clock.current = serverNow
  }, [serverNow])

  const n = pub.lastReveal?.n
  const at = pub.lastReveal?.at
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    if (n !== undefined && at !== undefined && clock.current() - at <= FRESH_MS) {
      timers.push(setTimeout(() => setMoment({ n, at, stage: 'picture' }), 0))
      timers.push(setTimeout(() => setMoment({ n, at, stage: 'people' }), PICTURE_MS))
      timers.push(setTimeout(() => setMoment(null), PICTURE_MS + PEOPLE_MS))
    } else {
      timers.push(setTimeout(() => setMoment(null), 0))
    }
    return () => timers.forEach(clearTimeout)
  }, [n, at])

  const picture = moment ? pub.pictures.find((p) => p.n === moment.n) : undefined
  const revealed = picture?.revealed
  const people = moment?.stage === 'people'

  return (
    <AnimatePresence>
      {moment && picture && revealed && (
        <motion.div
          key={`${moment.n}:${moment.at}`}
          className="absolute inset-0 z-20 overflow-hidden rounded-3xl bg-background ring-1 ring-confetti-violet/30"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(45% 75% at 50% -5%, color-mix(in oklch, var(--confetti-violet) 30%, transparent), transparent 75%)',
            }}
          />
          <div className="relative flex size-full items-center justify-center gap-[4vw] p-[3vw]">
            <motion.div
              layout={!reduce}
              transition={spring}
              className={cn('relative aspect-[4/5] shrink-0', people ? 'h-[80%]' : 'h-full')}
            >
              <PictureArt
                picture={picture}
                mediaUrl={mediaUrl}
                size="full"
                className="size-full rounded-3xl object-contain shadow-2xl shadow-black/60"
                numberClassName="text-[length:26vh]"
              />
              <span className="absolute top-4 left-4 rounded-full bg-background/85 px-5 py-2 text-4xl font-black">
                {picture.label}
              </span>
            </motion.div>

            {people && (
              <div className="grid min-w-0 gap-[3vh]">
                <motion.p
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-4xl font-semibold text-muted-foreground short:text-3xl"
                >
                  {picture.label} was
                </motion.p>
                {revealed.people.map((id, i) => (
                  <motion.div
                    key={id}
                    initial={reduce ? { opacity: 0 } : { opacity: 0, y: 80, scale: 0.5 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={
                      reduce ? { duration: 0.4, delay: i * 0.3 } : { type: 'spring', stiffness: 240, damping: 16, delay: 0.25 + i * 0.45 }
                    }
                    className="flex min-w-0 items-center gap-6"
                  >
                    <Avatar
                      name={nameOf(players, id, revealed.names?.[i])}
                      className="size-36 text-5xl ring-4 ring-confetti-violet/60 short:size-28 short:text-4xl"
                    />
                    <span className="min-w-0 truncate text-8xl font-black short:text-7xl">
                      {nameOf(players, id, revealed.names?.[i])}
                    </span>
                  </motion.div>
                ))}
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 1.4 }}
                  className="text-4xl text-muted-foreground tabular-nums short:text-3xl"
                >
                  {countsLine(revealed)}
                </motion.p>
              </div>
            )}
          </div>
          {people && <ConfettiBurst />}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
