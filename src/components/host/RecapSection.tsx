import type { Icon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** One part of the recap page: its heading with a duotone icon, a line about it, then the part itself. */
export default function RecapSection({
  id,
  icon: SectionIcon,
  title,
  note,
  action,
  card = false,
  className,
  children,
}: {
  id: string
  icon: Icon
  title: string
  note?: ReactNode
  /** A control at the heading's end, e.g. Show as a table. */
  action?: ReactNode
  /** On a card of its own, rather than straight on the page. */
  card?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} className={cn('min-w-0', card && 'rounded-xl bg-raised p-4 sm:p-6', className)}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id={id} className="flex items-center gap-2 text-lg font-extrabold">
            <SectionIcon weight="duotone" className="size-5 shrink-0 text-paper-2" />
            {title}
          </h2>
          {note && <p className="mt-0.5 text-sm text-paper-2">{note}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}
