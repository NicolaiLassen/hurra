// What the recap page draws from a RecapDoc (docs/engine-v2.md, 7.4): the
// night's headline and awards, the race chart's series, scales and ticks, the
// TV's slides, times of day and the download's name. Pure, so they are
// unit-tested. Like the rest of the core, it knows no game: awards come from
// the chapters' winners and the highlights the games' own recap hooks wrote.
import { recapSlides, slideKey, slideMs, type RecapSlide } from '@/components/tv/recapSlides'
import type { AnnouncementIcon, Highlight, Tone } from '@/games/core/Game'
import { listNames, type RawRecap, type RecapDoc } from '@/lib/recap'

/**
 * The race's colours: the validated dark categorical steps (the dataviz
 * reference palette, checked against the card surface, now the raised
 * #1e1a16: every check passes, worst adjacent CVD ΔE 8.4, normal-vision 19.3,
 * all above 3:1, the lowest 3.5). A chart's palette, not identity colours.
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

/** Log rows that change nothing in the recap: the recap itself, the TV and its sound, the pairing, joining, settings, a prompt closing. */
const QUIET_KINDS = new Set([
  'recap.published',
  'recap.unpublished',
  'session.tv_scene',
  'session.sound_volume',
  'stage.changed',
  'prompt.closed',
  'screen.paired',
  'screen.unpaired',
  'session.opened',
  'session.closed',
  'game.settings_changed',
  // A guest's photo: the recap holds none; the screens draw them live (docs/guest-photos.md).
  'player.photo_changed',
])

/** Whether the night has moved on since a recap built at `builtAt` (its generatedAt): a row after it that the recap would show. */
export function movedOnSince(raw: Pick<RawRecap, 'log'>, builtAt: number): boolean {
  return raw.log.some((row) => row.at > builtAt && !QUIET_KINDS.has(row.kind))
}

/**
 * Where the race chart draws its lead changes' crowns, from their x positions
 * in time order: changes closer than `gap` pixels share a spot, their crowns
 * fanned out leftwards from the latest by `step`, at most `most` of them (the
 * latest). Per change, its crown's x, or null when its crown is left out.
 */
export function crownSpots(xs: readonly number[], gap = 18, step = 9, most = 3): (number | null)[] {
  const spots: (number | null)[] = xs.map(() => null)
  let start = 0
  for (let i = 1; i <= xs.length; i++) {
    if (i < xs.length && xs[i] - xs[i - 1] <= gap) continue
    const end = i - 1
    for (let k = end; k >= start && end - k < most; k--) spots[k] = xs[end] - (end - k) * step
    start = i
  }
  return spots
}

/**
 * The race chart's line about its lead changes, from crownSpots: once changes
 * bunch up, only the latest of them keep a crown, and the hairlines mark them all.
 */
export function crownsCaption(crowns: readonly (number | null)[]): string {
  if (crowns.length === 1) return 'The crown marks the lead change.'
  if (crowns.every((at) => at !== null)) return `The crowns mark the ${crowns.length} lead changes.`
  return `The lead changed ${crowns.length} times: a line marks each, and crowns show the latest where they bunch up.`
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

/** The recap page's read of the night, as it stands after its latest answer. */
export type NightRead<T> = { attempt: number; raw: T | null; error: string | null }

/**
 * A read that failed: the last night stays. A quiet re-read stays quiet only
 * while there is a night on screen to keep; one that took over the first read
 * (or a Try again) shows its error, or the page would wait on the loader forever.
 */
export function failedNightRead<T>(last: NightRead<T> | null, attempt: number, quiet: boolean, message: string): NightRead<T> {
  return { attempt, raw: last?.raw ?? null, error: quiet && last?.raw ? last.error : message }
}

/**
 * What the recap page shows: the loader until the night is in, or until its
 * read gave up (the page then says so, with Try again). Never the page around
 * a night still on its way: it goes from the loader straight to the night.
 */
export function recapScreen(night: { raw: unknown; error: string | null }): 'loader' | 'page' {
  return night.raw === null && night.error === null ? 'loader' : 'page'
}

/** Waits before the read on arrival tries again: a blip on the way in never reads as "The night couldn't be read". */
export const ARRIVAL_RETRIES_MS = [1000, 2000] as const

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Runs `read`, and again after each of `waits` while it fails; the last failure
 * is thrown. `stop()` gives up early (the page has moved on).
 */
export async function retried<T>(
  read: () => Promise<T>,
  waits: readonly number[],
  stop: () => boolean = () => false,
  sleep: (ms: number) => Promise<void> = wait,
): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await read()
    } catch (error) {
      if (i >= waits.length || stop()) throw error
      await sleep(waits[i])
      if (stop()) throw error
    }
  }
}

