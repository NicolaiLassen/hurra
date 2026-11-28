// Lydspor's projections as the screens read them. Snapshots carry them as
// plain JSON (a fixture, or a save from an older bundle), so every screen
// reads them through these, which fill in what is missing instead of
// crashing. Relative imports only, no React: the TV, the phone and the host
// room all read through this file.
import type { AnswerPayload, PlayerId } from '../core/Game'
import {
  NO_PHOTO,
  type EventResult,
  type PartResult,
  type Picks,
  type SoundtrackPhase,
  type SoundtrackPlayerView,
  type SoundtrackPoints,
  type SoundtrackPublicState,
  type SoundtrackReveal,
  type SoundtrackSongView,
} from './types'

const PHASES: readonly SoundtrackPhase[] = ['lobby', 'playing', 'lastCall', 'locked', 'reveal', 'standings', 'done']
const PART_RESULTS: readonly PartResult[] = ['exact', 'typo', 'accepted', 'close', 'wrong', 'none']
const EVENT_RESULTS: readonly EventResult[] = ['right', 'wrong', 'doubled', 'none']

const record = (value: unknown) =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
const list = (value: unknown) => (Array.isArray(value) ? value : [])
const number = (value: unknown, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
const maybeNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const text = (value: unknown) => (typeof value === 'string' ? value : '')
const rows = (value: unknown) => list(value).map(record).filter((row): row is Record<string, unknown> => row !== null)
const isId = (row: Record<string, unknown>) => typeof row.playerId === 'string'

function readPoints(raw: unknown): SoundtrackPoints {
  const points = record(raw) ?? {}
  return { event: number(points.event, 2), title: number(points.title, 1), singer: number(points.singer, 1) }
}

function readReveal(raw: unknown): SoundtrackReveal | null {
  const reveal = record(raw)
  if (!reveal) return null
  const counts = record(reveal.counts) ?? {}
  return {
    n: number(reveal.n, 1),
    event: number(reveal.event, -1),
    title: text(reveal.title),
    singer: text(reveal.singer),
    caption: text(reveal.caption),
    moment: text(reveal.moment),
    counts: { event: number(counts.event), title: number(counts.title), singer: number(counts.singer) },
    scoring: number(reveal.scoring),
  }
}

/** The public state in its full shape, or null when there is none yet. */
export function readPublic(raw: unknown): SoundtrackPublicState | null {
  const pub = record(raw)
  if (!pub || !PHASES.includes(pub.phase as SoundtrackPhase)) return null
  const playedAt = list(pub.playedAt).filter((at): at is number => typeof at === 'number' && Number.isFinite(at))
  const final = Array.isArray(pub.final)
    ? rows(pub.final)
        .filter(isId)
        .map((row) => ({ playerId: row.playerId as PlayerId, points: number(row.points), place: number(row.place, 1), paid: number(row.paid) }))
    : null
  return {
    phase: pub.phase as SoundtrackPhase,
    total: number(pub.total, playedAt.length),
    playedAt,
    wall: rows(pub.wall).map((photo) => ({ path: text(photo.path), hint: typeof photo.hint === 'string' ? photo.hint : null })),
    momentTyped: pub.momentTyped === true,
    points: readPoints(pub.points),
    lockAt: maybeNumber(pub.lockAt),
    lockedAt: maybeNumber(pub.lockedAt),
    playing: number(pub.playing),
    revealed: number(pub.revealed),
    reveal: readReveal(pub.reveal),
    extras: Array.isArray(pub.extras) ? rows(pub.extras).map((photo) => ({ path: text(photo.path), caption: text(photo.caption) })) : null,
    top: rows(pub.top)
      .filter(isId)
      .map((row) => ({
        playerId: row.playerId as PlayerId,
        points: number(row.points),
        rank: number(row.rank, 1),
        gained: number(row.gained),
      })),
    final,
    intro: text(pub.intro),
    storyteller: text(pub.storyteller),
  }
}

/** A guest's answers per song, with every list as long as the songs it covers. */
function readPicks(raw: unknown): Picks | null {
  const picks = record(raw)
  if (!picks) return null
  const events = list(picks.event).map((e) => (typeof e === 'number' && Number.isInteger(e) ? e : null))
  const typed = (value: unknown) => list(value).map((t) => (typeof t === 'string' && t !== '' ? t : null))
  const title = typed(picks.title)
  const singer = typed(picks.singer)
  const moment = Array.isArray(picks.moment) ? typed(picks.moment) : null
  const songs = Math.max(events.length, title.length, singer.length, moment?.length ?? 0)
  const pad = <T>(items: (T | null)[]) => Array.from({ length: songs }, (_, i) => items[i] ?? null)
  return { event: pad(events), title: pad(title), singer: pad(singer), ...(moment ? { moment: pad(moment) } : {}) }
}

function readSong(row: Record<string, unknown>, i: number): SoundtrackSongView {
  const part = (value: unknown): PartResult => (PART_RESULTS.includes(value as PartResult) ? (value as PartResult) : 'none')
  return {
    n: number(row.n, i + 1),
    points: number(row.points),
    event: EVENT_RESULTS.includes(row.event as EventResult) ? (row.event as EventResult) : 'none',
    title: part(row.title),
    singer: part(row.singer),
    moment: part(row.moment),
  }
}

/** A guest's own view in its full shape, or null when they have none. */
export function readView(raw: unknown): SoundtrackPlayerView | null {
  const view = record(raw)
  if (!view) return null
  const final = record(view.final)
  return {
    sittingOut: view.sittingOut === true,
    mine: readPicks(view.mine),
    songs: rows(view.songs).map(readSong),
    points: number(view.points),
    rank: typeof view.rank === 'number' && view.rank > 0 ? view.rank : null,
    final: final
      ? { points: number(final.points), place: number(final.place, 1), paid: number(final.paid) }
      : null,
  }
}

/** The text of a typed answer as the database holds it, or null. */
export function answerText(answer: AnswerPayload | undefined | null): string | null {
  if (!answer || !('text' in answer) || typeof answer.text !== 'string' || answer.text === '') return null
  return answer.text
}

/** The wall index an event answer holds; null for no photo or no answer. */
export function answerPhoto(answer: AnswerPayload | undefined | null): number | null {
  if (!answer || !('choice' in answer) || !Array.isArray(answer.choice) || answer.choice[0] === NO_PHOTO) return null
  const index = Number(answer.choice[0])
  return Number.isInteger(index) && index >= 0 ? index : null
}
