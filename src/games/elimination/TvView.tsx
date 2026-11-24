import { CrownIcon } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import Avatar from '@/components/Avatar'
import AvatarBadge from '@/components/AvatarBadge'
import { clockTime } from '@/components/tv/clock'
import { lastOneDeck } from '@/components/tv/winnerLines'
import WinnerMoment from '@/components/tv/WinnerMoment'
import type { EliminationGame, EliminationPublicState, PublicKnockout } from '@/games/elimination/logic'
import { nameFrom, roundRoster, topHunters } from '@/games/elimination/roster'
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
 * the top hunters. Once it is over, the winner's screen (WinnerMoment): the
 * winner's colour over the top of the TV, "Hurra for Bo!", their knockouts
 * and the final one at its time, over the night so far. When the host ended
 * it with nobody left alone, the same board under "Final result", as it stood.
 */
export default function TvView({ game, players, publicState, finished, scores, gamePoints }: TvViewProps<EliminationGame>) {
  const { winner, feed } = publicState
  // Players still in the party, so the count and the tiles count the same people.
  const { standing, total } = roundRoster(players, publicState)
  const inRound = new Set([...publicState.alive, ...publicState.out])
  const dealtIn = players.filter((p) => inRound.has(p.id))
  const nameOf = nameFrom(players)
  const hunters = topHunters(publicState, players)
  const champion = winner ? players.find((p) => p.id === winner) : undefined

  if (finished && champion) {
    const final = feed[0]
    return (
      <WinnerMoment
        title={game.title}
        winners={[champion]}
        deck={lastOneDeck(publicState.knockoutCounts[champion.id] ?? 0)}
        last={final ? { at: final.at, text: <Knockout k={final} nameOf={nameOf} task /> } : null}
        scores={scores}
        gamePoints={gamePoints}
      />
    )
  }

  return (
    <div className="grid min-h-0 flex-1 gap-10 lg:grid-cols-[1fr_28rem] short:gap-8 short:lg:grid-cols-[1fr_24rem]">
      <section className="flex min-h-0 min-w-0 flex-col gap-8 short:gap-5">
        <div className="grid shrink-0 gap-3">
          {finished && <p className="on-air text-tv-tab text-paper-2 short:text-tv-floor">Final result</p>}
          <StillStanding alive={standing.length} total={total} />
        </div>
        <PlayerTiles players={dealtIn} publicState={publicState} />
      </section>

      <aside className="flex min-h-0 flex-col gap-6 short:gap-4">
        <Panel title="Top hunters" className="shrink-0">
          {hunters.length === 0 && <p className="text-tv-floor text-paper-2">Nobody is out yet.</p>}
          <ol className="grid grid-cols-1 gap-2.5">
            {hunters.map(([id, count], i) => {
              // A hunter can be knocked out too: the stripe and the word, as on the tiles.
              const out = Boolean(publicState.outBy[id])
              return (
                <motion.li key={id} layout="position" transition={spring} className="flex min-w-0 items-center gap-3">
                  <span className="w-6 shrink-0 text-right tv-num text-tv-floor text-paper-3">{i + 1}</span>
                  <Avatar name={nameOf(id)} playerId={id} out={out} className="size-10" />
                  <span className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="min-w-0 truncate tv-num text-tv-field">{nameOf(id)}</span>
                    {out && <span className={OUT_WORD}>Out</span>}
                  </span>
                  <span className="shrink-0 tv-num text-tv-field text-pink">{count}</span>
                </motion.li>
              )
            })}
          </ol>
        </Panel>

        {/* Takes the room left, never past the board, and shows as many of the latest five as fit
            whole (three at most when the screen is short): one that doesn't fit wraps out of
            sight in the list's second column instead of being cut through. */}
        <Panel title="Latest" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {feed.length === 0 && <p className="text-tv-floor text-paper-2">Waiting for the first knockout</p>}
          <ul className="flex min-h-0 flex-1 flex-col flex-wrap gap-4 overflow-hidden">
            <AnimatePresence initial={false}>
              {feed.slice(0, 5).map((k) => (
                <motion.li
                  key={`${k.by}-${k.target}`}
                  layout="position"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={spring}
                  className="flex w-full gap-3 short:nth-[n+4]:hidden"
                >
                  <time dateTime={new Date(k.at).toISOString()} className="shrink-0 tv-num text-tv-floor text-paper-3">
                    {clockTime(k.at)}
                  </time>
                  <div className="min-w-0 flex-1 text-tv-floor">
                    <p className="font-semibold">
                      <Knockout k={k} nameOf={nameOf} />
                    </p>
                    {k.task && <p className="line-clamp-2 text-paper-2 short:line-clamp-1">“{k.task}”</p>}
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

/** "Bo got Ana", or "Bo caught Ana", with the task once it is no one's secret (`task`). */
function Knockout({ k, nameOf, task = false }: { k: PublicKnockout; nameOf: (id: string) => string; task?: boolean }) {
  return (
    <>
      <strong>{nameOf(k.by)}</strong> {k.method === 'catch' ? 'caught' : 'got'} <strong>{nameOf(k.target)}</strong>
      {task && k.task && <> with “{k.task}”</>}
    </>
  )
}

/**
 * "20 of 24 still standing": the count in the hunt's pink, over one pip per
 * player dealt in, pink while they stand and the rule once they are out.
 */
function StillStanding({ alive, total }: { alive: number; total: number }) {
  return (
    <div className="grid gap-4 short:gap-3" role="img" aria-label={`${alive} of ${total} still standing`}>
      <p className="flex items-baseline gap-4 short:gap-3">
        {/* Re-keyed on every change so the number pops. */}
        <span key={alive} className="inline-block animate-count-pop tv-num text-tv-question text-pink short:text-tv-answer">
          {alive}
        </span>
        <span className="text-tv-name font-bold short:text-tv-band">of {total} still standing</span>
      </p>
      <div className="flex h-3 gap-1.5 short:h-2.5">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={cn('flex-1 transition-colors duration-700', i < alive ? 'bg-pink' : 'bg-rule')} />
        ))}
      </div>
    </div>
  )
}

// Heights match TILE_SIZES (src/games/elimination/tiles.ts), so the fit maths
// holds, with every word at the TV's floor of 28 px. A tile with `byName`
// gives a knocked-out guest's word Out a second line, so the name keeps the
// whole first line (who got them is in Latest). A one-line tile has the word
// beside the name.
const TILE_STYLE: Record<
  TileSize,
  { tile: string; avatar: string; badge: 'sm' | 'md' | 'lg'; stacked: boolean; byName: boolean }
> = {
  large: { tile: 'h-38 flex-col justify-center gap-1.5 p-3', avatar: 'size-14', badge: 'lg', stacked: true, byName: true },
  medium: { tile: 'h-32 flex-col justify-center gap-1 p-2.5', avatar: 'size-11', badge: 'md', stacked: true, byName: true },
  chip: { tile: 'h-13 gap-3 px-3', avatar: 'size-9', badge: 'sm', stacked: false, byName: false },
  mini: { tile: 'h-10 gap-2 px-2.5', avatar: 'size-7', badge: 'sm', stacked: false, byName: false },
}

function PlayerTiles({ players, publicState }: { players: Player[]; publicState: EliminationPublicState }) {
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
            return (
              <motion.li
                key={p.id}
                layout
                transition={spring}
                // Solid tiles for those still standing; the ones who are out lose their tile, not their name.
                className={cn('relative flex min-w-0 items-center rounded-tile transition-colors duration-700', style.tile, knockedOut ? 'bg-ground' : 'bg-raised')}
              >
                <div className={cn('relative shrink-0', squeezed && 'hidden')}>
                  <Avatar name={p.name} playerId={p.id} out={Boolean(knockedOut)} className={style.avatar} />
                  {p.id === winner && <AvatarBadge icon={CrownIcon} tone="gold" size={style.badge} />}
                </div>
                <div className={cn('min-w-0', style.stacked ? 'w-full text-center' : 'flex-1')}>
                  {/* The name at full strength, with the word Out by it: the stripe never says Out alone. */}
                  <p className={cn('flex min-w-0 items-baseline gap-2 tv-num text-tv-floor leading-none', style.stacked && 'justify-center')}>
                    <span className="truncate">{p.name}</span>
                    {knockedOut && !style.byName && <span className={OUT_WORD}>Out</span>}
                  </p>
                  {knockedOut && style.byName && (
                    <p className={cn('mt-1 flex max-w-full', style.stacked && 'justify-center')}>
                      <span className={OUT_WORD}>Out</span>
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

/** A solid raised panel with its label at the TV's floor. */
function Panel({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <section className={cn('rounded-tile bg-raised p-6 short:p-5', className)}>
      <h2 className="mb-4 text-tv-floor font-semibold text-paper-2 short:mb-3">{title}</h2>
      {children}
    </section>
  )
}
