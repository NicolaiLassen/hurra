import { cn } from '@/lib/utils'

// Gold for the leader, then paper and paper-2: the steps are told apart by value (docs/identity.md).
const PODIUM = ['bg-gold text-ink', 'bg-paper text-ink', 'bg-paper-2 text-ink']

/** A rank in a coin: gold, then paper and paper-2 for the top three. */
export default function RankBadge({ rank, className }: { rank: number; className?: string }) {
  return (
    <span
      className={cn(
        'grid size-6 shrink-0 place-items-center rounded-full text-xs font-black tabular-nums',
        PODIUM[rank - 1] ?? 'text-muted-foreground',
        className,
      )}
    >
      {rank}
    </span>
  )
}
