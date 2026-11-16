import type { TvRow } from '@/components/phone/running'
import { SectionHead } from '@/components/phone/Strap'
import { cn } from '@/lib/utils'

/**
 * On the TV, on the phone home: Now (gold, what is on air), Next and Later,
 * from tvRows in running.ts. Rows never tilt; the tab does.
 */
export default function OnTheTv({ rows }: { rows: TvRow[] }) {
  if (rows.length === 0) return null
  return (
    <section aria-labelledby="on-the-tv" className="grid grid-cols-1 gap-1.5">
      <SectionHead id="on-the-tv" tab="On the TV" />
      <dl>
        {rows.map((row) => (
          <div key={row.when} className="grid grid-cols-[3.875rem_minmax(0,1fr)] items-baseline py-[7px]">
            <dt className={cn('text-[1.3125rem] leading-none tv-num', row.when === 'Now' ? 'text-gold' : 'text-paper-2')}>{row.when}</dt>
            <dd>
              <span className="block text-lg leading-snug font-bold break-words">{row.what}</span>
              {row.detail && <span className="mt-0.5 block text-sm font-medium text-paper-2">{row.detail}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
