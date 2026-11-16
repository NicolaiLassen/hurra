import { placeTone } from '@/components/placeTones'
import { cn } from '@/lib/utils'

/** A rank in a coin: gold, then paper and paper-2 for the top three (the place tones). */
export default function RankBadge({ rank, className }: { rank: number; className?: string }) {
  return (
    <span
      className={cn(
        'grid size-6 shrink-0 place-items-center rounded-full text-xs font-black tabular-nums',
        rank >= 1 && rank <= 3 ? placeTone(rank).coin : 'text-muted-foreground',
        className,
      )}
    >
      {rank}
    </span>
  )
}
