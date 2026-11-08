import { CrownIcon, SkullIcon } from '@phosphor-icons/react'
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
              'flex max-w-full items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-0.5 text-sm transition-[opacity,filter] duration-700',
              out ? 'bg-white/5 opacity-50 grayscale' : 'bg-white/10',
              me && 'ring-1 ring-primary/60',
            )}
          >
            <span className="relative">
              <Avatar name={p.name} className="size-6 text-[0.6rem]" />
              {p.id === publicState.winner && <AvatarBadge icon={CrownIcon} tone="gold" size="sm" />}
              {out && <AvatarBadge icon={SkullIcon} tone="red" size="sm" />}
            </span>
            <span className={cn('truncate font-medium', out && 'line-through')}>{me ? 'You' : p.name}</span>
          </li>
        )
      })}
    </ul>
  )
}