// The night at a glance --------------------------------------------------------------

const pointsText = (n: number) => `${formatCount(n)} point${n === 1 || n === -1 ? '' : 's'}`

/** "1st", "2nd", "3rd", "4th", "11th", "22nd". */
export function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

/** Who tops the night: everyone tied first, once someone has scored. */
export function nightLeaders(doc: Pick<RecapDoc, 'standings'>): RecapDoc['standings'] {
  return doc.standings.filter((row) => row.rank === 1 && row.points > 0)
}

/** A guest on the podium: their place in the standings, and their step (0 is the top one). */
export type PodiumPlace = { row: RecapDoc['podium'][number]; place: number; step: number }

/**
 * The top three in place order, as the TV's last slide has them: the place
 * comes from the standings, so everyone tied first is crowned on the top step,
 * and a tie for second shares the second step.
 */
export function podiumPlaces(doc: Pick<RecapDoc, 'podium' | 'standings'>): PodiumPlace[] {
  const rank = new Map(doc.standings.map((row) => [row.playerId, row.rank]))
  return doc.podium.slice(0, 3).map((row, i) => {
    const place = rank.get(row.playerId) ?? i + 1
    return { row, place, step: Math.min(place, 3) - 1 }
  })
}

/** The hero's headline and the line under it. Present tense while a round still runs. */
export function nightHeadline(doc: Pick<RecapDoc, 'standings' | 'chapters'>): { title: string; line: string } {
  const leaders = nightLeaders(doc)
  if (leaders.length === 0) {
    return {
      title: 'The night is young',
      line: doc.chapters.length === 0 ? 'No game has started yet. The recap fills up as the night goes on.' : 'Nobody has scored yet.',
    }
  }
  const names = listNames(leaders.map((row) => row.name))
  const top = leaders[0].points
  const running = doc.chapters.some((chapter) => chapter.finishedAt === null)
  if (leaders.length > 1) {
    return running
      ? { title: `${names} lead the night`, line: `${pointsText(top)} each so far.` }
      : { title: `Hurra for ${names}!`, line: `${names} share the night with ${pointsText(top)} each.` }
  }
  // Everyone tied right behind, while they have points too.
  const nextRank = Math.min(...doc.standings.filter((row) => row.rank > 1).map((row) => row.rank))
  const next = doc.standings.filter((row) => row.rank === nextRank && row.points > 0)
  const ahead = next.length > 0 ? `, ${pointsText(top - next[0].points)} ahead of ${listNames(next.map((row) => row.name))}` : ''
  return running
    ? { title: `${names} leads the night`, line: `${pointsText(top)} so far${ahead}.` }
    : { title: `Hurra for ${names}!`, line: `${names} took the night with ${pointsText(top)}${ahead}.` }
}

/** An award's symbol: a highlight's icon, or the climber's arrow. */
export type AwardIcon = AnnouncementIcon | 'climb'

export type Award = {
  key: string
  /** What it is for: "Won Quiz", "Fastest right answer", "Biggest climber"; the game's title when it is a whole sentence. */
  label: string
  /** The big line: who won it, or the highlight's own sentence. */
  title: string
  /** Who it names, each with a face: the guests the doc can name (they may have left the party since). */
  players: { id: string; name: string }[]
  detail?: string
  icon: AwardIcon
  tone: Tone
  /** A crown on their avatars: they won. */
  crown: boolean
  /** The round it comes from. */
  chapter?: { gameId: string; gameType: string; title: string; round: number }
}

type Chapter = RecapDoc['chapters'][number]

/** The round's own headline about exactly its winners ("Lea was the last one standing"), if its game wrote one. */
function winnersHeadline(chapter: Chapter): Highlight | undefined {
  if (chapter.winners.length === 0) return undefined
  const ids = new Set(chapter.winners.map((w) => w.id))
  return chapter.highlights.find((h) => h.weight === 'headline' && h.players?.length === ids.size && h.players.every((id) => ids.has(id)))
}

const WEIGHT_ORDER: Record<NonNullable<Highlight['weight']>, number> = { headline: 0, highlight: 1, line: 2 }

/**
 * A round's card: the line about its winners (their game's own headline, or
 * "Ana and Bo won"), then every other highlight, headlines first. The generic
 * "Ana won Quiz" says what the winners' line already does, so it goes.
 */
