import { CrownIcon } from '@phosphor-icons/react'
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import type { ReactNode, Ref } from 'react'
import Avatar from '@/components/Avatar'
import ProfileBadges from '@/components/ProfileBadges'
import Qr from '@/components/Qr'
import { BADGES_MIN_WIDTH, BIG_PARTY, COLUMN_GAP, rowLayout } from '@/components/tv/fit'
import { spring } from '@/components/tv/look'
import { GainBubble, Points } from '@/components/tv/parts'
import type { Gains } from '@/components/tv/useGains'
import type { ScoreRow } from '@/lib/types'
import { joinUrl } from '@/lib/urls'
import { useElementSize } from '@/lib/useElementSize'
import { cn } from '@/lib/utils'

export type Ranked = ScoreRow & { rank: number }

/** The space between the podium and the status cards beside it (gap-8), in px. */
const BAND_GAP = 32

/**
 * The podium and the day's standings: between games, at the end of the night,
 * and while a game without a TV view of its own is on the stage. `strip` draws
 * the status cards beside the podium, in the room it is given (px), so the
 * standings below keep their height on a 1440 by 900 screen with 45 guests.
 */
export default function Board({
  rows,
  gains,
  strip,
}: {
  rows: Ranked[]
  gains: Gains
  strip?: (room: number) => ReactNode
}) {
  const [bandRef, band] = useElementSize<HTMLDivElement>()
  const [podiumRef, podium] = useElementSize<HTMLDivElement>()
  const hasPodium = rows.length > 0
  const room = Math.max(0, band.width - (hasPodium ? podium.width + BAND_GAP : 0))
  // Both measured first, so the cards never flash in at the wrong count.
  const measured = band.width > 0 && (!hasPodium || podium.width > 0)

  return (
    <LayoutGroup>
      <div ref={bandRef} className="flex shrink-0 items-end gap-8">
        {hasPodium && (
          <div className="flex min-w-0 flex-1 justify-center">
            <Podium ref={podiumRef} rows={rows.slice(0, 3)} gains={gains} compact={rows.length > BIG_PARTY} narrow={!!strip} />
          </div>
        )}
        {strip && measured && strip(room)}
      </div>
      {rows.length > 3 && <Standings rows={rows.slice(3)} leaderPoints={rows[0].points} gains={gains} />}
    </LayoutGroup>
  )
}

// Left to right: 2nd, 1st, 3rd.
const PODIUM_SLOTS = [1, 0, 2]
const PODIUM_STYLE = [
  {
    avatar: 'size-24 text-4xl ring-4 ring-primary lg:size-28 short:size-16 short:text-2xl',
    points: 'text-primary',
    pedestal: 'h-24 from-primary/40 lg:h-28 short:h-12',
  },
  {
    avatar: 'size-20 text-3xl ring-4 ring-slate-300/80 lg:size-24 short:size-14 short:text-xl',
    points: 'text-slate-200',
    pedestal: 'h-16 from-slate-300/25 lg:h-20 short:h-8',
  },
  {
    avatar: 'size-20 text-3xl ring-4 ring-amber-600/80 lg:size-24 short:size-14 short:text-xl',
    points: 'text-amber-500',
    pedestal: 'h-10 from-amber-600/30 lg:h-14 short:h-6',
  },
]

/**
 * The top three. `compact` uses the short-screen sizes on any screen, to leave
 * room for a big party's list; `narrow` slims the steps, to leave room for the
 * status cards beside it.
 */
function Podium({
  ref,
  rows,
  gains,
  compact,
  narrow,
}: {
  ref: Ref<HTMLDivElement>
  rows: Ranked[]
  gains: Gains
  compact: boolean
  narrow: boolean
}) {
  return (
    <section
      ref={ref}
      data-short={compact || undefined}
      className={cn('flex w-fit items-end justify-center', narrow ? 'gap-6' : 'gap-6 lg:gap-12')}
    >
      {PODIUM_SLOTS.filter((slot) => slot < rows.length).map((slot) => {
        const row = rows[slot]
        const style = PODIUM_STYLE[slot]
        return (
          <div key={slot} data-fit="podium" className={cn('flex flex-col items-center', narrow ? 'w-48 lg:w-56' : 'w-56 lg:w-72')}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={row.player_id}
                initial={{ opacity: 0, y: 40, scale: 0.8 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -30, scale: 0.8 }}
                transition={spring}
                className="flex w-full flex-col items-center"
              >
                {slot === 0 && (
                  <CrownIcon
                    weight="fill"
                    className="mb-1 size-12 text-primary short:size-8 drop-shadow-[0_0_20px_rgb(245_197_66/0.6)]"
                  />
                )}
                <div className="relative">
                  <Avatar name={row.name} className={style.avatar} />
                  <GainBubble gain={gains[row.player_id]} className="-top-2 -right-8" />
                </div>
                <p className="mt-3 w-full truncate text-center text-2xl font-bold lg:text-3xl short:mt-1 short:text-xl">
                  {row.name}
                </p>
                <Points value={row.points} className={cn('text-4xl font-black short:text-3xl', style.points)} />
                <ProfileBadges profile={row.profile} size="lg" className="mt-2 justify-center short:hidden" />
              </motion.div>
            </AnimatePresence>
            <div
              className={cn(
                'mt-3 grid w-full place-items-center rounded-t-3xl short:mt-2 bg-linear-to-b to-transparent',
                style.pedestal,
              )}
            >
              <span className={cn('text-4xl font-black opacity-70 lg:text-5xl short:text-2xl', style.points)}>
                {row.rank}
              </span>
            </div>
          </div>
        )
      })}
    </section>
  )
}

const ROW_STYLE = {
  regular: { row: 'h-14 gap-4 rounded-2xl px-5', rank: 'w-9 text-2xl', avatar: 'size-10 text-base', name: 'text-2xl leading-tight', points: 'text-3xl', details: true },
  compact: { row: 'h-10 gap-3 rounded-2xl px-4', rank: 'w-7 text-lg', avatar: 'size-7 text-xs', name: 'text-lg', points: 'text-xl', details: false },
  tiny: { row: 'h-8 gap-2 rounded-xl px-3', rank: 'w-6 text-base', avatar: 'size-6 text-[0.6rem]', name: 'text-base', points: 'text-lg', details: false },
}

/** Everyone below the podium, in as many rows and columns as the space left needs (fit.ts). */
function Standings({ rows, leaderPoints, gains }: { rows: Ranked[]; leaderPoints: number; gains: Gains }) {
  const [ref, { width, height }] = useElementSize<HTMLDivElement>()
  const { layout, columns } = rowLayout(rows.length, width, height)
  const style = ROW_STYLE[layout.kind]
  const badges = style.details && (width - (columns - 1) * COLUMN_GAP) / columns >= BADGES_MIN_WIDTH
  // Fill columns top to bottom so the ranking reads down, then across.
  const perColumn = Math.ceil(rows.length / columns)

  return (
    <div ref={ref} className="min-h-0 flex-1">
      {height > 0 && rows.length > 0 && (
        <ol
          className={cn('grid grid-flow-col gap-x-6', columns === 1 && 'mx-auto w-full max-w-3xl')}
          style={{
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
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
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
      )}
    </div>
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
