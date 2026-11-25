import { CrownIcon } from '@phosphor-icons/react'
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { QRCodeSVG } from 'qrcode.react'
import { useMemo, type ReactNode, type Ref } from 'react'
import Avatar from '@/components/Avatar'
import AvatarBadge from '@/components/AvatarBadge'
import { aheadLine, commentary, wonLine, type Said } from '@/components/tv/boardLines'
import {
  boardSplit,
  boardTier,
  COLUMN_GAP,
  leaderColumn,
  NEXT_PLACES,
  rowLayoutsFor,
  SPLIT_GAP,
  type FieldFit,
  type RowLayout,
} from '@/components/tv/fit'
import { spring } from '@/components/tv/look'
import { GainBubble, Mover, Points } from '@/components/tv/parts'
import type { Gains } from '@/components/tv/useGains'
import { knockedOutIds } from '@/games/registry'
import { usePlayerPhoto } from '@/lib/photoIndex'
import { gamePointsOf, latestResult, placesMoved } from '@/lib/stage'
import type { ScoreRow, SessionGame } from '@/lib/types'
import { joinUrl } from '@/lib/urls'
import { useElementSize } from '@/lib/useElementSize'
import { useLive } from '@/lib/useLive'
import { cn } from '@/lib/utils'

export type Ranked = ScoreRow & { rank: number }

/** The space between the hero, the next places and the commentary (mt-6), in px. */
const PART_GAP = 24
/** The space between the next places' rows (gap-1.5), in px. */
const PLACE_GAP = 6
/** The space between the field and the join block under it (gap-8), in px. */
const FIELD_GAP = 32

const NOTHING: Readonly<Record<string, number>> = Object.freeze({})
const NO_GAMES: readonly SessionGame[] = Object.freeze([])

/** A guest leads, and wears the crown, at the top with points; everyone tied for first wears it. */
const crowned = (row: Ranked) => row.rank === 1 && row.points > 0

/**
 * The standings (docs/identity.md, The standings): between games, at the end
 * of the night, and while a game without a TV view of its own is on the
 * stage. Two columns, measured (fit.ts), so 1 guest and 45 fit any TV:
 * - the leader's column: the leader as a hero (their token, their points in
 *   gold, what they won and their lead), the next five places under it, and
 *   a line on how the last game moved the places;
 * - the field: everyone else in rows, in as many columns as they need, with
 *   the join block under them while joining is open (`invite`): the QR code
 *   on paper and the code, or its short form when the rows need the room.
 * The places that don't fit under the hero join the field, and the leader's
 * column narrows for a big party. Guests a live game has knocked out carry
 * the word Out (GameModule.knockedOut). `strip` draws the status cards'
 * chips in the room left under the field, if any.
 */
