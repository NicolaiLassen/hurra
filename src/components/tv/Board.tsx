import { CrownIcon } from '@phosphor-icons/react'
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import type { ReactNode, Ref } from 'react'
import Avatar from '@/components/Avatar'
import ProfileBadges from '@/components/ProfileBadges'
import Qr from '@/components/Qr'
import { BADGES_MIN_WIDTH, boardTier, COLUMN_GAP, rowLayout, rowLayoutsFor, type BoardTier, type RowLayout } from '@/components/tv/fit'
import { CARD, spring } from '@/components/tv/look'
import { GainBubble, Points } from '@/components/tv/parts'
import type { Gains } from '@/components/tv/useGains'
import type { ScoreRow } from '@/lib/types'
import { joinUrl } from '@/lib/urls'
import { useElementSize } from '@/lib/useElementSize'
import { cn } from '@/lib/utils'

export type Ranked = ScoreRow & { rank: number }

/** The space between the podium and the status cards beside it (the strip's pl-8), in px. */
const BAND_GAP = 32
/** The space between a small party's podium and what stands beside it (gap-24), in px. */
const HERO_GAP = 96
/** A single column of rows is this wide at least (max-w-3xl), or as wide as the podium over it. */
const ONE_COLUMN_MIN = 768

/**
 * The podium and the day's standings: between games, at the end of the night,
 * and while a game without a TV view of its own is on the stage. The party's
 * size picks the composition (`boardTier` in fit.ts), always centred in the
 * room under the header:
 * - 1 to 3 guests: a big podium, and beside it a column with the big join
 *   card (`invite`, while joining is open) over the games as chips; without
 *   the join card, the status cards themselves. On a narrow screen the podium
 *   narrows, never the join card, so its QR code stays whole.
 * - 4 and up: the podium over the rows, both centred; the status cards stand
 *   on the podium's floor at the right edge, where the rows and the header's
 *   join card end. The podium narrows while they show, and moves left when
 *   they need more room; a single column of rows stays under it.
 * `strip` draws the status cards in the room it is given (px), so the rows
 * keep their height on a 1440 by 900 screen with 45 guests, or, under the
 * join card, only the chips that fit the height the card leaves
 * (`chipsHeight`), so the chips never push that column out of the room.
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
  /** The join code for a small party's big join card; the header then leaves its own out (`joinCardPlace` in scene.ts). */
  invite?: string | null
}) {
  const tier = boardTier(rows.length)
  const few = tier === 'few'
  const inviting = few && invite !== null
  const [areaRef, area] = useElementSize<HTMLDivElement>()
  const [bandRef, band] = useElementSize<HTMLDivElement>()
  const [gapRef, gap] = useElementSize<HTMLDivElement>()
  const [podiumRef, podium] = useElementSize<HTMLDivElement>()
  const [leftRef, left] = useElementSize<HTMLDivElement>()
  const [inviteRef, inviteBox] = useElementSize<HTMLDivElement>()
  const hasPodium = rows.length > 0
  const rest = rows.slice(3)

  // Under the join card the chips get its width; anywhere else the cards get what the podium leaves.
  const room = inviting ? inviteBox.width : Math.max(0, band.width - (hasPodium ? podium.width + (few ? HERO_GAP : BAND_GAP) : 0))
  // All measured first, so the cards never flash in at the wrong count.
  const measured = band.width > 0 && (!hasPodium || podium.width > 0) && (!inviting || (inviteBox.width > 0 && area.height > 0))
  // Where the podium's middle is, so a single column of rows stands under it even when the cards push it left.
  const podiumMiddle = podium.width > 0 ? left.width + podium.width / 2 : area.width / 2

  return (
    <LayoutGroup>
      <div ref={areaRef} className="flex min-h-0 flex-1 flex-col">
        {/* Centred in the room under the header; from the top only if it ever needs all of it. */}
        <div className="my-auto flex flex-col">
          {/* One element for every size of party, so the podium stays put (and keeps its state) as the party grows. */}
          <div
            ref={bandRef}
            className={few ? 'flex items-end justify-center gap-24' : 'grid grid-cols-[1fr_auto_1fr] items-end'}
          >
            {/* Equal sides keep the podium on the screen's middle, over the rows; wide status cards push it left. */}
            {!few && <div ref={leftRef} aria-hidden className="col-start-1 row-start-1" />}
            {hasPodium && (
              <Podium
                ref={podiumRef}
                rows={rows.slice(0, 3)}
                gains={gains}
                size={PODIUM_SIZE[tier]}
                narrow={!few && !!strip}
                className={few ? 'min-w-0' : 'col-start-2 row-start-1'}
              />
            )}
            {few
              ? (inviting || strip) && (
                  <div className="flex shrink-0 flex-col">
                    {inviting && (
                      // The card and the space under it, measured, so the chips know the height left on either screen.
                      <div ref={inviteRef}>
                        <JoinInvite joinCode={invite} />
                        {strip && <div aria-hidden className="h-6 short:h-4" />}
                      </div>
                    )}
                    {strip && measured && strip(room, inviting ? Math.max(0, area.height - inviteBox.height) : undefined)}
                  </div>
                )
              : strip && measured && <div className="col-start-3 row-start-1 flex justify-end pl-8">{strip(room)}</div>}
          </div>
          {rest.length > 0 && (
            <>
              {/* The space over the rows, measured, so the rows know their room on either screen. */}
              <div ref={gapRef} aria-hidden className="h-8 shrink-0 short:h-6" />
              {area.height > 0 && band.height > 0 && gap.height > 0 && (
                <Standings
                  rows={rest}
                  leaderPoints={rows[0].points}
                  gains={gains}
                  width={area.width}
                  height={Math.max(0, area.height - band.height - gap.height)}
                  layouts={rowLayoutsFor(tier)}
                  oneColumn={{ width: Math.max(ONE_COLUMN_MIN, podium.width), middle: podiumMiddle }}
                />
              )}
            </>
          )}
        </div>
      </div>
    </LayoutGroup>
  )
}

