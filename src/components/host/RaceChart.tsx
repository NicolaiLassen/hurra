import { CrownIcon, TableIcon } from '@phosphor-icons/react'
import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react'
import {
  clockTime,
  crownSpots,
  formatCount,
  nearestIndex,
  raceSeries,
  timeTicks,
  valueTicks,
  type RaceSeries,
} from '@/components/host/recapView'
import { Button } from '@/components/ui/button'
import type { RecapDoc } from '@/lib/recap'
import { useElementSize } from '@/lib/useElementSize'
import { cn } from '@/lib/utils'

/** The plot's height: roomy on a laptop, shorter on a phone. */
const plotHeightFor = (width: number) => (width >= 640 ? 300 : 220)
const MARGIN = { right: 16, bottom: 28, left: 40 }
/** The top margin: room for the leader's label, and above it a band for the lead changes' crowns. */
const topFor = (leadChanges: number) => (leadChanges > 0 ? 46 : 18)
const CROWN = 16

/**
 * The race of the night (docs/engine-v2.md, 7.4): the running totals of the
 * final top 8 as step lines, since points arrive in jumps. A crosshair snaps to
 * the nearest moment (pointer or arrow keys) and lists every guest's total
 * there; a crown in the new leader's colour marks each lead change; the legend
 * names each line in finishing order, the leader's line is labelled at its end,
 * and the same numbers are one tap away as a table.
 */
