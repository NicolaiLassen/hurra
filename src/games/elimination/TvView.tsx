import { CrownIcon, DetectiveIcon, SkullIcon, SwordIcon } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import Avatar from '@/components/Avatar'
import AvatarBadge from '@/components/AvatarBadge'
import type { EliminationGame, EliminationPublicState, PublicKnockout } from '@/games/elimination/logic'
import SurvivorMeter from '@/games/elimination/SurvivorMeter'
import type { TvViewProps } from '@/games/types'
import { fitGrid } from '@/lib/fitGrid'
import type { Player } from '@/lib/types'
import { useElementSize } from '@/lib/useElementSize'
import { cn } from '@/lib/utils'

const spring = { type: 'spring', stiffness: 260, damping: 26 } as const

/** The TV while Last one standing is live: who is left, who got whom, the top hunters. */
export default function TvView({ players, publicState }: TvViewProps<EliminationGame>) {
  const { alive, out, winner, knockoutCounts, feed } = publicState
  const dealtIn = players.filter((p) => alive.includes(p.id) || out.includes(p.id))
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? 'Someone'
  const hunters = Object.entries(knockoutCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  return (
    <div className="grid min-h-0 flex-1 gap-8 lg:grid-cols-[1fr_24rem]">
      {/* min-w-0: a long winner name truncates instead of pushing the aside off screen. */}
      <section className="flex min-h-0 min-w-0 flex-col gap-6 short:gap-4">
        {winner ? (
          <div className="flex shrink-0 items-center gap-5">
            <CrownIcon
              weight="duotone"
              className="size-24 shrink-0 text-primary drop-shadow-[0_0_24px_rgb(245_197_66/0.5)] short:size-16"
            />
            <div className="min-w-0">
              <p className="truncate text-6xl font-black short:text-5xl">{nameOf(winner)}</p>
              <p className="text-3xl text-muted-foreground short:text-2xl">is the last one standing!</p>
            </div>
          </div>
        ) : (
          <SurvivorMeter alive={alive.length} total={dealtIn.length} size="lg" className="shrink-0" />
        )}

        <PlayerTiles players={dealtIn} publicState={publicState} nameOf={nameOf} />
      </section>

      <aside className="flex min-h-0 flex-col gap-6 short:gap-4">
        <Panel title="Top hunters" className="shrink-0">
          {hunters.length === 0 && <p className="text-lg text-muted-foreground">Nobody's out yet.</p>}
          <ol className="grid grid-cols-1 gap-2">
            {hunters.map(([id, count], i) => (
              <motion.li key={id} layout transition={spring} className="flex items-center gap-3">
                <span className="w-6 text-right text-xl font-bold text-muted-foreground tabular-nums">{i + 1}</span>
                <Avatar name={nameOf(id)} className="size-10 text-sm" />
                <span className="flex-1 truncate text-xl font-semibold">{nameOf(id)}</span>
                <span className="text-2xl font-black text-primary tabular-nums">{count}</span>
              </motion.li>
            ))}
          </ol>
        </Panel>

        {/* Shrinks (and shows three instead of five) when the screen is short, never past the board. */}
        <Panel title="Latest" className="min-h-0 overflow-hidden">
          {feed.length === 0 && <p className="text-lg text-muted-foreground">Waiting for the first knockout…</p>}
          <ul className="grid grid-cols-1 gap-3">
            <AnimatePresence initial={false}>
              {feed.slice(0, 5).map((k) => (
                <motion.li
                  key={`${k.by}-${k.target}`}
                  layout
                  initial={{ opacity: 0, x: 30 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={spring}
                  className="flex gap-3 short:nth-[n+4]:hidden"
                >
                  <MethodIcon method={k.method} className="mt-1 size-6 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-lg font-semibold">{describe(k, nameOf)}</p>
                    {k.task && <p className="truncate text-muted-foreground">“{k.task}”</p>}
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

// Tile sizes for the player grid, largest first (rem): the biggest one whose
// rows all fit the space left on the screen is used, so 8 players get big
// tiles and a party of 45 still fits on a 1080p TV as chips.
const TILE_SIZES = [
  { size: 'large', minWidth: 10, height: 9.5, gap: 0.75 },
  { size: 'medium', minWidth: 7.75, height: 8, gap: 0.75 },
  { size: 'chip', minWidth: 12.5, height: 3.25, gap: 0.5 },
  { size: 'mini', minWidth: 9.5, height: 2.5, gap: 0.5 },
] as const

type TileSize = (typeof TILE_SIZES)[number]['size']

// Heights match TILE_SIZES, so the fit maths holds.
const TILE_STYLE: Record<
  TileSize,
  { tile: string; avatar: string; badge: 'sm' | 'md' | 'lg'; name: string; stacked: boolean; byName: boolean }
> = {
  large: { tile: 'h-38 flex-col justify-center gap-2 p-3', avatar: 'size-16 text-xl', badge: 'lg', name: 'text-lg', stacked: true, byName: true },
  medium: { tile: 'h-32 flex-col justify-center gap-1.5 p-2.5', avatar: 'size-12 text-base', badge: 'md', name: 'text-base', stacked: true, byName: true },
  chip: { tile: 'h-13 gap-3 px-3', avatar: 'size-9 text-sm', badge: 'sm', name: 'text-base', stacked: false, byName: true },
  mini: { tile: 'h-10 gap-2 px-2.5', avatar: 'size-7 text-xs', badge: 'sm', name: 'text-sm', stacked: false, byName: false },
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
  const fit = fitGrid(
    players.length,
    width,
    height,
    TILE_SIZES.map((t) => ({ ...t, minWidth: t.minWidth * rem, height: t.height * rem, gap: t.gap * rem })),
  )
  // Even the smallest tiles don't fit: keep the rows that do and spread everyone
  // over more, narrower columns, so nobody still in drops off the screen. Those
  // squeezed tiles drop the avatar, so the names keep their room.
  const rowsThatFit = Math.max(1, Math.floor((height + fit.option.gap) / (fit.option.height + fit.option.gap)))
  const columns = fit.fits ? fit.columns : Math.ceil(players.length / rowsThatFit)
  const squeezed = columns > fit.columns
  const { outBy, winner, feed } = publicState
  // Players still in first, then those who are out, latest first: each knockout
  // moves one tile (animated) from the end of the first group to the start of the
  // second.
  const latest = feed.map((k) => k.target)
  const outOrder = (id: string) => {
    const i = latest.indexOf(id)
    return i === -1 ? latest.length + players.findIndex((p) => p.id === id) : i
  }
  const ordered = [
    ...players.filter((p) => !outBy[p.id]),
    ...players.filter((p) => outBy[p.id]).sort((a, b) => outOrder(a.id) - outOrder(b.id)),
  ]
  const style = TILE_STYLE[fit.option.size]

  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-hidden">
      {width > 0 && (
        <ul
          className="grid content-start"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: fit.option.gap }}
        >
          {ordered.map((p) => {
            const knockedOut = outBy[p.id]
            const isWinner = p.id === winner
            return (
              <motion.li
                key={p.id}
                layout
                transition={spring}
                className={cn(
                  'relative flex min-w-0 items-center rounded-2xl ring-1 transition-[opacity,filter,background-color] duration-700',
                  style.tile,
                  knockedOut ? 'bg-card/40 opacity-50 ring-foreground/5 grayscale' : 'bg-card/80 ring-foreground/10',
                  isWinner && 'bg-primary/15 ring-2 ring-primary',
                )}
              >
                <div className={cn('relative shrink-0', squeezed && 'hidden')}>
                  <Avatar name={p.name} className={style.avatar} />
                  {isWinner && <AvatarBadge icon={CrownIcon} tone="gold" size={style.badge} />}
                  {knockedOut && <AvatarBadge icon={SkullIcon} tone="red" size={style.badge} />}
                </div>
                <div className={cn('min-w-0', style.stacked ? 'w-full text-center' : 'flex-1')}>
                  <p className={cn('truncate font-semibold', style.name, knockedOut && 'line-through decoration-2')}>
                    {p.name}
                  </p>
                  {knockedOut && style.byName && (
                    <p
                      className={cn(
                        'flex max-w-full items-center gap-1 text-xs text-muted-foreground',
                        style.stacked && 'justify-center',
                      )}
                    >
                      <MethodIcon method={knockedOut.method} className="size-3.5 shrink-0" />
                      <span className="truncate">{nameOf(knockedOut.by)}</span>
                    </p>
                  )}
                </div>
                {knockedOut && !style.byName && <MethodIcon method={knockedOut.method} className="size-3.5 shrink-0" />}
              </motion.li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function describe(k: PublicKnockout, nameOf: (id: string) => string) {
  return k.method === 'catch' ? `${nameOf(k.by)} caught ${nameOf(k.target)}` : `${nameOf(k.by)} got ${nameOf(k.target)}`
}

function MethodIcon({ method, className }: { method: PublicKnockout['method']; className?: string }) {
  return method === 'catch' ? (
    <DetectiveIcon weight="duotone" className={cn('text-confetti-teal', className)} />
  ) : (
    <SwordIcon weight="duotone" className={cn('text-confetti-pink', className)} />
  )
}

function Panel({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn('rounded-3xl bg-card/80 p-6 ring-1 ring-foreground/10 backdrop-blur short:p-5', className)}>
      <h2 className="mb-4 text-sm font-semibold tracking-widest text-muted-foreground uppercase short:mb-3">{title}</h2>
      {children}
    </section>
  )
}
