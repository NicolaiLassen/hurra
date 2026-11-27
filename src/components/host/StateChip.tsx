import { UsersFourIcon } from '@phosphor-icons/react'
import { Badge } from '@/components/ui/badge'
import type { GameStatus, Session } from '@/lib/types'

/** A game's status, whether a party takes new guests, or that either is archived. */
export type GameState = GameStatus | Session['status'] | 'archived'

const CHIP: Record<GameState, { label: string; variant: 'secondary' | 'outline' | 'ghost' }> = {
  pending: { label: 'Not started', variant: 'ghost' },
  active: { label: 'Live', variant: 'secondary' },
  finished: { label: 'Done', variant: 'ghost' },
  archived: { label: 'Archived', variant: 'outline' },
  open: { label: 'Open', variant: 'secondary' },
  closed: { label: 'Closed', variant: 'ghost' },
}

/**
 * A game's or a party's state in the host pages, as a word (docs/identity.md):
 * Live and Open on the overlay, Done, Not started and Closed as plain words,
 * Archived in a rule outline. Never gold: in the host room gold is the one
 * next step, and On the TV, which is on air.
 */
export default function StateChip({ state, className }: { state: GameState; className?: string }) {
  const { label, variant } = CHIP[state]
  return (
    <Badge variant={variant} className={className}>
      {label}
    </Badge>
  )
}

/**
 * A game played in teams, beside its state chip: a quiet plain word with the
 * teams glyph, never a colour, so it never reads as a state of its own.
 */
export function InTeamsChip({ className }: { className?: string }) {
  return (
    <Badge variant="ghost" className={className}>
      <UsersFourIcon weight="bold" aria-hidden />
      In teams
    </Badge>
  )
}
