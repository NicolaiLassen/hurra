// The quiz's parts for a guest's phone only (docs/identity.md, The quiz on a
// phone): the answer tiles, the seconds left and the quiz key's four chips.
// The TV's parts stay in parts.tsx; these share only the letter chip.
import { LockSimpleIcon } from '@phosphor-icons/react'
import { tileName } from '@/games/quiz/answer'
import { useServerTime } from '@/games/quiz/clock'
import { URGENT_MS } from '@/games/quiz/look'
import { LetterBadge } from '@/games/quiz/parts'
import { cn } from '@/lib/utils'

/** Where an answer tile stands: open to tap, the one picked (on its way, or in), or faded beside a pick or after time is up. */
export type TileState = 'open' | 'sending' | 'locked' | 'faded'

/**
 * One answer on the quiz controller. With letters only (`option` null): a
 * big overlay tile with the letter's tilted chip in the quiz key, sized to
 * the tile through container units. With the answers shown: a row with the
 * chip and the answer. The picked one turns paper at once and says where it
 * is; the others fade. Rows never tilt; the chip does.
 */
export function AnswerTile({
  index,
  option,
  state,
  onPick,
}: {
  index: number
  /** The answer's text, or null for letters only. */
  option: string | null
  state: TileState
  onPick: () => void
}) {
  const picked = state === 'sending' || state === 'locked'
  const letters = option === null
  return (
    <button
      type="button"
      data-answer-tile=""
      aria-label={tileName(index, option)}
      aria-pressed={picked}
      // Tappable only while open; a picked tile stays focusable for its name and state.
      disabled={state === 'faded'}
      aria-disabled={state !== 'open' || undefined}
      onClick={state === 'open' ? onPick : undefined}
      className={cn(
        // No transition onto the pick: it shows on the very next frame.
        'relative rounded-phone bg-overlay text-paper outline-none select-none focus-visible:ring-3 focus-visible:ring-gold/50',
        'transition-opacity duration-150 motion-reduce:transition-none',
        letters
          ? 'grid h-[clamp(7.25rem,calc((100svh-24.5rem)/2),14.75rem)] place-items-center [container-type:size]'
          : 'flex min-h-[4.25rem] w-full items-center gap-3.5 py-2.5 pr-4 pl-2.5 text-left',
        state === 'open' && 'active:bg-rule',
        picked && 'bg-paper text-ink',
        state === 'faded' && 'opacity-35',
      )}
    >
      <LetterBadge
        index={index}
        className={cn(
          'rounded-chip leading-none',
          letters ? 'size-(--chip) text-[length:calc(var(--chip)*0.68)] [--chip:min(76cqw,56cqh)]' : 'size-12 text-[1.75rem]',
        )}
      />
      {!letters && <span className="min-w-0 flex-1 text-lg leading-snug font-bold break-words">{option}</span>}
      {picked && (
        <span
          className={cn(
            'flex shrink-0 items-center gap-1 text-sm font-bold',
            letters && 'absolute top-2.5 left-3',
          )}
        >
          {state === 'locked' && <LockSimpleIcon weight="fill" className="size-4" />}
          {state === 'locked' ? 'Locked in' : 'Sending'}
        </span>
      )}
    </button>
  )
}

/** "9 s left": the seconds in condensed figures, gold for the last few as on the TV, then "Time's up". */
export function TimeLeft({ endsAt, serverNow, className }: { endsAt: number; serverNow: () => number; className?: string }) {
  const now = useServerTime(serverNow, 250)
  const left = endsAt - now
  // Spans, so it can sit inside a button (Answer now).
  if (left <= 0) return <span className={cn('text-[1.0625rem] font-semibold text-paper-2', className)}>Time's up</span>
  return (
    <span className={cn('inline-flex items-baseline gap-1.5 text-[1.0625rem] font-semibold whitespace-nowrap text-paper-2', className)}>
      <span className={cn('text-[1.75rem] leading-none tv-num', left <= URGENT_MS ? 'text-gold' : 'text-paper')}>
        {Math.ceil(left / 1000)}
      </span>
      s left
    </span>
  )
}

/** The quiz key's four chips in a row, A to D, each at its own tilt: the quiz's mark on a phone. */
export function KeyChips({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <span aria-hidden className={cn('flex gap-2', className)}>
      {Array.from({ length: count }, (_, i) => (
        <LetterBadge key={i} index={i} className="size-11 rounded-chip text-2xl leading-none" />
      ))}
    </span>
  )
}