type PodiumSize = 'hero' | 'roomy' | 'regular' | 'compact'

/** Big for a small party, smaller for a big one, but never so small it stops reading from across the room. */
const PODIUM_SIZE: Record<BoardTier, PodiumSize> = { few: 'hero', small: 'roomy', medium: 'regular', large: 'compact' }

// Left to right: 2nd, 1st, 3rd.
const PODIUM_SLOTS = [1, 0, 2]
/** Gold for the leader, then paper and paper-2: the steps are told apart by value. */
const PLACE_TONE = [
  { ring: 'ring-primary', points: 'text-primary', pedestal: 'from-primary/40' },
  { ring: 'ring-paper/80', points: 'text-paper', pedestal: 'from-paper/25' },
  { ring: 'ring-paper-2/80', points: 'text-paper-2', pedestal: 'from-paper-2/30' },
]

/** A podium size: first place first in `avatars` and `pedestals`, with `short:` for 1440 by 900. */
type PodiumLook = {
  gap: string
  step: string
  crown: string
  avatars: readonly [string, string, string]
  name: string
  points: string
  badges: string
  floor: string
  pedestals: readonly [string, string, string]
  rank: string
}

const REGULAR: PodiumLook = {
  gap: 'gap-6 lg:gap-12',
  step: 'w-56 lg:w-72',
  crown: 'size-12 short:size-8',
  avatars: [
    'size-24 text-4xl ring-4 lg:size-28 short:size-16 short:text-2xl',
    'size-20 text-3xl ring-4 lg:size-24 short:size-14 short:text-xl',
    'size-20 text-3xl ring-4 lg:size-24 short:size-14 short:text-xl',
  ],
  name: 'mt-3 text-2xl lg:text-3xl short:mt-1 short:text-xl',
  points: 'text-4xl short:text-3xl',
  badges: 'mt-2 short:hidden',
  floor: 'mt-3 short:mt-2',
  pedestals: ['h-24 lg:h-28 short:h-12', 'h-16 lg:h-20 short:h-8', 'h-10 lg:h-14 short:h-6'],
  rank: 'text-4xl lg:text-5xl short:text-2xl',
}

/** Beside the status cards: slimmer steps leave them room. */
const NARROW = { gap: 'gap-6', step: 'w-48 lg:w-56' }

