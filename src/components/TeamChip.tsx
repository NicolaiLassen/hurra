import { teamColour, TEAM_FILL } from '@/lib/teams'
import type { Team } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * A team's colour as a small square, in its palette colour (src/lib/teams.ts).
 * Decoration only: the team's name always stands beside it, since a state
 * never rests on colour alone (docs/identity.md).
 */
export function TeamSwatch({ team, className }: { team: Pick<Team, 'colour'>; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-3 shrink-0 rounded-chip', TEAM_FILL[teamColour(team.colour)], className)} />
}

/**
 * A team as a chip: its swatch and its name, on the overlay surface, or
 * `plain` without one (inside a row that is a surface already). Sizes follow
 * the Badge's: `sm` for lists, `lg` beside a heading or a token.
 */
export default function TeamChip({
  team,
  size = 'sm',
  plain = false,
  className,
}: {
  team: Pick<Team, 'name' | 'colour'>
  size?: 'sm' | 'lg'
  plain?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full min-w-0 items-center rounded-chip font-bold text-paper',
        size === 'sm' ? 'gap-1.5 text-xs' : 'gap-2 text-sm',
        !plain && (size === 'sm' ? 'h-5 bg-overlay px-2' : 'h-7 bg-overlay px-3'),
        className,
      )}
    >
      <TeamSwatch team={team} className={size === 'lg' ? 'size-3.5' : undefined} />
      <span className="truncate">{team.name}</span>
    </span>
  )
}