export default function Board({
  rows,
  gains,
  strip,
  invite = null,
}: {
  rows: Ranked[]
  gains: Gains
  strip?: (room: number, chipsHeight?: number) => ReactNode
  /** The join code for the join block; null leaves it out (joining closed, or the frame shows it). */
  invite?: string | null
}) {
  const { snapshot } = useLive()
  const games = snapshot?.games ?? NO_GAMES
  const out = useMemo(() => knockedOutIds(games), [games])
  // How the last game moved the places, while its result is still the news.
  const last = snapshot ? latestResult(snapshot) : null
  const lastPoints = snapshot && last ? gamePointsOf(snapshot, last.id) : NOTHING
  const moved = useMemo(() => (last ? placesMoved(rows, lastPoints) : NOTHING), [last, rows, lastPoints])
  const said = last ? commentary(last, moved, lastPoints, rows) : null

  const tier = boardTier(rows.length)
  const [areaRef, area] = useElementSize<HTMLDivElement>()
  const [heroRef, hero] = useElementSize<HTMLDivElement>()
  const [placeRef, place] = useElementSize<HTMLLIElement>()
  const [saidRef, saidBox] = useElementSize<HTMLParagraphElement>()
  const [blockRef, block] = useElementSize<HTMLDivElement>()
  const [lineRef, line] = useElementSize<HTMLDivElement>()

  const leader = rows[0]
  const next = rows.slice(1, 1 + NEXT_PLACES)
  const column = leaderColumn({
    height: area.height,
    hero: hero.height,
    row: place.height,
    rowGap: PLACE_GAP,
    gap: PART_GAP,
    comment: said ? saidBox.height || 1 : 0,
    next: next.length,
  })
  const places = next.slice(0, column.places)
  const field = rows.slice(1 + places.length)
  const measured = area.width > 0 && area.height > 0 && (!invite || (block.height > 0 && line.height > 0))
  const split = boardSplit({
    field: field.length,
    width: area.width,
    height: area.height,
    join: invite ? { block: block.height, blockWidth: block.width, line: line.height } : null,
    gap: FIELD_GAP,
    layouts: rowLayoutsFor(tier),
  })
  // Until it is measured, the big join block shows (as it does in a prerender).
  const joinForm = measured ? split.join : invite ? 'block' : null
  const hasField = field.length > 0
  const twoColumns = hasField || invite !== null || strip !== undefined
  const leftWidth = Math.round(area.width * split.split)
  const rightWidth = Math.max(0, area.width - leftWidth - SPLIT_GAP)
  const fieldHeight = split.fit ? split.fit.perColumn * split.fit.layout.height + (split.fit.perColumn - 1) * split.fit.layout.gap : 0
  const joinHeight = joinForm === 'block' ? block.height : joinForm === 'line' ? line.height : 0
  const stripRoom = Math.max(0, area.height - (hasField ? fieldHeight + FIELD_GAP : 0) - (joinForm ? joinHeight + FIELD_GAP : 0))

  if (!leader) return null

  return (
    <LayoutGroup>
      <div ref={areaRef} className="flex min-h-0 flex-1">
        <div
          className={cn('grid min-h-0 w-full', !twoColumns && 'mx-auto max-w-5xl')}
          style={twoColumns ? { gridTemplateColumns: area.width > 0 ? `${leftWidth}px minmax(0, 1fr)` : '1fr 1fr', columnGap: SPLIT_GAP } : undefined}
        >
          {/* The leader's column. */}
          <section className={cn('relative flex min-h-0 min-w-0 flex-col *:shrink-0', hasField ? 'justify-start' : 'justify-center')}>
            <Hero ref={heroRef} row={leader} games={games} out={out.has(leader.player_id)} ahead={aheadLine(rows)} gain={gains[leader.player_id]} />
            {places.length > 0 && (
              <ol className="mt-6 grid grid-cols-1 gap-1.5">
                <AnimatePresence initial={false}>
                  {places.map((row, i) => (
                    <Place
                      key={row.player_id}
                      ref={i === 0 ? placeRef : undefined}
                      row={row}
                      out={out.has(row.player_id)}
                      moved={moved[row.player_id]}
                      gain={gains[row.player_id]}
                    />
                  ))}
                </AnimatePresence>
              </ol>
            )}
            {said && <Commentary ref={saidRef} said={said} hidden={!column.comment} />}
          </section>

          {/* The field, and the join block under it. */}
          {twoColumns && (
            <section className={cn('relative flex min-h-0 min-w-0 flex-col gap-8', hasField ? 'justify-between' : 'justify-center')}>
              {hasField && measured && split.fit && (
                <Field rows={field} fit={split.fit} width={rightWidth} out={out} gains={gains} />
              )}
              {strip && measured && stripRoom > 0 && <div className="min-h-0">{strip(rightWidth, stripRoom)}</div>}
              {invite && (
                <>
                  <JoinBlock ref={blockRef} joinCode={invite} hidden={joinForm !== 'block'} />
                  <JoinLine ref={lineRef} joinCode={invite} hidden={joinForm !== 'line'} />
                </>
              )}
            </section>
          )}
        </div>
      </div>
    </LayoutGroup>
  )
}

/**
 * The leader: their token at hero size and their points in gold, with what
 * they won last and their lead. The token carries the name (the slate), so
 * the line prints it only beside a photo, or beside the word Out.
 */
