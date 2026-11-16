// The TV's recap scene (docs/engine-v2.md, 7.2): which slides a published
// RecapDoc gives, how long each shows, and the race's frames. Pure, so the
// slide rules are unit-tested; RecapScene.tsx draws them.
import type { Highlight } from '@/games/core/Game'
import { listNames, type RecapDoc } from '@/lib/recap'

/** Every slide shows this long, then the next; after the last one the show starts again. */
export const SLIDE_MS = 8000
/** The race plays this long... */
export const RACE_PLAY_MS = 10_000
/** ...and holds its last frame until its slide ends. */
export const RACE_SLIDE_MS = 12_000
/** At most this many highlights on a chapter's slide. */
export const CHAPTER_HIGHLIGHTS = 3
/** At most this many lead changes on their slide: the latest. */
export const LEAD_CHANGES_SHOWN = 6

export type RecapSlide =
  /** "{party}: the night in numbers". */
  | { kind: 'numbers' }
  /** The bar race of the top 8 over the night. */
  | { kind: 'race' }
  /** One round of a game: its winners and up to 3 highlights. */
  | { kind: 'chapter'; index: number }
  /** Who took the lead, and when. */
  | { kind: 'leads' }
  /** The final podium, with confetti. */
  | { kind: 'podium' }

/** The slides, in order. A slide with nothing to show (no race, no lead changes, nobody scored) is left out. */
export function recapSlides(doc: RecapDoc): RecapSlide[] {
  const slides: RecapSlide[] = [{ kind: 'numbers' }]
  if (raceFrames(doc).length >= 2) slides.push({ kind: 'race' })
  doc.chapters.forEach((_, index) => slides.push({ kind: 'chapter', index }))
  if (doc.leadChanges.length > 0) slides.push({ kind: 'leads' })
  if (doc.podium.length > 0) slides.push({ kind: 'podium' })
  return slides
}

export const slideMs = (slide: RecapSlide) => (slide.kind === 'race' ? RACE_SLIDE_MS : SLIDE_MS)

export const slideKey = (slide: RecapSlide) => (slide.kind === 'chapter' ? `chapter-${slide.index}` : slide.kind)

export type NumberTile = { key: keyof RecapDoc['numbers']; value: number; label: string }

const NUMBER_LABELS: Record<keyof RecapDoc['numbers'], [one: string, many: string]> = {
  guests: ['guest', 'guests'],
  games: ['game played', 'games played'],
  answers: ['answer', 'answers'],
  moves: ['move', 'moves'],
  awards: ['host award', 'host awards'],
}

/** The night in numbers. Answers, moves and awards only when there were any. */
export function numberTiles(doc: RecapDoc): NumberTile[] {
  return (Object.keys(NUMBER_LABELS) as (keyof RecapDoc['numbers'])[]).flatMap((key) => {
    const value = doc.numbers[key]
    if (value === 0 && key !== 'guests' && key !== 'games') return []
    const [one, many] = NUMBER_LABELS[key]
    return [{ key, value, label: value === 1 ? one : many }]
  })
}

export type RaceRow = { playerId: string; name: string; total: number }
export type RaceFrame = { at: number; rows: RaceRow[] }

/** A recap's name for a player (they may have left the party since). */
export function recapName(doc: RecapDoc, playerId: string): string {
  return doc.players[playerId]?.name ?? doc.standings.find((r) => r.playerId === playerId)?.name ?? 'A guest'
}

/**
 * The race's samples, each sorted by total (highest first, then name), for the
 * players it follows. Empty when nobody ever scored.
 */
export function raceFrames(doc: RecapDoc): RaceFrame[] {
  const ids = [...new Set(doc.race.flatMap((sample) => Object.keys(sample.totals)))]
  const frames = doc.race.map((sample) => ({
    at: sample.at,
    rows: ids
      .map((playerId) => ({ playerId, name: recapName(doc, playerId), total: sample.totals[playerId] ?? 0 }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
  }))
  return frames.some((frame) => frame.rows.some((row) => row.total !== 0)) ? frames : []
}

const WEIGHT_ORDER: Record<NonNullable<Highlight['weight']>, number> = { headline: 0, highlight: 1, line: 2 }

/** "Bo won Last one standing" says what the chapter's winners already show: left out. */
export function chapterHighlights(chapter: RecapDoc['chapters'][number], max = CHAPTER_HIGHLIGHTS): Highlight[] {
  const winners = listNames(chapter.winners.map((w) => w.name))
  const repeat = winners ? `${winners} won ${chapter.title}` : null
  return chapter.highlights
    .map((highlight, order) => ({ highlight, order }))
    .filter(({ highlight }) => highlight.title !== repeat)
    .sort((a, b) => WEIGHT_ORDER[a.highlight.weight ?? 'line'] - WEIGHT_ORDER[b.highlight.weight ?? 'line'] || a.order - b.order)
    .slice(0, max)
    .map(({ highlight }) => highlight)
}

/** The latest lead changes, oldest of them first. */
export function shownLeadChanges(doc: RecapDoc, max = LEAD_CHANGES_SHOWN): RecapDoc['leadChanges'] {
  return [...doc.leadChanges].sort((a, b) => a.at - b.at).slice(-max)
}

/** "21:40": the recap's times of the night, by the same clock as the TV's frame. */
export { clockTime } from '@/components/tv/clock'
