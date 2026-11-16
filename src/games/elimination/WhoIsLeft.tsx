import { CrownIcon } from '@phosphor-icons/react'
import Avatar from '@/components/Avatar'
import AvatarBadge from '@/components/AvatarBadge'
import type { EliminationPublicState } from '@/games/elimination/logic'
import type { Player } from '@/lib/types'
import { cn } from '@/lib/utils'

/** Everyone dealt in: who's still standing first, then who's out, with you marked. */
export default function WhoIsLeft({
  players,
  publicState,
  meId,
}: {
  players: Player[]
  publicState: EliminationPublicState
  meId: string
}) {
  const alive = new Set(publicState.alive)
  const dealtIn = players.filter((p) => alive.has(p.id) || publicState.out.includes(p.id))
  const ordered = [...dealtIn.filter((p) => alive.has(p.id)), ...dealtIn.filter((p) => !alive.has(p.id))]

  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Who's still in">
      {ordered.map((p) => {
        const out = !alive.has(p.id)
        const me = p.id === meId
        return (
          <li
            key={p.id}
            className={cn(
              'flex max-w-full items-center gap-1.5 rounded-md py-0.5 pr-2.5 pl-0.5 text-sm transition-colors duration-700',
              out ? 'bg-white/5' : 'bg-white/10',
              me && 'ring-1 ring-primary/60',
            )}
          >
            <span className="relative">
              <Avatar name={p.name} out={out} className="size-6" />
              {p.id === publicState.winner && <AvatarBadge icon={CrownIcon} tone="gold" size="sm" />}
            </span>
            {/* The name at full strength, and the word beside it: the stripe never says Out alone. */}
            <span className="truncate font-medium">{me ? 'You' : p.name}</span>
            {out && <span className="shrink-0 font-bold text-pink">Out</span>}
          </li>
        )
      })}
    </ul>
  )
}