function Hero({
  ref,
  row,
  games,
  out,
  ahead,
  gain,
}: {
  ref: Ref<HTMLDivElement>
  row: Ranked
  games: readonly SessionGame[]
  out: boolean
  ahead: string | null
  gain?: { amount: number; seq: number }
}) {
  const photo = usePlayerPhoto(row.player_id, row.name) !== null
  const lead = crowned(row)
  const named = photo || out
  const won = wonLine(row.player_id, games, named)
  return (
    <div ref={ref} data-fit="hero" className="flex min-w-0 items-center gap-10 short:gap-7">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={row.player_id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          className="relative shrink-0"
        >
          <Avatar name={row.name} playerId={row.player_id} out={out} className="size-66 short:size-44" />
          {lead && (
            <span
              data-crown=""
              className="absolute -right-4 -bottom-4 grid size-16 place-items-center rounded-chip bg-gold text-ink ring-[6px] ring-ground short:-right-3 short:-bottom-3 short:size-12 short:ring-4"
            >
              <CrownIcon weight="fill" className="size-10 short:size-8" />
            </span>
          )}
        </motion.div>
      </AnimatePresence>
      <div className="relative min-w-0">
        {(named || won) && (
          <p className="flex min-w-0 items-baseline gap-3 text-tv-field font-bold short:text-tv-body">
            {named && <span className="min-w-0 shrink truncate tv-num text-tv-name short:text-tv-band">{row.name}</span>}
            {out && <OutWord />}
            {/* Two lines when the column is narrow ("Won Last one standing / at 21:29"), never cut. */}
            {won && <span className="line-clamp-2 min-w-0 text-balance">{won}</span>}
          </p>
        )}
        <p className="mt-1 flex items-baseline gap-4">
          <motion.span
            key={row.points}
            initial={{ opacity: 0.4 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
            className={cn('tv-num text-tv-lead short:text-tv-cheer', lead ? 'text-gold' : 'text-paper')}
          >
            {row.points}
          </motion.span>
          <span className="text-tv-field font-semibold text-paper-2 short:text-tv-body">{row.points === 1 ? 'point' : 'points'}</span>
        </p>
        {ahead && <p className="mt-1 line-clamp-2 text-tv-field text-paper-2 short:text-tv-body">{ahead}</p>}
        <GainBubble gain={gain} className="top-1/3 -right-2" />
      </div>
    </div>
  )
}

/** One of the next places under the hero: large, with how the last game moved it. */
function Place({
  ref,
  row,
  out,
  moved,
  gain,
}: {
  ref?: Ref<HTMLLIElement>
  row: Ranked
  out: boolean
  moved: number | undefined
  gain?: { amount: number; seq: number }
}) {
  const lead = crowned(row)
  return (
    <motion.li
      ref={ref}
      layout="position"
      data-fit="place"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={spring}
      className="relative flex h-18 min-w-0 items-center gap-5 short:h-14 short:gap-4"
    >
      <span className={cn('w-14 shrink-0 text-right tv-num text-tv-name short:w-11 short:text-tv-band', lead ? 'text-gold' : 'text-paper-3')}>
        {row.rank}
      </span>
      <span className="relative shrink-0">
        <Avatar name={row.name} playerId={row.player_id} out={out} className="size-16 short:size-12" />
        {lead && (
          <span data-crown="">
            <AvatarBadge icon={CrownIcon} tone="gold" size="lg" />
          </span>
        )}
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-3">
        <span className="min-w-0 truncate tv-num text-tv-name short:text-tv-band">{row.name}</span>
        {out && <OutWord />}
      </span>
      <Mover by={moved} className="w-20 shrink-0 text-tv-field short:w-16 short:text-tv-tab" />
      <Points
        value={row.points}
        className={cn('w-28 shrink-0 text-right tv-num text-tv-score short:w-20 short:text-tv-name', lead ? 'text-gold' : 'text-paper')}
      />
      <GainBubble gain={gain} className="-top-2 right-0" />
    </motion.li>
  )
}

/** The line about the last game; kept mounted out of sight while it doesn't fit, so its height stays known. */
function Commentary({ ref, said, hidden }: { ref: Ref<HTMLParagraphElement>; said: Said; hidden: boolean }) {
  return (
    <p
      ref={ref}
      data-fit={hidden ? undefined : 'comment'}
      aria-hidden={hidden || undefined}
      className={cn(
        'mt-6 line-clamp-2 text-tv-body text-paper-2 short:text-tv-tab short:leading-[1.3] [&_strong]:font-bold [&_strong]:text-paper',
        hidden && 'invisible absolute inset-x-0 top-0',
      )}
    >
      {said.map((part, i) => (typeof part === 'string' ? part : <strong key={i}>{part.name}</strong>))}
    </p>
  )
}

/** The word beside a knocked-out guest's name: pink, at the TV's floor. */
function OutWord() {
  return <span className="shrink-0 text-tv-floor leading-none font-bold text-pink">Out</span>
}

/** The field's rows by layout (fit.ts): fixed heights, so the fit maths holds, and never under the TV's floor of 28 px. */
const FIELD_STYLE: Record<RowLayout['kind'], { row: string; rank: string; avatar: string; name: string; points: string }> = {
  large: { row: 'gap-5', rank: 'w-12 text-tv-band', avatar: 'size-14', name: 'text-tv-band', points: 'w-16 text-tv-band' },
  regular: { row: 'gap-4', rank: 'w-12 text-tv-band', avatar: 'size-11', name: 'text-tv-band', points: 'w-16 text-tv-band' },
  compact: { row: 'gap-3', rank: 'w-11 text-tv-field', avatar: 'size-9', name: 'text-tv-field', points: 'w-12 text-tv-field' },
  tiny: { row: 'gap-2.5', rank: 'w-9 text-tv-floor', avatar: 'size-7', name: 'text-tv-floor', points: 'w-10 text-tv-floor' },
}

/**
 * Everyone past the leader's column, in the rows and columns `fit` gives the
 * room beside it, filled top to bottom so the ranking reads down, then
 * across. Plain rows on the ground: no cards, no bars. When even the smallest
 * rows can't hold everyone, the last line says how many more there are.
 */
function Field({
  rows,
  fit,
  width,
  out,
  gains,
}: {
  rows: Ranked[]
  fit: FieldFit
  width: number
  out: ReadonlySet<string>
  gains: Gains
}) {
  const style = FIELD_STYLE[fit.layout.kind]
  const shown = rows.slice(0, fit.shown)
  const more = rows.length - shown.length
  return (
    <ol
      className="grid shrink-0 grid-flow-col"
      style={{
        width,
        gridTemplateColumns: `repeat(${fit.columns}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${fit.perColumn}, ${fit.layout.height}px)`,
        rowGap: fit.layout.gap,
        columnGap: COLUMN_GAP,
      }}
    >
      <AnimatePresence initial={false}>
        {shown.map((row) => (
          <motion.li
            key={row.player_id}
            layout="position"
            data-fit="row"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={spring}
            className={cn('relative flex min-w-0 items-center', style.row)}
          >
            <span className={cn('shrink-0 text-right tv-num text-paper-3', style.rank)}>{row.rank}</span>
            <Avatar name={row.name} playerId={row.player_id} out={out.has(row.player_id)} className={style.avatar} />
            <span className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className={cn('min-w-0 truncate tv-num', style.name)}>{row.name}</span>
              {out.has(row.player_id) && <OutWord />}
            </span>
            <Points value={row.points} className={cn('shrink-0 text-right tv-num', style.points)} />
            <GainBubble gain={gains[row.player_id]} className="-top-3 right-0" />
          </motion.li>
        ))}
      </AnimatePresence>
      {more > 0 && (
        <li data-fit="row" className={cn('flex items-center tv-num text-paper-2', style.name)}>
          and {more} more
        </li>
      )}
    </ol>
  )
}

/** The page's own address, for the join lines: a join address never comes from a hard-coded URL. */
const host = () => (typeof window === 'undefined' ? '' : window.location.host)

/**
 * The join block: the QR code on paper, scanned from across the room, and
 * the code for typing. Kept mounted out of sight while the join line stands
 * in for it, so its height stays known.
 */
function JoinBlock({ ref, joinCode, hidden }: { ref: Ref<HTMLDivElement>; joinCode: string; hidden: boolean }) {
  return (
    <div
      ref={ref}
      data-fit={hidden ? undefined : 'invite'}
      aria-hidden={hidden || undefined}
      className={cn('flex w-max shrink-0 items-center gap-10 short:gap-7 low:gap-6', hidden && 'invisible absolute bottom-0 left-0')}
    >
      {/* One step smaller on a low screen (720p, 768p), so the code still fits a big party's board there. */}
      <div className="shrink-0 rounded-tile bg-paper p-5 text-ink short:p-4 low:p-3">
        <QRCodeSVG value={joinUrl(joinCode)} size={232} level="M" bgColor="transparent" fgColor="currentColor" className="short:size-44 low:size-32" />
      </div>
      <div className="min-w-0">
        <p className="text-tv-field font-bold short:text-tv-body low:text-tv-tab">Scan to join</p>
        <p className="mt-2 text-tv-body text-paper-2 short:mt-1 short:text-tv-tab low:text-tv-floor">or enter the code</p>
        <p className="font-mono text-tv-code font-black tracking-[0.02em] short:text-tv-question low:text-tv-answer low:leading-none">{joinCode}</p>
        <p className="text-tv-body text-paper-2 [overflow-wrap:anywhere] short:text-tv-tab low:text-tv-floor">at {host()}</p>
      </div>
    </div>
  )
}

/**
 * The join block's short form, when the field needs its room: "Join with
 * HURRA30" over "at hurra.party". The address has a line of its own, so it is
 * never cut, and the form is as high at every width (the board's split is
 * chosen by its height, so a height that changed with the split could flip
 * the board back and forth).
 */
function JoinLine({ ref, joinCode, hidden }: { ref: Ref<HTMLDivElement>; joinCode: string; hidden: boolean }) {
  return (
    <div
      ref={ref}
      data-fit={hidden ? undefined : 'join-line'}
      aria-hidden={hidden || undefined}
      className={cn(
        'grid min-w-0 shrink-0 text-tv-body text-paper-2 short:text-tv-tab',
        hidden && 'invisible absolute inset-x-0 bottom-0',
      )}
    >
      <span className="flex items-baseline gap-4 whitespace-nowrap short:gap-3">
        Join with
        <span className="font-mono text-tv-band font-black tracking-[0.02em] text-paper short:text-tv-field">{joinCode}</span>
      </span>
      <span className="min-w-0 [overflow-wrap:anywhere]">at {host()}</span>
    </div>
  )
}
