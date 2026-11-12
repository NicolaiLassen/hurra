// What the recap page draws from a RecapDoc (docs/engine-v2.md, 7.4): the race
// chart's series, scales and ticks, times of day and the download's name.
// Pure, so they are unit-tested.
import type { RawRecap, RecapDoc } from '@/lib/recap'

/**
 * The race's colours: the validated dark categorical steps (the dataviz
 * reference palette, checked against the card surface #1b1830: every check
 * passes, worst adjacent CVD ΔE 8.4, normal-vision 19.3, all above 3:1).
 * Assigned in this order to the final top 8, so a guest keeps their colour.
 */
export const RACE_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'] as const

export type RaceSeries = {
  playerId: string
  name: string
  color: string
  /** The final rank in the night's standings. */
  rank: number
  final: number
  values: number[]
}

/** One series per guest in the race (the final top 8, in standings order), with a value per sample. */
export function raceSeries(doc: Pick<RecapDoc, 'race' | 'standings'>): { times: number[]; series: RaceSeries[] } {
  const times = doc.race.map((sample) => sample.at)
  const first = doc.race[0]
  if (!first) return { times, series: [] }
  const ids = Object.keys(first.totals)
  const standing = new Map(doc.standings.map((row) => [row.playerId, row]))
  // Standings order, which is how the doc lists the top 8; anyone missing goes last.
  const ordered = [...ids].sort((a, b) => (standing.get(a)?.rank ?? Infinity) - (standing.get(b)?.rank ?? Infinity))
  const series = ordered.slice(0, RACE_COLORS.length).map((playerId, i) => {
    const row = standing.get(playerId)
    const values = doc.race.map((sample) => sample.totals[playerId] ?? 0)
    return {
      playerId,
      name: row?.name ?? 'A guest',
      color: RACE_COLORS[i],
      rank: row?.rank ?? ordered.length,
      final: values[values.length - 1] ?? 0,
      values,
    }
  })
  return { times, series }
}

/**
 * Round axis ticks covering 0 (and anything below, for negative totals) up to
 * at least `max`: whole steps of 1, 2 or 5 times a power of ten, at most
 * `most` ticks or one more.
 */
export function valueTicks(min: number, max: number, most = 5): number[] {
  const low = Math.min(0, Math.floor(min))
  const high = Math.max(low + 1, Math.ceil(max))
  const step = niceStep(high - low, most)
  const ticks: number[] = []
  for (let t = Math.floor(low / step) * step; t <= Math.ceil(high / step) * step; t += step) ticks.push(t)
  return ticks
}

/** The smallest step of 1, 2 or 5 times a power of ten that spans `span` in at most `most - 1` steps. */
function niceStep(span: number, most: number): number {
  for (let power = 1; ; power *= 10) {
    for (const m of [1, 2, 5]) if (span / (m * power) <= most - 1) return m * power
  }
}

const MINUTE = 60_000
const TIME_STEPS = [5, 10, 15, 30, 60, 120, 180, 240].map((m) => m * MINUTE)

/**
 * Times of day for the time axis: whole 5, 10, 15 or 30 minutes or hours (on
 * this device's clock), at most `most` of them between `from` and `to`.
 */
export function timeTicks(from: number, to: number, most: number): number[] {
  if (!(to > from) || most < 1) return []
  const step = TIME_STEPS.find((s) => (to - from) / s <= most) ?? TIME_STEPS[TIME_STEPS.length - 1]
  // Local time: steps line up with the clock on the wall, not with UTC.
  const offset = -new Date(from).getTimezoneOffset() * MINUTE
  const ticks: number[] = []
  for (let t = Math.ceil((from + offset) / step) * step - offset; t <= to; t += step) ticks.push(t)
  return ticks
}

/** Log rows that change nothing in the recap: the recap itself, the TV, the pairing, joining, settings, a prompt closing. */
const QUIET_KINDS = new Set([
  'recap.published',
  'recap.unpublished',
  'session.tv_scene',
  'stage.changed',
  'prompt.closed',
  'screen.paired',
  'screen.unpaired',
  'session.opened',
  'session.closed',
  'game.settings_changed',
])

/** Whether the night has moved on since a recap built at `builtAt` (its generatedAt): a row after it that the recap would show. */
export function movedOnSince(raw: Pick<RawRecap, 'log'>, builtAt: number): boolean {
  return raw.log.some((row) => row.at > builtAt && !QUIET_KINDS.has(row.kind))
}

/** The sample nearest to `at`: what the crosshair snaps to. */
export function nearestIndex(times: readonly number[], at: number): number {
  let best = 0
  for (let i = 1; i < times.length; i++) if (Math.abs(times[i] - at) < Math.abs(times[best] - at)) best = i
  return best
}

const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

/** "21:40": a time of day on this device's clock. */
export function clockTime(ms: number): string {
  return clock.format(ms)
}

/** "21:05 to 21:40", or "21:05, still running". */
export function timeSpan(from: number, to: number | null): string {
  return to === null ? `${clockTime(from)}, still running` : `${clockTime(from)} to ${clockTime(to)}`
}

/** hurra-birthday-party-2026-11-28.json: the party's name in plain letters, and the day. */
export function downloadName(partyName: string, at: number): string {
  const slug = partyName
    .toLowerCase()
    // Letters that don't come apart into a plain letter and an accent.
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  const day = new Date(at)
  const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
  return `hurra-${slug || 'party'}-${date}.json`
}

/** "1,284": whole numbers with a thousands separator, as the TV and phones write them. */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}