const PODIUM: Record<PodiumSize, PodiumLook> = {
  hero: {
    gap: 'gap-16 short:gap-8',
    step: 'w-80 short:w-60',
    crown: 'size-16 short:size-12',
    avatars: [
      'size-36 text-5xl ring-[6px] short:size-28 short:text-4xl',
      'size-28 text-4xl ring-4 short:size-20 short:text-3xl',
      'size-28 text-4xl ring-4 short:size-20 short:text-3xl',
    ],
    name: 'mt-4 text-4xl short:mt-2 short:text-3xl',
    points: 'text-6xl short:text-5xl',
    badges: 'mt-3 short:hidden',
    floor: 'mt-4 short:mt-3',
    pedestals: ['h-36 short:h-24', 'h-24 short:h-16', 'h-16 short:h-10'],
    rank: 'text-6xl short:text-5xl',
  },
  // A small party: its few rows leave room, so it stands a little taller than the
  // regular one, and on 1440 by 900 it keeps a size that outweighs the rows under it.
  roomy: {
    ...REGULAR,
    crown: 'size-12 short:size-10',
    avatars: [
      'size-24 text-4xl ring-4 lg:size-28 short:size-24',
      'size-20 text-3xl ring-4 lg:size-24 short:size-20',
      'size-20 text-3xl ring-4 lg:size-24 short:size-20',
    ],
    name: 'mt-3 text-2xl lg:text-4xl short:mt-2 short:text-3xl',
    points: 'text-4xl lg:text-5xl',
    floor: 'mt-3',
    pedestals: ['h-24 lg:h-28 short:h-16', 'h-16 lg:h-20 short:h-12', 'h-10 lg:h-14 short:h-8'],
    rank: 'text-4xl lg:text-5xl short:text-4xl',
  },
  regular: REGULAR,
  // A big party: smaller than the regular one but still read from across the room,
  // so the rows below keep a readable size; on 1440 by 900 the same as the others.
  compact: {
    gap: 'gap-6',
    step: 'w-56',
    crown: 'size-10 short:size-8',
    avatars: [
      'size-24 text-4xl ring-4 short:size-16 short:text-2xl',
      'size-20 text-3xl ring-4 short:size-14 short:text-xl',
      'size-20 text-3xl ring-4 short:size-14 short:text-xl',
    ],
    name: 'mt-2 text-2xl short:mt-1 short:text-xl',
    points: 'text-4xl short:text-3xl',
    badges: 'hidden',
    floor: 'mt-3 short:mt-2',
    pedestals: ['h-16 short:h-12', 'h-12 short:h-8', 'h-8 short:h-6'],
    rank: 'text-4xl short:text-2xl',
  },
}

/** The top three on their steps, at the size the party's composition gives them. */
function Podium({
  ref,
  rows,
  gains,
  size,
  narrow,
  className,
}: {
  ref: Ref<HTMLDivElement>
  rows: Ranked[]
  gains: Gains
  size: PodiumSize
  narrow: boolean
  className?: string
}) {
  const look = PODIUM[size]
  const { gap, step } = narrow ? NARROW : look
  return (
    <section ref={ref} className={cn('flex w-fit items-end justify-center', gap, className)}>
      {PODIUM_SLOTS.filter((slot) => slot < rows.length).map((slot) => {
        const row = rows[slot]
        // Ties share a place: a guest level with the leader is gold and crowned on any step.
        const tone = PLACE_TONE[Math.min(row.rank, 3) - 1]
        return (
          <div key={slot} data-fit="podium" className={cn('flex min-w-0 flex-col items-center', step)}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={row.player_id}
                initial={{ opacity: 0, y: 40, scale: 0.8 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -30, scale: 0.8 }}
                transition={spring}
                className="flex w-full flex-col items-center"
              >
                {row.rank === 1 && (
                  <CrownIcon data-crown="" weight="fill" className={cn('mb-1 text-primary drop-shadow-[0_0_20px_rgb(245_197_66/0.6)]', look.crown)} />
                )}
                <div className="relative">
                  <Avatar name={row.name} className={cn(look.avatars[slot], tone.ring)} />
                  <GainBubble gain={gains[row.player_id]} className="-top-2 -right-8" />
                </div>
                <p className={cn('w-full truncate text-center font-bold', look.name)}>{row.name}</p>
                <Points value={row.points} className={cn('font-black', look.points, tone.points)} />
                <ProfileBadges profile={row.profile} size="lg" className={cn('justify-center', look.badges)} />
              </motion.div>
            </AnimatePresence>
            <div
              className={cn(
                'grid w-full place-items-center rounded-t-3xl bg-linear-to-b to-transparent',
                look.floor,
                look.pedestals[slot],
                tone.pedestal,
              )}
            >
              <span className={cn('font-black opacity-70', look.rank, tone.points)}>{row.rank}</span>
            </div>
          </div>
        )
      })}
    </section>
  )
}

/** A small party's join card, big enough to scan from across the room. */
function JoinInvite({ joinCode }: { joinCode: string }) {
  return (
    <section
      data-fit="invite"
      className={cn(CARD, 'flex flex-col items-center gap-5 p-7 text-center short:gap-4 short:p-5 short:[&_svg]:size-54')}
    >
      <Qr value={joinUrl(joinCode)} size={256} />
      <div>
        <p className="text-2xl text-muted-foreground short:text-xl">Join the game</p>
        <p className="mt-1 font-mono text-5xl font-black tracking-widest text-primary short:text-4xl">{joinCode}</p>
      </div>
    </section>
  )
}