export function chapterStory(chapter: Chapter): { winners: { title: string; detail?: string } | null; highlights: Highlight[] } {
  const names = chapter.winners.map((w) => w.name)
  const headline = winnersHeadline(chapter)
  const generic = names.length > 0 ? `${listNames(names)} won ${chapter.title}` : null
  const highlights = chapter.highlights
    .map((highlight, order) => ({ highlight, order }))
    .filter(({ highlight }) => highlight !== headline && highlight.title !== generic)
    .sort((a, b) => WEIGHT_ORDER[a.highlight.weight ?? 'line'] - WEIGHT_ORDER[b.highlight.weight ?? 'line'] || a.order - b.order)
    .map(({ highlight }) => highlight)
  if (names.length === 0) return { winners: null, highlights }
  const winners = headline
    ? { title: headline.title, ...(headline.detail ? { detail: headline.detail } : {}) }
    : { title: `${listNames(names)} won` }
  return { winners, highlights }
}

/** "Fastest right answer: Hanne" names its winners after the colon: the label is what comes before it. */
function awardLabel(title: string, names: string[]): string | null {
  const colon = title.indexOf(': ')
  return colon > 0 && title.slice(colon + 2) === listNames(names) ? title.slice(0, colon) : null
}

/**
 * The night's awards, people first: every round's winners, then each highlight
 * a finished round's game wrote about named guests (its headline about the
 * winners is their own card, and its minor lines stay in its chapter), then the
 * biggest climber in the race. The night's leader is the hero's podium.
 */
export function nightAwards(doc: RecapDoc): Award[] {
  // A guest who left is gone from the standings, but a round they won or a lead
  // they took still names them. Later entries win: the standings' names come last.
  const named = new Map<string, string>([
    ...doc.chapters.flatMap((c) => c.winners.map((w) => [w.id, w.name] as const)),
    ...doc.leadChanges.map((l) => [l.playerId, l.name] as const),
    ...doc.standings.map((r) => [r.playerId, r.name] as const),
    ...Object.entries(doc.players).map(([id, p]) => [id, p.name] as const),
  ])
  const winners: Award[] = []
  const mentions: Award[] = []
  for (const chapter of doc.chapters) {
    if (chapter.finishedAt === null) continue
    const from = { gameId: chapter.gameId, gameType: chapter.gameType, title: chapter.title, round: chapter.round }
    const round = chapter.round > 1 ? `, round ${chapter.round}` : ''
    const headline = winnersHeadline(chapter)
    if (chapter.winners.length > 0) {
      winners.push({
        key: `won:${chapter.gameId}:${chapter.round}`,
        label: `Won ${chapter.title}${round}`,
        title: listNames(chapter.winners.map((w) => w.name)),
        players: chapter.winners,
        ...(headline?.detail ? { detail: headline.detail } : {}),
        icon: 'crown',
        tone: 'gold',
        crown: true,
        chapter: from,
      })
    }
    chapter.highlights.forEach((h, i) => {
      if (!h.players?.length || h.weight === 'line' || h === headline) return
      // A guest the doc can't name gets no face, and the game's own sentence (which names them) stays whole.
      const players = h.players.flatMap((id) => {
        const name = named.get(id)
        return name === undefined ? [] : [{ id, name }]
      })
      const label = players.length === h.players.length ? awardLabel(h.title, players.map((p) => p.name)) : null
      mentions.push({
        key: `highlight:${chapter.gameId}:${chapter.round}:${i}`,
        label: label ?? `${chapter.title}${round}`,
        title: label ? listNames(players.map((p) => p.name)) : h.title,
        players,
        ...(h.detail ? { detail: h.detail } : {}),
        icon: h.icon ?? 'star',
        tone: h.tone ?? 'gold',
        crown: false,
        chapter: from,
      })
    })
  }
  const climber = biggestClimber(doc)
  const climb: Award[] = climber
    ? [
        {
          key: `climber:${climber.playerId}`,
          label: 'Biggest climber',
          title: climber.name,
          players: [{ id: climber.playerId, name: climber.name }],
          detail: `From ${ordinal(climber.from)} to ${ordinal(climber.to)} in the race since ${clockTime(climber.at)}`,
          icon: 'climb',
          tone: 'teal',
          crown: false,
        },
      ]
    : []
  return [...winners, ...mentions, ...climb]
}

/**
 * The guest in the race (the night's top 8) who climbed the most places in the
 * second half of the night: from their lowest place since halfway to where
 * they finished, at least 2 places. Places count among the race's guests, as
 * the chart draws them. Ties go to the better finish.
 */
