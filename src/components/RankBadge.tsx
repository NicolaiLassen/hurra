import { cn } from '@/lib/utils'

const PODIUM = ['bg-primary text-primary-foreground', 'bg-slate-300 text-background', 'bg-amber-600 text-background']

/** A rank in a coin: gold, silver and bronze for the top three. */
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
