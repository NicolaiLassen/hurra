import { CrownIcon, QuestionIcon } from '@phosphor-icons/react'
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import Avatar from '@/components/Avatar'
import AvatarBadge from '@/components/AvatarBadge'
import Confetti from '@/components/Confetti'
import { plural, type FusionGame, type FusionPhase, type FusionPublicPicture, type FusionPublicState } from '@/games/fusion/logic'
import { PictureArt } from '@/games/fusion/parts'
import { countsLine, fitTiles, nameOf, publicOf, totalVotes } from '@/games/fusion/view'
import type { TvViewProps } from '@/games/types'
import type { Player } from '@/lib/types'
import { useElementSize } from '@/lib/useElementSize'
import { cn } from '@/lib/utils'

/**
 * A new reveal holds the stage this long, its two people with it from the
 * start: phones get the reveal in the same ping and show it at once, so a
 * picture-only beat here would only trail their toasts and cards.
 */
const PEOPLE_MS = 9000
/** A reveal older than this doesn't replay (a TV that reloads or reconnects). */
const FRESH_MS = 15_000

const spring: Transition = { type: 'spring', stiffness: 220, damping: 26 }

/**
 * The TV while fusion holds the stage (docs/identity.md): one line on what to
 * do (the strap already names the game and where it is), the wall of
 * numbered pictures on raised tiles, the revealed ones with their two people
 * on a solid panel, and each new reveal as a moment of its own (the picture
 * fills the stage and the two names spring in beside it). No washes, no
 * rings: the newest reveal's tile steps up to the overlay surface.
 */
