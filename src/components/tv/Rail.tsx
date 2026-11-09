import { TrophyIcon } from '@phosphor-icons/react'
import { motion } from 'motion/react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import Avatar from '@/components/Avatar'
import RankBadge from '@/components/RankBadge'
import type { Ranked } from '@/components/tv/Board'
import { ChipRow, FinishedChip, LiveChip } from '@/components/tv/Chips'
import { cardsThatStack } from '@/components/tv/fit'
import { CARD, RAIL, spring } from '@/components/tv/look'
import { Eyebrow, GainBubble, Points } from '@/components/tv/parts'
import StatusCard from '@/components/tv/StatusCard'
import type { Gains } from '@/components/tv/useGains'
import type { Player, SessionGame } from '@/lib/types'
import { useElementSize } from '@/lib/useElementSize'
import { cn } from '@/lib/utils'

/** The room between the cards in the rail (gap-4), in px. */
const STACK_GAP = 16
/** Finished chips shown in the rail at most: the newest. */
const FINISHED_CHIPS = 3

/**
 * The right column while a game holds the stage (docs/engine-v2.md, 7.2): the
 * day's top 5 with gain bubbles, the games running in the background (each its
 * own card, as many as fit, the rest as Live chips), then the games that
 * finished lately as chips.
 */
export default function Rail({
  top,
  gains,
  running,
  finished,
  players,
}: {
  top: Ranked[]
  gains: Gains
  running: SessionGame[]
  finished: SessionGame[]
  players: Player[]
}) {
  return (
    <aside data-fit="rail" className={cn('flex min-h-0 shrink-0 flex-col gap-4 short:gap-3', RAIL)}>
      <TopFive rows={top} gains={gains} />
      {running.length > 0 && <AlsoRunning games={running} />}
      {finished.length > 0 && (
        <section className="grid shrink-0 gap-2">
          <Eyebrow>Finished</Eyebrow>
          <ChipRow>
            {finished.slice(0, FINISHED_CHIPS).map((game) => (
              <FinishedChip key={game.id} game={game} players={players} />
            ))}
          </ChipRow>
        </section>
      )}
    </aside>
  )
}

function TopFive({ rows, gains }: { rows: Ranked[]; gains: Gains }) {
  return (
    <section className={cn(CARD, 'shrink-0 px-5 py-4 short:px-4 short:py-3')}>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold tracking-widest text-muted-foreground uppercase short:text-xs">
        <TrophyIcon weight="fill" className="text-primary" />
        Top 5
      </h2>
      {rows.length === 0 ? (
        <p className="text-lg text-muted-foreground">Nobody has joined yet</p>
      ) : (
        <ol className="grid grid-cols-1 gap-1.5 short:gap-1">
          {rows.map((row) => (
            <motion.li key={row.player_id} layout transition={spring} className="relative flex h-10 items-center gap-3 short:h-8">
              <RankBadge rank={row.rank} className="size-8 text-sm short:size-7" />
              <Avatar name={row.name} className="size-9 text-sm short:size-7 short:text-xs" />
              <span className="min-w-0 flex-1 truncate text-xl font-semibold short:text-lg">{row.name}</span>
              <Points value={row.points} className="text-2xl font-black text-primary short:text-xl" />
              <GainBubble gain={gains[row.player_id]} className="-top-3 right-0" />
            </motion.li>
          ))}
        </ol>
      )}
    </section>
  )
}

/**
 * The background games' cards, from the top, as many as fit the rail's
 * height; the rest become small Live chips on the label's line, where they
 * cost the cards the least room. Cards that don't fit stay mounted out of
 * sight, so their heights stay known and they come back when there is room
 * again (say once the finished chips go).
 */
function AlsoRunning({ games }: { games: SessionGame[] }) {
  const [regionRef, region] = useElementSize<HTMLDivElement>()
  const [heights, setHeights] = useState<Record<string, number>>({})
  const report = useCallback(
    (id: string, height: number) => setHeights((prev) => (prev[id] === height ? prev : { ...prev, [id]: height })),
    [],
  )
  // The chips sit outside the measured region, so none of its room is held back for them.
  const shown = region.height > 0 ? cardsThatStack(games.map((g) => heights[g.id] ?? 0), region.height, STACK_GAP, 0) : games.length
  const overflow = games.slice(shown)

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Eyebrow className="mr-1">Also running</Eyebrow>
        {overflow.length > 0 && (
          <ul className="contents">
            {overflow.map((game) => (
              <LiveChip key={game.id} game={game} small />
            ))}
          </ul>
        )}
      </div>
      <div ref={regionRef} className="relative min-h-0 flex-1 overflow-hidden">
        <div className="flex flex-col gap-4">
          {games.map((game, i) => (
            <Measured key={game.id} id={game.id} hidden={i >= shown} onHeight={report}>
              <StatusCard game={game} />
            </Measured>
          ))}
        </div>
      </div>
    </section>
  )
}

function Measured({
  id,
  hidden,
  onHeight,
  children,
}: {
  id: string
  hidden: boolean
  onHeight: (id: string, height: number) => void
  children: ReactNode
}) {
  const [ref, size] = useElementSize<HTMLDivElement>()
  useEffect(() => {
    if (size.height > 0) onHeight(id, size.height)
  }, [id, size.height, onHeight])
  return (
    <div ref={ref} data-fit={hidden ? undefined : 'card'} aria-hidden={hidden || undefined} className={cn(hidden && 'invisible absolute inset-x-0 top-0')}>
      {children}
    </div>
  )
}