export default function RaceChart({ doc }: { doc: Pick<RecapDoc, 'race' | 'standings'> & Partial<Pick<RecapDoc, 'leadChanges'>> }) {
  const { times, series } = useMemo(() => raceSeries(doc), [doc])
  const [ref, { width }] = useElementSize<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const [table, setTable] = useState(false)

  if (series.length === 0 || times.length < 2) {
    return <p className="text-sm text-muted-foreground">The race starts once someone scores.</p>
  }

  const plotHeight = plotHeightFor(width || (typeof window === 'undefined' ? 0 : window.innerWidth))
  const from = times[0]
  const to = times[times.length - 1]
  const lowest = Math.min(...series.flatMap((s) => s.values))
  const highest = Math.max(...series.flatMap((s) => s.values))
  const yTicks = valueTicks(lowest, highest)
  const yMin = yTicks[0]
  const yMax = yTicks[yTicks.length - 1]
  const leads = (doc.leadChanges ?? []).filter((lead) => lead.at >= from && lead.at <= to).sort((a, b) => a.at - b.at)
  const top = topFor(leads.length)
  const plotWidth = Math.max(1, width - MARGIN.left - MARGIN.right)
  const x = (t: number) => MARGIN.left + ((t - from) / (to - from || 1)) * plotWidth
  const y = (v: number) => top + (1 - (v - yMin) / (yMax - yMin || 1)) * plotHeight
  const xTicks = timeTicks(from, to, Math.max(2, Math.floor(plotWidth / 90)))
  const leader = series[0]
  const colorOf = new Map(series.map((s) => [s.playerId, s.color]))
  const crowns = crownSpots(leads.map((lead) => x(lead.at)))

  function pointAt(event: PointerEvent<SVGRectElement>) {
    const box = event.currentTarget.getBoundingClientRect()
    const at = from + ((event.clientX - box.left) / (box.width || 1)) * (to - from)
    setActive(nearestIndex(times, at))
  }

  function keys(event: KeyboardEvent<HTMLDivElement>) {
    const last = times.length - 1
    const current = active ?? last
    const moves: Record<string, number> = { ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: last }
    const next = moves[event.key]
    if (next === undefined) return
    event.preventDefault()
    setActive(Math.max(0, Math.min(last, next)))
  }

  const ranked = active === null ? [] : [...series].sort((a, b) => b.values[active] - a.values[active] || a.rank - b.rank)
  const crosshair = active === null ? null : x(times[active])
  // The readout sits beside the crosshair, on whichever side has room.
  const flip = crosshair !== null && crosshair > MARGIN.left + plotWidth * 0.6

  return (
    <figure className="grid gap-4">
      <div
        ref={ref}
        className="relative rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        style={{ height: top + plotHeight + MARGIN.bottom }}
        tabIndex={0}
        role="img"
        aria-label={
          `The race of the night: running totals of the top ${series.length}, from ${clockTime(from)} to ${clockTime(to)}. ` +
          `${leader.name} finished first with ${formatCount(leader.final)}. ` +
          (leads.length > 0 ? `The lead changed ${leads.length === 1 ? 'once' : `${leads.length} times`}. ` : '') +
          'Use the arrow keys to read every total at each moment.'
        }
        onKeyDown={keys}
        onFocus={() => setActive((a) => a ?? times.length - 1)}
        onBlur={() => setActive(null)}
      >
        {width > 0 && (
          <svg width={width} height={top + plotHeight + MARGIN.bottom} className="block overflow-visible" aria-hidden>
            {yTicks.map((tick) => (
              <g key={tick}>
                <line
                  x1={MARGIN.left}
                  x2={MARGIN.left + plotWidth}
                  y1={y(tick)}
                  y2={y(tick)}
                  stroke="currentColor"
                  className={tick === 0 ? 'text-foreground/25' : 'text-foreground/10'}
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                <text x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
                  {formatCount(tick)}
                </text>
              </g>
            ))}
            {xTicks.length > 0
              ? xTicks.map((tick) => (
                  <text
                    key={tick}
                    x={x(tick)}
                    y={top + plotHeight + 18}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[11px] tabular-nums"
                  >
                    {clockTime(tick)}
                  </text>
                ))
              : // Too short a stretch for a whole step of the clock: its start and its end.
                [from, to].map((tick, i) => (
                  <text
                    key={i}
                    x={x(tick)}
                    y={top + plotHeight + 18}
                    textAnchor={i === 0 ? 'start' : 'end'}
                    className="fill-muted-foreground text-[11px] tabular-nums"
                  >
                    {clockTime(tick)}
                  </text>
                ))}

            {/* Each lead change: a hairline down the plot from the crowns' band, above the leader's label. */}
            {leads.map((lead) => (
              <line
                key={`${lead.at}:${lead.playerId}`}
                x1={x(lead.at)}
                x2={x(lead.at)}
                y1={CROWN + 4}
                y2={top + plotHeight}
                stroke="currentColor"
                className="text-foreground/15"
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
            ))}
            {/* A crown in the new leader's colour; changes close together fan out, the latest on top, each ringed in the card's colour. */}
            {leads.map((lead, i) => {
              const at = crowns[i]
              if (at === null) return null
              const color = colorOf.get(lead.playerId)
              return (
                <g key={`${lead.at}:${lead.playerId}`}>
                  <title>{`${lead.name} took the lead at ${clockTime(lead.at)}`}</title>
                  <CrownIcon
                    weight="fill"
                    x={at - CROWN / 2}
                    y={2}
                    width={CROWN}
                    height={CROWN}
                    color={color ?? 'currentColor'}
                    stroke="var(--card)"
                    strokeWidth={28}
                    paintOrder="stroke"
                    className={color ? undefined : 'text-muted-foreground'}
                  />
                </g>
              )
            })}

            {/* The leader is drawn last, on top. */}
            {[...series].reverse().map((s) => (
              <path
                key={s.playerId}
                d={stepPath(times, s.values, x, y)}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                className={cn('transition-opacity', active !== null && 'opacity-90')}
              />
            ))}
            {[...series].reverse().map((s) => (
              <circle key={s.playerId} cx={x(to)} cy={y(s.final)} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} />
            ))}
            <text x={x(to) - 8} y={y(leader.final) - 10} textAnchor="end" className="fill-foreground text-xs font-semibold">
              {leader.name} {formatCount(leader.final)}
            </text>

            {crosshair !== null && active !== null && (
              <g>
                <line
                  x1={crosshair}
                  x2={crosshair}
                  y1={top}
                  y2={top + plotHeight}
                  stroke="currentColor"
                  className="text-foreground/40"
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                {series.map((s) => (
                  <circle key={s.playerId} cx={crosshair} cy={y(s.values[active])} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} />
                ))}
              </g>
            )}

            {/* The hit area: the whole plot, so the pointer only has to be near a moment. */}
            <rect
              x={MARGIN.left}
              y={top}
              width={plotWidth}
              height={plotHeight}
              fill="transparent"
              onPointerMove={pointAt}
              onPointerDown={pointAt}
              onPointerLeave={() => setActive(null)}
            />
          </svg>
        )}

        {crosshair !== null && active !== null && (
          <div
            className="pointer-events-none absolute z-10 w-44 rounded-lg bg-popover p-2.5 text-xs shadow-xl ring-1 ring-foreground/10"
            style={{ top, left: flip ? undefined : crosshair + 12, right: flip ? width - crosshair + 12 : undefined }}
          >
            <p className="mb-1.5 font-medium text-muted-foreground tabular-nums">{clockTime(times[active])}</p>
            <ol className="grid gap-1">
              {ranked.map((s) => (
                <li key={s.playerId} className="flex items-center gap-2">
                  <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="w-8 shrink-0 text-right font-bold text-foreground tabular-nums">{formatCount(s.values[active])}</span>
                  <span className="min-w-0 truncate text-muted-foreground">{s.name}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      <figcaption className="grid gap-3">
        <ol className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-4" aria-label="Who each line is, in finishing order">
          {series.map((s) => (
            <li key={s.playerId} className="flex min-w-0 items-center gap-2 text-sm">
              <span className="w-4 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{s.rank}</span>
              <span className="h-0.5 w-4 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
              <span className="min-w-0 truncate font-medium">{s.name}</span>
              <span className="shrink-0 text-muted-foreground tabular-nums">{formatCount(s.final)}</span>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {leads.length > 0 && (
              <>
                <CrownIcon weight="fill" className="size-3.5 shrink-0" />
                {leads.length === 1 ? 'The crown marks the lead change.' : `The crowns mark the ${leads.length} lead changes.`}
              </>
            )}
          </p>
          <Button variant="ghost" size="sm" aria-expanded={table} onClick={() => setTable((shown) => !shown)}>
            <TableIcon />
            {table ? 'Hide the table' : 'Show as a table'}
          </Button>
        </div>
      </figcaption>

      {table && <RaceTable times={times} series={series} />}
    </figure>
  )
}

/** Totals hold between moments and jump when points arrive: horizontal, then vertical. */
function stepPath(times: number[], values: number[], x: (t: number) => number, y: (v: number) => number): string {
  let d = `M${x(times[0]).toFixed(1)},${y(values[0]).toFixed(1)}`
  for (let i = 1; i < times.length; i++) d += `H${x(times[i]).toFixed(1)}V${y(values[i]).toFixed(1)}`
  return d
}

/** The chart's numbers as a table: every moment, every guest in the race. */
function RaceTable({ times, series }: { times: number[]; series: RaceSeries[] }) {
  return (
    <div className="max-h-80 overflow-auto rounded-lg ring-1 ring-foreground/10">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Time
            </th>
            {series.map((s) => (
              <th key={s.playerId} scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-foreground/5 tabular-nums">
          {times.map((at, i) => (
            <tr key={`${at}-${i}`}>
              <th scope="row" className="px-3 py-1.5 text-left font-normal text-muted-foreground">
                {clockTime(at)}
              </th>
              {series.map((s) => (
                <td key={s.playerId} className="px-3 py-1.5 text-right">
                  {formatCount(s.values[i])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