export default function TvView({ players, publicState, tallies, serverNow, mediaUrl, finished }: TvViewProps<FusionGame>) {
  const pub = publicOf(publicState)
  if (!pub) {
    return <div className="grid min-h-0 flex-1 place-items-center text-tv-name text-paper-2 short:text-tv-band">Hanging the pictures…</div>
  }
  const total = pub.pictures.length
  const revealed = pub.pictures.filter((p) => p.revealed).length
  const leader = pub.top[0]

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-6 short:gap-4">
      <header className="flex shrink-0 items-end justify-between gap-8">
        {/* What to do now; where the game is ("Voting is closed", "2 of 6 revealed") is the strap's. */}
        <h2 className="min-w-0 text-tv-name font-black text-balance short:text-tv-band">
          {finished || pub.phase === 'done'
            ? null
            : pub.phase === 'voting'
              ? 'Find the prints on the wall. Vote on your phone.'
              : revealed === 0
                ? 'Time for the reveal.'
                : `${total - revealed} ${total - revealed === 1 ? 'picture' : 'pictures'} still to reveal.`}
        </h2>
        {pub.phase === 'voting' ? (
          <p className="flex shrink-0 items-baseline gap-3 text-right">
            <span key={totalVotes(tallies)} className="animate-count-pop tv-num text-tv-score text-paper short:text-tv-name">
              {totalVotes(tallies)}
            </span>
            <span className="text-tv-tab text-paper-2 short:text-tv-floor">votes so far</span>
          </p>
        ) : (
          leader && (
            <div className="flex shrink-0 items-center gap-5 short:gap-4">
              <div className="relative">
                <Avatar name={nameOf(players, leader.playerId)} playerId={leader.playerId} className="size-16 short:size-14" />
                <AvatarBadge icon={CrownIcon} tone="gold" size="lg" />
              </div>
              <div>
                <p className="text-tv-floor text-paper-2">Sharpest eye{pub.phase === 'done' ? '' : ' so far'}</p>
                <p className="flex max-w-[22rem] min-w-0 items-baseline gap-3 text-tv-band font-bold short:text-tv-field">
                  <span className="min-w-0 truncate">{nameOf(players, leader.playerId)}</span>
                  <span className="shrink-0 tv-num text-gold">{leader.points}</span>
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
      className={cn('@container relative overflow-hidden rounded-tile transition-colors duration-700', latest ? 'bg-overlay' : 'bg-raised')}
    >
      <PictureArt
        picture={picture}
        mediaUrl={mediaUrl}
        size="full"
        className="absolute inset-0 size-full"
        // A revealed picture's panel says who it was; its number stays on the label.
        numberClassName={cn('text-[length:42cqw]', revealed && 'invisible')}
      />
      {/* Labels at the TV's floor at least, so a wall of many small tiles still reads from the sofa. */}
      <span className="absolute top-[4cqw] left-[4cqw] max-w-[80cqw] truncate rounded-chip bg-ground px-[4cqw] py-[1.5cqw] text-[length:max(var(--text-tv-floor),8cqw)] leading-none font-black">
        {picture.label}
      </span>
      {revealed ? (
        <div className="absolute inset-x-0 bottom-0 bg-raised px-[5cqw] pt-[4cqw] pb-[5cqw]">
          <div className="flex gap-[2cqw]">
            {revealed.people.map((id, i) => (
              <Avatar key={id} name={nameOf(players, id, revealed.names?.[i])} playerId={id} className="size-[16cqw]" />
            ))}
          </div>
          {revealed.people.map((id, i) => (
            <p key={id} className="mt-[1.5cqw] truncate text-[length:max(var(--text-tv-floor),8.5cqw)] leading-tight font-bold">
              {nameOf(players, id, revealed.names?.[i])}
            </p>
          ))}
          <p className="mt-[1cqw] truncate text-[length:max(var(--text-tv-floor),6cqw)] text-paper-2">{countsLine(revealed, true)}</p>
        </div>
      ) : (
        <span className="absolute right-[4cqw] bottom-[4cqw] flex items-center gap-[1.5cqw] rounded-chip bg-ground px-[4cqw] py-[1.5cqw] text-[length:max(var(--text-tv-floor),7cqw)] leading-none font-semibold tabular-nums">
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
 * A new reveal takes the stage: the picture, with the two people springing in
 * beside it with confetti and the counts, then the wall. The reveal's sound
 * comes with its announcement (stageBanners 'sound-only').
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
  const [moment, setMoment] = useState<{ n: number; at: number } | null>(null)
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
      timers.push(setTimeout(() => setMoment({ n, at }), 0))
      timers.push(setTimeout(() => setMoment(null), PEOPLE_MS))
    } else {
      timers.push(setTimeout(() => setMoment(null), 0))
    }
    return () => timers.forEach(clearTimeout)
  }, [n, at])

  const picture = moment ? pub.pictures.find((p) => p.n === moment.n) : undefined
  const revealed = picture?.revealed

  return (
    <AnimatePresence>
      {moment && picture && revealed && (
        <motion.div
          key={`${moment.n}:${moment.at}`}
          className="absolute inset-0 z-20 overflow-hidden bg-ground"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className="relative flex size-full items-center justify-center gap-[4vw] p-[3vw]">
            <motion.div
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={spring}
              className="relative aspect-[4/5] h-[80%] shrink-0"
            >
              <PictureArt
                picture={picture}
                mediaUrl={mediaUrl}
                size="full"
                className="size-full rounded-tile object-contain"
                numberClassName="text-[length:26vh]"
              />
              <span className="absolute top-4 left-4 rounded-chip bg-ground px-5 py-2 text-tv-band leading-none font-black short:text-tv-field">
                {picture.label}
              </span>
            </motion.div>

            <div className="grid min-w-0 gap-[3vh]">
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-tv-band font-semibold text-paper-2 short:text-tv-field"
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
                  <Avatar name={nameOf(players, id, revealed.names?.[i])} playerId={id} className="size-36 short:size-28" />
                  <span className="min-w-0 truncate text-tv-code font-black short:text-tv-answer">
                    {nameOf(players, id, revealed.names?.[i])}
                  </span>
                </motion.div>
              ))}
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.4 }}
                className="text-tv-band text-paper-2 short:text-tv-field"
              >
                {countsLine(revealed)}
              </motion.p>
            </div>
          </div>
          <Confetti />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
