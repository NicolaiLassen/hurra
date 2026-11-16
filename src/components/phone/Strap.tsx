import type { ElementType, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** What a tab's colour says (docs/identity.md): gold is on air, pink is the hunt, paper anything else. */
export type TabTone = 'air' | 'hunt' | 'plain'

const TONES: Record<TabTone, string> = {
  air: 'bg-gold text-ink',
  hunt: 'bg-pink text-ink',
  plain: 'bg-paper text-ink',
}

/**
 * A tab: a tilted label in wide Archivo, a piece of the logo's confetti that
 * landed on the page. It names a section of the phone (On the TV, Last one
 * standing) or the game on a strap. Tabs are one of the three things that
 * tilt (with letter chips and hero tokens); rows never do.
 */
export function Tab({
  tone = 'air',
  size = 'section',
  tilt = 'left',
  className,
  children,
}: {
  tone?: TabTone
  /** 'strap': the game's name on its strap. 'section': a section's name. */
  size?: 'strap' | 'section'
  tilt?: 'left' | 'right'
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'on-air inline-block max-w-full truncate align-middle',
        size === 'strap' ? 'h-[38px] px-[13px] text-[17px] leading-[38px]' : 'h-8 px-[11px] text-sm leading-8',
        tilt === 'left' ? '-rotate-2' : 'rotate-[1.5deg]',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

/**
 * The programme strap over a game on the phone: its name on a tab, gold while
 * the TV shows it, and a paper strap with where it stands ("Question 3 of
 * 10", "On the TV", "Finished at 22:41"). `aside` sits at the right: this
 * phone's own token, or the sheet's close button. The name is the heading.
 */
export function Strap({
  title,
  tone,
  line,
  aside,
  heading: Heading = 'h2',
  headingId,
}: {
  title: string
  tone: TabTone
  line: string | null
  aside?: ReactNode
  /** What holds the name: an h2, or a dialog's title (the game sheet's). */
  heading?: ElementType<{ id?: string; className?: string; children?: ReactNode }>
  headingId?: string
}) {
  return (
    <div className="flex min-h-11 items-center gap-3">
      <div className="flex min-w-0 items-center">
        <Heading id={headingId} className="relative z-10 max-w-[65%] shrink-0">
          <Tab tone={tone} size="strap">
            {title}
          </Tab>
        </Heading>
        {line && (
          <p className="-ml-1.5 h-[34px] min-w-0 truncate bg-paper pr-3.5 pl-[18px] text-[17px] leading-[34px] font-bold text-ink">{line}</p>
        )}
      </div>
      {aside && <div className="ml-auto shrink-0">{aside}</div>}
    </div>
  )
}

/** A section's heading on the phone home: its tab, and an optional quiet link at the right. */
export function SectionHead({
  id,
  tab,
  tone = 'air',
  tilt = 'left',
  action,
}: {
  id?: string
  tab: string
  tone?: TabTone
  tilt?: 'left' | 'right'
  action?: ReactNode
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3">
      <h2 id={id} className="min-w-0">
        <Tab tone={tone} tilt={tilt}>
          {tab}
        </Tab>
      </h2>
      {action}
    </div>
  )
}

/** A quiet text link at the right of a section's heading ("Who is left"). */
export function SectionLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-mr-2 flex h-11 shrink-0 items-center gap-1 rounded-control px-2 text-sm font-semibold text-paper-2 transition-colors hover:text-paper focus-visible:ring-3 focus-visible:ring-gold/50 focus-visible:outline-none"
    >
      {children}
    </button>
  )
}
