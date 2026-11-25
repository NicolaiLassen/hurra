import { motion } from 'motion/react'
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import Avatar from '@/components/Avatar'
import Confetti from '@/components/Confetti'
import Piece from '@/components/Piece'
import type { Said } from '@/components/tv/boardLines'
import { clockTime } from '@/components/tv/clock'
import { cheer, firstName, nightLine, nightRanks, THIRD_HURRA } from '@/components/tv/winnerLines'
import { GUEST_BG, guestLook, SLATE_LINE_HEIGHT, SLATE_TILT_DEG, slateLines, slateSize, type GuestColor } from '@/lib/guest'
import { usePlayerPhoto } from '@/lib/photoIndex'
import type { Player, ScoreRow } from '@/lib/types'
import { useElementSize } from '@/lib/useElementSize'
import { cn } from '@/lib/utils'

/** The share of the TV's height the winner's colour covers: the top two thirds. */
const FIELD_SHARE = 0.65
/** The room kept clear inside the field's bottom edge and above the podium, px; less on a short screen. */
const EDGE = 40
const SHORT_EDGE = 24
/** The cheer's size at most (text-tv-cheer, 176 px) and at least, px. */
const CHEER_MAX = 176
const CHEER_MIN = 64
/** The share of the text's width the cheer's wider line may take: measured at 100 px, it may round a pixel wider. */
const WIDTH_SLACK = 0.97
/** The hero token's side at most, px. */
const TOKEN_MAX = 360
/** A tilted square's bounding box against its side: cos 4 degrees plus sin 4 degrees. */
const TILTED = 1.07
/** A short podium step with the name over the points: two 33 px lines, the gap and the padding, px. */
const STACKED_STEP = 84

/** Each guest colour as a text class, spelled out so Tailwind finds it: the name on the inverted slate. */
const GUEST_TEXT: Record<GuestColor, string> = {
  coral: 'text-guest-coral',
  teal: 'text-guest-teal',
  violet: 'text-guest-violet',
  sky: 'text-guest-sky',
  lime: 'text-guest-lime',
  paper: 'text-guest-paper',
}

/**
 * A game's winners on the TV (docs/identity.md, The winner's screen), for
 * Last one standing and for any game that ends with winners: a still layout.
 * The first winner's colour covers the top two thirds of the TV, behind the
 * frame's strap (`data-tv-field` names the colour, so the frame can set its
 * words in ink while it shows); on it their photo or their name slate in
 * ink, the cheer ("Hurra for Bo!", the product's one exclamation mark), the
 * `deck` and the `last` thing that happened with its time. Beneath, on the
 * ground, the night so far: the line on what the game did to the night and
 * the night's top three on steps of clearly different heights. The logo's
 * confetti bursts once; everything else only fades in.
 */
export default function WinnerMoment({
  title,
  winners,
  deck,
  last,
  scores,
  gamePoints,
}: {
  /** The game's title. */
  title: string
  /** The winners still in the party, in the game's order: at least one. */
  winners: readonly Player[]
  /** The line under the cheer: "The last one in, with 7 knockouts." */
  deck: string
  /** The last thing that happened, at a time the database holds: the final knockout, the game's last news. */
  last?: { at: number; text: ReactNode } | null
  /** The night's standings. */
  scores: readonly ScoreRow[]
  /** This game's points per player. */
  gamePoints: Readonly<Record<string, number>>
}) {
  const { color } = guestLook(winners[0].name)
  const [rootRef, top, root] = useViewportBox<HTMLDivElement>()
  const viewport = useViewportHeight()
  const edge = viewport > 0 && viewport <= 960 ? SHORT_EDGE : EDGE
  // The part of this screen that stands on the winner's colour, and the part under it.
  const fieldHeight = root.height > 0 ? Math.max(0, Math.min(root.height, viewport * FIELD_SHARE - top)) : 0
  const groundHeight = Math.max(0, root.height - fieldHeight)

  return (
    <div ref={rootRef} className="relative flex min-h-0 flex-1 flex-col">
      <motion.div
        aria-hidden
        data-tv-field={color}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
        className={cn('pointer-events-none fixed inset-x-0 top-0 -z-5', GUEST_BG[color])}
        style={{ height: `${FIELD_SHARE * 100}vh` }}
      />
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <OnTheField height={fieldHeight} edge={edge} winners={winners} deck={deck} last={last} />
        <section className="flex min-h-0 flex-1" style={{ paddingTop: edge }}>
          <NightSoFar
            line={nightLine(title, winners.map((p) => p.id), scores, gamePoints)}
            scores={scores}
            gamePoints={gamePoints}
            winners={winners.map((p) => p.id)}
            height={Math.max(0, groundHeight - edge)}
          />
        </section>
      </motion.div>
      <Confetti pieces={60} className="fixed inset-0 z-10" />
    </div>
  )
}

