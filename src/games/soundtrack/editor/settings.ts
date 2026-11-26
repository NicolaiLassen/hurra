// Lydspor's settings as the editor holds them (spec section 12): read in full
// shape from whatever was saved, kept as typed (the game trims at the start,
// so a space typed between two words survives), and the game's own problems
// and warnings (checkConfig) placed under the fields they are about. Pure, so
// the tests pin it.
import type { PlayerId } from '../../core/Game'
import { MAX_START } from '../logic'
import { normalise } from '../match'
import type { SoundtrackConfig, SoundtrackPhoto, SoundtrackSong } from '../types'

const record = (value: unknown) =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
const text = (value: unknown) => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '')
const texts = (value: unknown) => (Array.isArray(value) ? value.map(text) : [])
const ids = (value: unknown): PlayerId[] => (Array.isArray(value) ? value.filter((id): id is PlayerId => typeof id === 'string' && id !== '') : [])
const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)

export const emptySong = (): SoundtrackSong => ({
  title: '',
  singer: '',
  alsoTitles: [],
  alsoSingers: [],
  photo: '',
  caption: '',
  startAt: 0,
  note: '',
  inPhoto: [],
})

function readSong(raw: unknown): SoundtrackSong {
  const song = record(raw)
  return {
    title: text(song.title),
    singer: text(song.singer),
    alsoTitles: texts(song.alsoTitles),
    alsoSingers: texts(song.alsoSingers),
    photo: text(song.photo),
    caption: text(song.caption),
    startAt: num(song.startAt, 0),
    note: text(song.note),
    inPhoto: ids(song.inPhoto),
  }
}

function readPhoto(raw: unknown): SoundtrackPhoto {
  const photo = record(raw)
  return { photo: text(photo.photo), caption: text(photo.caption) }
}

/** The settings in their full shape, whatever was stored, with the game's defaults where nothing was. */
export function readSettings(raw: unknown): SoundtrackConfig {
  const config = record(raw)
  const points = record(config.points)
  return {
    songs: Array.isArray(config.songs) ? config.songs.map(readSong) : [],
    extraPhotos: Array.isArray(config.extraPhotos) ? config.extraPhotos.map(readPhoto) : [],
    points: { event: num(points.event, 2), title: num(points.title, 1), singer: num(points.singer, 1) },
    lastCallSeconds: num(config.lastCallSeconds, 60),
    standingsEvery: num(config.standingsEvery, 4),
    hints: config.hints === true,
    boardMax: num(config.boardMax, 20),
    intro: text(config.intro),
    storyteller: text(config.storyteller),
    sitOut: ids(config.sitOut),
  }
}

/**
 * Where the hook starts, as typed: "0:48" or "1:02" (m:ss), or whole seconds
 * ("48"). Null for anything else, or past the first hour.
 */
export function parseStart(typed: string): number | null {
  const value = typed.trim()
  const seconds = /^\d{1,4}$/.test(value)
    ? Number(value)
    : /^(\d{1,2}):([0-5]\d)$/.test(value)
      ? Number(value.split(':')[0]) * 60 + Number(value.split(':')[1])
      : null
  return seconds !== null && seconds <= MAX_START ? seconds : null
}

/** A whole number from a number field: empty or not a number is 0, the game refuses what is out of range. */
export const wholeFrom = (typed: string) => {
  const number = Number(typed)
  return typed.trim() === '' || !Number.isFinite(number) ? 0 : Math.round(number)
}

export type Issue = { text: string; kind: 'problem' | 'warning' }

/** The fields outside the song cards that problems and warnings are about. */
export type FieldKey = 'songs' | 'extras' | 'points' | 'lastCall' | 'standings' | 'boardMax' | 'intro' | 'storyteller'

export type PlacedIssues = {
  /** Per song, by index. */
  songs: Issue[][]
  /** Per extra photo, by index. */
  extras: Issue[][]
  fields: Record<FieldKey, Issue[]>
}

const FIELD_PATTERNS: [RegExp, FieldKey][] = [
  [/^Add at least one song|^Lydspor takes at most \d+ songs/, 'songs'],
  [/^Lydspor takes at most \d+ extra photos|^Add at least \d+ extra photos|extra photos?: \d+ keep|^The same photo is used twice/, 'extras'],
  [/^Points must/, 'points'],
  [/^Last call takes/, 'lastCall'],
  [/^The top 5 shows/, 'standings'],
  [/^The most on the night board/, 'boardMax'],
  [/^The intro line/, 'intro'],
  [/^The storyteller/, 'storyteller'],
]

/**
 * Places each of checkConfig's problems and warnings under what it is about:
 * "Song 3: ..." under song 3 (its "Song 3:" dropped, since the card says
 * it), "Songs 2 and 5 ..." under song 5, "Two songs are called X" under each
 * song with that title, "Extra photo 2 ..." under that photo, the rest under
 * their field. Anything unknown goes under the songs.
 */
export function placeIssues(problems: readonly string[], warnings: readonly string[], songs: readonly Pick<SoundtrackSong, 'title'>[], extras: number): PlacedIssues {
  const placed: PlacedIssues = {
    songs: songs.map(() => []),
    extras: Array.from({ length: extras }, () => []),
    fields: { songs: [], extras: [], points: [], lastCall: [], standings: [], boardMax: [], intro: [], storyteller: [] },
  }
  const place = (message: string, kind: Issue['kind']) => {
    const song = /^Song (\d+)(:?)\s*(.*)$/.exec(message)
    if (song && placed.songs[Number(song[1]) - 1]) {
      const rest = song[2] === ':' ? song[3].charAt(0).toUpperCase() + song[3].slice(1) : message
      placed.songs[Number(song[1]) - 1].push({ text: rest, kind })
      return
    }
    const pair = /^Songs (\d+) and (\d+)\b/.exec(message)
    if (pair && placed.songs[Number(pair[2]) - 1]) {
      placed.songs[Number(pair[2]) - 1].push({ text: message, kind })
      return
    }
    const twice = /^Two songs are called (.+)$/.exec(message)
    if (twice) {
      const key = normalise(twice[1])
      const at = songs.map((s, i) => (normalise(s.title) === key ? i : -1)).filter((i) => i >= 0)
      if (at.length > 0) {
        for (const i of at) placed.songs[i].push({ text: message, kind })
        return
      }
    }
    const extra = /^Extra photo (\d+)(:?)\s*(.*)$/.exec(message)
    if (extra && placed.extras[Number(extra[1]) - 1]) {
      const rest = extra[2] === ':' ? extra[3].charAt(0).toUpperCase() + extra[3].slice(1) : message
      placed.extras[Number(extra[1]) - 1].push({ text: rest, kind })
      return
    }
    const field = FIELD_PATTERNS.find(([pattern]) => pattern.test(message))?.[1] ?? 'songs'
    placed.fields[field].push({ text: message, kind })
  }
  for (const problem of problems) place(problem, 'problem')
  for (const warning of warnings) place(warning, 'warning')
  return placed
}
