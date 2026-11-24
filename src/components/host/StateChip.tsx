import { Badge } from '@/components/ui/badge'
import type { GameStatus } from '@/lib/types'

export type GameState = GameStatus | 'archived'

const CHIP: Record<GameState, { label: string; variant: 'secondary' | 'outline' | 'ghost' }> = {
  pending: { label: 'Not started', variant: 'ghost' },
  active: { label: 'Live', variant: 'secondary' },
  finished: { label: 'Done', variant: 'ghost' },
  archived: { label: 'Archived', variant: 'outline' },
}

/**
 * A game's state in the control room, as a word (docs/identity.md): Live on
 * the overlay, Done and Not started as plain words, Archived in a rule
 * outline. Never gold: in the host room gold is the one next step, and On the
 * TV, which is on air.
 */
export default function StateChip({ state, className }: { state: GameState; className?: string }) {
  const { label, variant } = CHIP[state]
  return (
    <Badge variant={variant} className={className}>
      {label}
    </Badge>
  )
}