/** The winners' tokens and the cheer on their colour, fitted into the field's `height` above this screen's top. */
function OnTheField({
  height,
  edge,
  winners,
  deck,
  last,
}: {
  height: number
  /** The room kept clear inside the field's bottom edge, px. */
  edge: number
  winners: readonly Player[]
  deck: string
  last?: { at: number; text: ReactNode } | null
}) {
  const [textRef, text] = useElementSize<HTMLDivElement>()
  const [linesRef, lines] = useElementSize<HTMLDivElement>()
  const [widestRef, widest] = useElementSize<HTMLSpanElement>()
  const names = winners.map((p) => p.name)
  const room = Math.max(0, height - edge)
  const shown = winners.slice(0, 3)
  const side = Math.round(Math.min(TOKEN_MAX, room / TILTED) / (shown.length > 1 ? 1.6 : 1))
  // The cheer as big as its two lines fit the text's width and the height the deck leaves.
  // Rounded down, with a little slack, so "Hurra for" never breaks onto a third line.
  const byHeight = (room - lines.height - 24) / (2 * 0.9)
  const byWidth = widest.width > 0 ? (text.width / widest.width) * 100 * WIDTH_SLACK : CHEER_MAX
  const size = Math.floor(Math.max(CHEER_MIN, Math.min(CHEER_MAX, byHeight, byWidth)))
  const second = `${cheer(names).slice('Hurra for '.length)}`

  return (
    <section className="relative flex shrink-0 items-center gap-14 text-ink short:gap-10" style={{ height: height || undefined, paddingBottom: edge }}>
      {height > 0 && (
        <div className="flex shrink-0 items-center" style={{ gap: side * 0.12 }}>
          {shown.map((p, i) => (
            <WinnerToken key={p.id} player={p} side={side} tilt={i % 2 === 0 ? -4 : 3} />
          ))}
        </div>
      )}
      <div ref={textRef} className="relative min-w-0 flex-1">
        {/* The cheer's lines at 100 px, out of sight, to fit it by: as wide as the wider. */}
        <span ref={widestRef} aria-hidden className="invisible absolute top-0 left-0 grid w-max wide whitespace-nowrap" style={{ fontSize: 100 }}>
          <span>Hurra for</span>
          <span>{second}</span>
        </span>
        <h2 className="wide" style={{ fontSize: size, lineHeight: 0.9 }}>
          <span className="block">Hurra for </span>
          <span className="block whitespace-nowrap">{second}</span>
        </h2>
        <div ref={linesRef} className="mt-6 grid gap-3 short:mt-4 short:gap-2">
          <p className="text-tv-name font-bold text-balance short:text-tv-band">{deck}</p>
          {last && (
            <p className="flex min-w-0 items-baseline gap-3 text-tv-field short:text-tv-body">
              <time dateTime={new Date(last.at).toISOString()} className="shrink-0 tv-num">
                {clockTime(last.at)}
              </time>
              <span className="min-w-0 truncate [&_strong]:font-bold">{last.text}</span>
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

/**
 * A winner's token at hero size, tilted like a slate held up to the camera:
 * their photo, or their name in their colour on ink, so it stands out of the
 * field of that same colour.
 */
function WinnerToken({ player, side, tilt }: { player: Player; side: number; tilt: number }) {
  const photo = usePlayerPhoto(player.id, player.name) !== null
  return (
    <span
      className="block shrink-0 rounded-token shadow-[0.875rem_1rem_0_color-mix(in_oklab,var(--color-ink)_22%,transparent)]"
      style={{ width: side, height: side, rotate: `${tilt}deg` }}
    >
      {photo ? <Avatar name={player.name} playerId={player.id} className="size-full" /> : <InvertedSlate name={player.name} className="size-full" />}
    </span>
  )
}

/** The name slate the other way round: the guest's colour on ink. Their piece for a name with no word. */
function InvertedSlate({ name, className, style }: { name: string; className?: string; style?: CSSProperties }) {
  const { color, piece } = guestLook(name)
  const lines = slateLines(firstName(name))
  return (
    <span
      aria-hidden
      className={cn('@container relative grid shrink-0 place-items-center overflow-hidden rounded-token bg-ink select-none', GUEST_TEXT[color], className)}
      style={style}
    >
      {lines.length > 0 ? (
        <span
          className="text-center font-display font-black tracking-[-0.01em] whitespace-nowrap font-stretch-62%"
          style={{ fontSize: `${(slateSize(lines) * 100).toFixed(2)}cqi`, lineHeight: SLATE_LINE_HEIGHT, rotate: `${-SLATE_TILT_DEG}deg` }}
        >
          {lines.map((line, i) => (
            <span key={i} className="block">
              {line}
            </span>
          ))}
        </span>
      ) : (
        <Piece kind={piece} className="size-[62cqi]" />
      )}
    </span>
  )
}

/**
 * The night so far, on the ground: what the game did to the night (`line`)
 * with the third hurra's promise, and the night's top three on paper steps
 * of clearly different heights, fitted into `height` and the width it has:
 * the tokens stand on the steps while there is room for them, the steps
 * narrow on a small screen, and when the words don't fit beside them the
 * title goes first, then the line, and the third hurra's promise stays.
 */
export function NightSoFar({
  line,
  scores,
  gamePoints,
  winners,
  height,
}: {
  line: Said
  scores: readonly ScoreRow[]
  gamePoints: Readonly<Record<string, number>>
  /** This game's winners: their gain is gold on the steps. */
  winners: readonly string[]
  /** The room, px; 0 until measured. */
  height: number
}) {
  const [rootRef, root] = useElementSize<HTMLDivElement>()
  const [titleRef, title] = useElementSize<HTMLHeadingElement>()
  const [wholeRef, whole] = useElementSize<HTMLParagraphElement>()
  const ranked = nightRanks(scores).slice(0, 3)
  // The tokens stand on the steps while there is room; else a small one sits by the name on the step.
  const tokens = height === 0 || height >= 260
  // Steps with the name over the points, or in one row when the room is short.
  const compact = height > 0 && height - (tokens ? 92 : 0) < 150
  const least = compact ? 56 : 112
  const tallest = height > 0 ? Math.max(least, Math.min(216, height - (tokens ? 92 : 0))) : 216
  let lowest = Math.max(least, Math.min(tallest - 32, Math.round(tallest * 0.55)))
  // A short step stacks the name over the points, so a gain chip never squeezes the name out (720p, 768p):
  // every step gets the room for two lines while the steps still differ in height.
  if (compact) lowest = Math.max(lowest, Math.min(STACKED_STEP, tallest - 32))
  const stacked = compact && lowest >= STACKED_STEP
  const steps = [tallest, Math.round((tallest + lowest) / 2), lowest]
  const podium = ranked.length > 0 && (height === 0 || height >= least)
  // Three steps in at most 60 percent of the width, between 176 and 296 px each.
  const stepWidth = root.width > 0 ? Math.max(176, Math.min(296, Math.floor((root.width * 0.6 - 24) / 3))) : 296
  // The words, as many as fit: the title and the line, the line alone, or the promise alone.
  const fits = (h: number) => height === 0 || whole.height === 0 || h <= height
  const titled = fits(title.height + 12 + whole.height)
  const said = titled || fits(whole.height)
  const words = (all: boolean) => (
    <>
      {all && line.map((part, i) => (typeof part === 'string' ? part : <strong key={i}>{part.name}</strong>))}
      {all && line.length > 0 && ' '}
      {THIRD_HURRA}
    </>
  )
  const paragraph = 'text-tv-body text-paper-2 short:text-tv-tab short:leading-[1.3] [&_strong]:font-bold [&_strong]:text-paper'

  return (
    <div ref={rootRef} className="flex min-h-0 w-full items-end gap-16 short:gap-10">
      <div className="relative min-w-0 flex-1 self-center">
        {/* The title and the whole line, out of sight, to measure what fits. */}
        <div aria-hidden className="invisible absolute inset-x-0 top-0">
          <h3 ref={titleRef} className="wide text-tv-name short:text-tv-band">
            The night so far
          </h3>
          <p ref={wholeRef} className={paragraph}>
            {words(true)}
          </p>
        </div>
        {titled && <h3 className="mb-3 wide text-tv-name short:mb-2 short:text-tv-band">The night so far</h3>}
        <p className={paragraph}>{words(said)}</p>
      </div>
      {podium && (
        <ol data-fit="podium" className="flex shrink-0 items-end gap-3">
          {[1, 0, 2]
            .filter((slot) => slot < ranked.length)
            .map((slot) => {
              const row = ranked[slot]
              const gain = gamePoints[row.player_id] ?? 0
              return (
                <li key={row.player_id} className="flex flex-col items-start" style={{ width: stepWidth }}>
                  {tokens && <Avatar name={row.name} playerId={row.player_id} className="mb-3 ml-5 size-20 short:ml-4" />}
                  <div
                    className={cn(
                      'relative flex w-full justify-between gap-3 rounded-t-chip bg-paper text-ink',
                      stacked ? 'items-center px-4 py-1.5' : compact ? 'items-center px-4 py-2' : 'items-start p-5 short:p-4',
                    )}
                    style={{ height: steps[Math.min(row.rank, 3) - 1] }}
                  >
                    <div className={cn('flex min-w-0', compact && !stacked ? 'items-center gap-2.5' : 'flex-col gap-1')}>
                      <p className="flex min-w-0 items-center gap-2.5">
                        {/* An ink edge, so a guest whose colour is paper still shows on the paper step. */}
                        {!tokens && <Avatar name={row.name} playerId={row.player_id} className={cn('shrink-0 ring-2 ring-ink', stacked ? 'size-8' : 'size-10')} />}
                        <span className={cn('min-w-0 truncate tv-num text-tv-field', stacked && 'leading-none')}>{row.name}</span>
                      </p>
                      <p className="flex shrink-0 items-center gap-2.5">
                        <span className={cn('tv-num text-tv-field', stacked && 'leading-none')}>{row.points}</span>
                        {gain > 0 && (
                          <span
                            className={cn(
                              'rounded-chip px-2 tv-num text-tv-floor',
                              stacked && 'leading-[1.1]',
                              winners.includes(row.player_id) ? 'bg-gold' : 'bg-ink text-paper',
                            )}
                          >
                            +{gain}
                          </span>
                        )}
                      </p>
                    </div>
                    <span className={cn('shrink-0 wide leading-[0.8]', compact ? 'text-tv-band' : 'text-tv-question short:text-tv-answer')}>{row.rank}</span>
                  </div>
                </li>
              )
            })}
        </ol>
      )}
    </div>
  )
}

/** The window's height, kept up to date. */
function useViewportHeight(): number {
  const [height, setHeight] = useState(() => (typeof window === 'undefined' ? 0 : window.innerHeight || 0))
  useEffect(() => {
    const update = () => setHeight(window.innerHeight)
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return height
}

/** An element's distance from the top of the window and its size, kept up to date as the frame around it moves. */
function useViewportBox<T extends HTMLElement>() {
  const [box, setBox] = useState({ top: 0, width: 0, height: 0 })
  const ref = useCallback((el: T | null) => {
    if (!el) return
    const measure = () => {
      const rect = el.getBoundingClientRect()
      setBox((b) => (b.top === rect.top && b.width === rect.width && b.height === rect.height ? b : { top: rect.top, width: rect.width, height: rect.height }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])
  return [ref, box.top, box] as const
}