const ROW_STYLE: Record<RowLayout['kind'], { row: string; rank: string; avatar: string; name: string; points: string; bar: string; details: boolean }> = {
  large: {
    row: 'h-20 gap-5 rounded-3xl px-6',
    rank: 'w-12 text-3xl',
    avatar: 'size-14 text-lg',
    name: 'text-3xl leading-tight',
    points: 'text-4xl',
    bar: 'mt-2 h-2',
    details: true,
  },
  regular: {
    row: 'h-14 gap-4 rounded-2xl px-5',
    rank: 'w-9 text-2xl',
    avatar: 'size-10 text-base',
    name: 'text-2xl leading-tight',
    points: 'text-3xl',
    bar: 'mt-1 h-1.5',
    details: true,
  },
  compact: { row: 'h-10 gap-3 rounded-2xl px-4', rank: 'w-7 text-lg', avatar: 'size-7 text-xs', name: 'text-lg', points: 'text-xl', bar: '', details: false },
  tiny: { row: 'h-8 gap-2 rounded-xl px-3', rank: 'w-6 text-base', avatar: 'size-6 text-[0.6rem]', name: 'text-base', points: 'text-lg', bar: '', details: false },
}

/**
 * Everyone below the podium, in as many rows and columns as the `width` by
 * `height` left under it needs (fit.ts), at their own height, so the board can
 * centre them with the podium. Several columns fill the width; a single one
 * is as wide as the podium and stands under its `middle` (px from the left).
 */
function Standings({
  rows,
  leaderPoints,
  gains,
  width,
  height,
  layouts,
  oneColumn,
}: {
  rows: Ranked[]
  leaderPoints: number
  gains: Gains
  width: number
  height: number
  layouts: readonly RowLayout[]
  oneColumn: { width: number; middle: number }
}) {
  const { layout, columns } = rowLayout(rows.length, width, height, layouts)
  const style = ROW_STYLE[layout.kind]
  const columnWidth = columns === 1 ? Math.min(width, oneColumn.width) : (width - (columns - 1) * COLUMN_GAP) / columns
  const badges = style.details && columnWidth >= BADGES_MIN_WIDTH
  // Fill columns top to bottom so the ranking reads down, then across.
  const perColumn = Math.ceil(rows.length / columns)
  const marginLeft = Math.min(Math.max(0, oneColumn.middle - columnWidth / 2), width - columnWidth)

  return (
    <ol
      className="grid grid-flow-col gap-x-6"
      style={{
        ...(columns === 1 ? { width: columnWidth, marginLeft } : undefined),
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${perColumn}, auto)`,
        rowGap: layout.gap,
      }}
    >
      <AnimatePresence initial={false}>
        {rows.map((row) => (
          <motion.li
            key={row.player_id}
            layout
            data-fit="row"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={spring}
            className={cn('relative flex items-center bg-card/80 ring-1 ring-foreground/10 backdrop-blur', style.row)}
          >
            <span className={cn('text-right font-bold text-muted-foreground tabular-nums', style.rank)}>{row.rank}</span>
            <Avatar name={row.name} className={style.avatar} />
            <div className="min-w-0 flex-1">
              <p className="flex min-w-0 items-center gap-2">
                <span className={cn('truncate font-semibold', style.name)}>{row.name}</span>
                {badges && <ProfileBadges profile={row.profile} className="shrink-0 flex-nowrap" />}
              </p>
              {style.details && (
                <div className={cn('overflow-hidden rounded-full bg-white/10', style.bar)}>
                  <motion.div
                    className="h-full rounded-full bg-primary/70"
                    initial={false}
                    animate={{ width: `${leaderPoints > 0 ? (Math.max(0, row.points) / leaderPoints) * 100 : 0}%` }}
                    transition={spring}
                  />
                </div>
              )}
            </div>
            <Points value={row.points} className={cn('font-black', style.points)} />
            <GainBubble gain={gains[row.player_id]} className="-top-3 right-3" />
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  )
}

/** Nobody has joined yet: a big QR code to scan, or why nobody can. */
export function EmptyBoard({ joinCode, open, over }: { joinCode: string; open: boolean; over: boolean }) {
  if (over) return <p className="m-auto text-3xl text-muted-foreground">This party is over.</p>
  if (!open) return <p className="m-auto text-3xl text-muted-foreground">Joining is closed.</p>
  return (
    <div className="m-auto flex flex-col items-center gap-8 text-center">
      <Qr value={joinUrl(joinCode)} size={300} />
      <div>
        <p className="text-5xl font-black">Scan to join</p>
        <p className="mt-3 text-2xl text-muted-foreground">
          or go to <span className="text-foreground">{window.location.host}</span> and enter{' '}
          <span className="font-mono font-bold tracking-widest text-primary">{joinCode}</span>
        </p>
      </div>
    </div>
  )
}
