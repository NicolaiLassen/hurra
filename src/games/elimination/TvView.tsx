import { CrownIcon, DetectiveIcon, SwordIcon, TrophyIcon } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import Avatar from '@/components/Avatar'
import AvatarBadge from '@/components/AvatarBadge'
import type { EliminationGame, EliminationPublicState, PublicKnockout } from '@/games/elimination/logic'
import { knockoutLine, nameFrom, roundRoster, topHunters } from '@/games/elimination/roster'
import SurvivorMeter from '@/games/elimination/SurvivorMeter'
import { tileLayout, type TileSize } from '@/games/elimination/tiles'
import type { TvViewProps } from '@/games/types'
import type { Player } from '@/lib/types'
import { useElementSize } from '@/lib/useElementSize'
import { cn } from '@/lib/utils'

const spring = { type: 'spring', stiffness: 260, damping: 26 } as const

/** The word beside a knocked-out guest's name: pink, at the TV's floor (28 px, docs/identity.md). */
const OUT_WORD = 'shrink-0 text-tv-floor leading-none font-bold text-pink'

/**
 * The TV while Last one standing holds the stage: who is left, who got whom,
 * the top hunters. With `finished`, the same board is the final screen: the
 * winner under "Final result", or how it stood when the host ended it.
 */
export default function TvView({ players, publicState, finished }: TvViewProps<EliminationGame>) {
  const { winner, feed } = publicState
  // Players still in the party, so the meter and the tiles count the same people.
  const { standing, total } = roundRoster(players, publicState)
  const inRound = new Set([...publicState.alive, ...publicState.out])
  const dealtIn = players.filter((p) => inRound.has(p.id))
  const nameOf = nameFrom(players)
  const hunters = topHunters(publicState, players)

  return (
    <div className="grid min-h-0 flex-1 gap-8 lg:grid-cols-[1fr_24rem]">
      {/* min-w-0: a long winner name truncates instead of pushing the aside off screen. */}
      <section className="flex min-h-0 min-w-0 flex-col gap-6 short:gap-4">
        {winner ? (
          <div className="flex shrink-0 items-center gap-5">
            <CrownIcon
              weight="duotone"
              className="size-24 shrink-0 text-primary drop-shadow-[0_0_24px_color-mix(in_oklab,var(--color-gold)_50%,transparent)] short:size-16"
            />
            <div className="min-w-0">
              {finished && <FinalResult />}
              <p className="truncate text-6xl font-black short:text-5xl">{nameOf(winner)}</p>
              <p className="text-3xl text-muted-foreground short:text-2xl">is the last one standing!</p>
            </div>
          </div>
        ) : finished ? (
          // The host ended it early: how it stood.
          <div className="grid shrink-0 gap-2">
            <FinalResult />
            <SurvivorMeter alive={standing.length} total={total} size="lg" />
          </div>
        ) : (
          <SurvivorMeter alive={standing.length} total={total} size="lg" className="shrink-0" />
        )}

        <PlayerTiles players={dealtIn} publicState={publicState} nameOf={nameOf} />
      </section>

      <aside className="flex min-h-0 flex-col gap-6 short:gap-4">
        <Panel title="Top hunters" className="shrink-0">
          {hunters.length === 0 && <p className="text-lg text-muted-foreground">Nobody's out yet.</p>}
          <ol className="grid grid-cols-1 gap-2">
            {hunters.map(([id, count], i) => {
              // A hunter can be knocked out too: the stripe and the word, as on the tiles.
              const out = Boolean(publicState.outBy[id])
              return (
                <motion.li key={id} layout transition={spring} className="flex items-center gap-3">
                  <span className="w-6 text-right text-xl font-bold text-muted-foreground tabular-nums">{i + 1}</span>
                  <Avatar name={nameOf(id)} out={out} className="size-10" />
                  <span className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="truncate text-xl font-semibold">{nameOf(id)}</span>
                    {out && <span className={OUT_WORD}>Out</span>}
                  </span>
                  <span className="text-2xl font-black text-primary tabular-nums">{count}</span>
                </motion.li>
              )
            })}
          </ol>
        </Panel>

        {/* Takes the room left, never past the board, and shows as many of the latest five as fit
            whole (three at most when the screen is short): one that doesn't fit wraps out of
            sight in the list's second column instead of being cut through. */}
        <Panel title="Latest" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {feed.length === 0 && <p className="text-lg text-muted-foreground">Waiting for the first knockout…</p>}
          <ul className="flex min-h-0 flex-1 flex-col flex-wrap gap-3 overflow-hidden">
            <AnimatePresence initial={false}>
              {feed.slice(0, 5).map((k) => (
                <motion.li
                  key={`${k.by}-${k.target}`}
                  layout
                  initial={{ opacity: 0, x: 30 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={spring}
                  className="flex w-full gap-3 short:nth-[n+4]:hidden"
                >
                  <MethodIcon method={k.method} className="mt-1 size-6 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-lg font-semibold">{knockoutLine(k, nameOf)}</p>
                    {k.task && <p className="line-clamp-2 text-muted-foreground">“{k.task}”</p>}
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </Panel>
      </aside>
    </div>
  )
}

// Heights match TILE_SIZES (src/games/elimination/tiles.ts), so the fit maths
// holds. A tile with `byName` gives a knocked-out guest a second line, which
// the word Out leads: the name keeps the whole first line. A mini tile has one
// line, so the word sits beside the name, in the room the method icon had.
const TILE_STYLE: Record<
  TileSize,
  { tile: string; avatar: string; badge: 'sm' | 'md' | 'lg'; name: string; stacked: boolean; byName: boolean }
> = {
  large: { tile: 'h-38 flex-col justify-center gap-2 p-3', avatar: 'size-16', badge: 'lg', name: 'text-lg', stacked: true, byName: true },
  medium: { tile: 'h-32 flex-col justify-center gap-1.5 p-2.5', avatar: 'size-12', badge: 'md', name: 'text-base', stacked: true, byName: true },
  chip: { tile: 'h-13 gap-3 px-3', avatar: 'size-9', badge: 'sm', name: 'text-base', stacked: false, byName: true },
  mini: { tile: 'h-10 gap-2 px-2.5', avatar: 'size-7', badge: 'sm', name: 'text-sm', stacked: false, byName: false },
}

function PlayerTiles({
  players,
  publicState,
  nameOf,
}: {
  players: Player[]
  publicState: EliminationPublicState
  nameOf: (id: string) => string
}) {
  const [ref, { width, height }] = useElementSize<HTMLDivElement>()
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  const { outBy, winner, feed } = publicState
  // Players still in first, then those who are out, latest first: each knockout
  // moves one tile (animated) from the end of the first group to the start of the
  // second. So when tiles are cut for room (tileLayout), they are those of guests
  // who are out, whole rows at a time.
  const latest = feed.map((k) => k.target)
  const outOrder = (id: string) => {
    const i = latest.indexOf(id)
    return i === -1 ? latest.length + players.findIndex((p) => p.id === id) : i
  }
  const stillIn = players.filter((p) => !outBy[p.id])
  const ordered = [...stillIn, ...players.filter((p) => outBy[p.id]).sort((a, b) => outOrder(a.id) - outOrder(b.id))]
  const { size, gap, columns, squeezed, shown } = tileLayout(ordered.length, stillIn.length, width, height, rem)
  const style = TILE_STYLE[size]

  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-hidden">
      {width > 0 && (
        <ul className="grid content-start" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap }}>
          {ordered.slice(0, shown).map((p) => {
            const knockedOut = outBy[p.id]
            const isWinner = p.id === winner
            return (
              <motion.li
                key={p.id}
                layout
                transition={spring}
                className={cn(
                  'relative flex min-w-0 items-center rounded-2xl ring-1 transition-colors duration-700',
                  style.tile,
                  knockedOut ? 'bg-card/40 ring-foreground/5' : 'bg-card/80 ring-foreground/10',
                  isWinner && 'bg-primary/15 ring-2 ring-primary',
                )}
              >
                <div className={cn('relative shrink-0', squeezed && 'hidden')}>
                  <Avatar name={p.name} out={Boolean(knockedOut)} className={style.avatar} />
                  {isWinner && <AvatarBadge icon={CrownIcon} tone="gold" size={style.badge} />}
                </div>
                <div className={cn('min-w-0', style.stacked ? 'w-full text-center' : 'flex-1')}>
                  {/* The name at full strength, with the word Out by it: the stripe never says Out alone. */}
                  <p className={cn('flex min-w-0 items-baseline gap-2 font-semibold', style.name, style.stacked && 'justify-center')}>
                    <span className="truncate">{p.name}</span>
                    {knockedOut && !style.byName && <span className={OUT_WORD}>Out</span>}
                  </p>
                  {knockedOut && style.byName && (
                    <p
                      className={cn(
                        'flex max-w-full items-center gap-1.5 text-xs text-muted-foreground',
                        style.stacked && 'justify-center',
                      )}
                    >
                      <span className={OUT_WORD}>Out</span>
                      <MethodIcon method={knockedOut.method} className="size-3.5 shrink-0" />
                      <span className="truncate">{nameOf(knockedOut.by)}</span>
                    </p>
                  )}
                </div>
              </motion.li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function MethodIcon({ method, className }: { method: PublicKnockout['method']; className?: string }) {
  return method === 'catch' ? (
    <DetectiveIcon weight="duotone" className={cn('text-confetti-teal', className)} />
  ) : (
    <SwordIcon weight="duotone" className={cn('text-confetti-pink', className)} />
  )
}

function FinalResult() {
  return (
    <p className="flex items-center gap-2 text-xl font-semibold tracking-widest text-primary uppercase short:text-lg">
      <TrophyIcon weight="fill" />
      Final result
    </p>
  )
}

function Panel({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <section className={cn('rounded-3xl bg-card/80 p-6 ring-1 ring-foreground/10 backdrop-blur short:p-5', className)}>
      <h2 className="mb-4 text-sm font-semibold tracking-widest text-muted-foreground uppercase short:mb-3">{title}</h2>
      {children}
    </section>
  )
}