export function biggestClimber(
  doc: Pick<RecapDoc, 'race' | 'standings'>,
): { playerId: string; name: string; from: number; to: number; at: number } | null {
  const { times, series } = raceSeries(doc)
  const last = times.length - 1
  if (series.length < 3 || last < 2) return null
  // Competition places among the race's guests, at every moment.
  const places = times.map((_, i) => series.map((s) => 1 + series.filter((other) => other.values[i] > s.values[i]).length))
  const halfway = times[0] + (times[last] - times[0]) / 2
  let best: { index: number; from: number; to: number; at: number } | null = null
  for (let index = 0; index < series.length; index++) {
    const to = places[last][index]
    let from = to
    let at = times[last]
    for (let i = 0; i < last; i++) {
      // The latest moment at their lowest place: they climbed from there.
      if (times[i] >= halfway && places[i][index] >= from && places[i][index] > to) {
        from = places[i][index]
        at = times[i]
      }
    }
    const climb = from - to
    if (climb >= 2 && (!best || climb > best.from - best.to || (climb === best.from - best.to && to < best.to))) best = { index, from, to, at }
  }
  if (!best) return null
  return { playerId: series[best.index].playerId, name: series[best.index].name, from: best.from, to: best.to, at: best.at }
}

// The room's view ------------------------------------------------------------------------

export type TvPeekSlide = { key: string; slide: RecapSlide; label: string; seconds: number }

/** The slides the TV plays on a loop once the recap is on it, in its own order, and how long a loop takes. */
export function tvPeek(doc: RecapDoc): { slides: TvPeekSlide[]; loopSeconds: number } {
  const slides = recapSlides(doc).map((slide) => ({ key: slideKey(slide), slide, label: slideLabel(doc, slide), seconds: slideMs(slide) / 1000 }))
  return { slides, loopSeconds: slides.reduce((sum, s) => sum + s.seconds, 0) }
}

/**
 * Where the TV stands with the slides the page shows. They are the night as
 * the page last read it, but the TV plays the version published at
 * `publishedAt`: once more has happened since (`behind`), Update takes them there.
 */
export function tvNote({ publishedAt, onTv, behind }: { publishedAt: number | null; onTv: boolean; behind: boolean }): string {
  if (publishedAt === null) return 'Once published, Show on the TV plays it on a loop.'
  if (behind) {
    return `${onTv ? 'The TV still plays' : 'Show on the TV plays'} the version you published at ${clockTime(publishedAt)}; Update to play these slides.`
  }
  return onTv ? 'It is playing on the TV now.' : 'Show on the TV plays it there.'
}

function slideLabel(doc: RecapDoc, slide: RecapSlide): string {
  switch (slide.kind) {
    case 'numbers':
      return 'The night in numbers'
    case 'race':
      return 'The race'
    case 'chapter': {
      const chapter = doc.chapters[slide.index]
      return chapter.round > 1 ? `${chapter.title}, round ${chapter.round}` : chapter.title
    }
    case 'leads':
      return 'Lead changes'
    case 'podium':
      return 'The podium'
  }
}

/** "45 s", "1 min", "1 min 12 s". */
export function durationText(seconds: number): string {
  const whole = Math.round(seconds)
  if (whole < 60) return `${whole} s`
  const rest = whole % 60
  return rest === 0 ? `${Math.floor(whole / 60)} min` : `${Math.floor(whole / 60)} min ${rest} s`
}

/** A tone's text colour (labels and icons; CALLOUT_TONE has its tinted circle and bar). */
export const TONE_TEXT: Record<Tone, string> = {
  gold: 'text-primary',
  pink: 'text-confetti-pink',
  teal: 'text-confetti-teal',
  violet: 'text-confetti-violet',
  red: 'text-destructive',
}

/** The four party tones in a fixed order: a game keeps its tone wherever the page shows it. */
export const GAME_TONES = ['gold', 'pink', 'teal', 'violet'] as const satisfies readonly Tone[]

/** Each game's tone, by game id, in the order the games first started. */
export function gameTones(doc: Pick<RecapDoc, 'chapters'>): Map<string, (typeof GAME_TONES)[number]> {
  const tones = new Map<string, (typeof GAME_TONES)[number]>()
  for (const chapter of doc.chapters) {
    if (!tones.has(chapter.gameId)) tones.set(chapter.gameId, GAME_TONES[tones.size % GAME_TONES.length])
  }
  return tones
}
