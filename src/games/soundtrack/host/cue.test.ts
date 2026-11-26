import { describe, expect, it } from 'vitest'
import { SAMPLE_SONGS } from '../samples'
import type { SoundtrackSong } from '../types'
import { cueOf, startText, titleLine, whileStory, type CueInput } from './cue'
import { cueListRows } from './cueRows'
import type { Where } from './steps'

const songs: SoundtrackSong[] = SAMPLE_SONGS.map((song, i) => ({
  title: song.title,
  singer: song.singer,
  alsoTitles: [],
  alsoSingers: [],
  photo: `a/b/${i}.jpg`,
  caption: song.caption,
  startAt: song.startAt,
  note: i === 0 ? 'The night the boat broke down.' : '',
}))
const config = { songs, storyteller: 'Ida', lastCallSeconds: 60 }
// Each sample start, read as clock time "HH:MM", is the minute it stands for.
const clock = (at: number) => `21:${String(at).padStart(2, '0')}`

const where = (w: Partial<Where>): Where => ({
  phase: 'lobby',
  played: 0,
  total: 8,
  revealed: 0,
  standingsEvery: 4,
  lastCallSeconds: 60,
  extended: 0,
  closing: false,
  ...w,
})

const cue = (w: Partial<Where>, extra: Partial<CueInput> = {}) =>
  cueOf({ where: where(w), config, playedAt: [1, 3, 5, 7, 9, 11, 13, 20], lockedAt: 24, tallies: {}, playing: 22, title: 'Lydspor', clock, ...extra })

const line = (c: ReturnType<typeof cueOf>) => [c.lead, c.text, c.note].filter(Boolean).join(' ')

describe('the cue card', () => {
  it('names the first track by number and start in the lobby', () => {
    expect(line(cue({ phase: 'lobby' }))).toBe('Spotify: the Lydspor playlist, track 1, from 0:48. Press play, then tap Play song 1.')
  })

  it('while songs play: when the song started, the counts, and the next track by number and start only', () => {
    const c = cue({ phase: 'playing', played: 5 }, { tallies: { 's5.title': 19, 's5.singer': 14, 's5.event': 12, 's4.title': 21 } })
    expect(line(c)).toBe('Song 5 started at 21:09. When the room is ready: pause, next track (6), seek to 0:54, press play, then tap Play song 6.')
    expect(c.counts).toEqual({ title: 19, singer: 14, event: 12, of: 22 })
    // A guest sitting out who answers anyway never makes it 23 of 22.
    expect(cue({ phase: 'playing', played: 5 }, { tallies: { 's5.title': 23 } }).counts!.title).toBe(22)
    expect(line(cue({ phase: 'playing', played: 8 }))).toBe(
      'Song 8 started at 21:20. When the room is ready: pause, then tap Last call. Answers lock 60 s later.',
    )
  })

  it('never names a title or singer before the lock: the host phone is out in the room', () => {
    for (const w of [{ phase: 'lobby' as const }, { phase: 'playing' as const, played: 3 }, { phase: 'playing' as const, played: 8 }, { phase: 'lastCall' as const, played: 8 }]) {
      const text = line(cue(w))
      for (const song of songs) {
        expect(text).not.toContain(song.title)
        expect(text).not.toContain(song.singer)
      }
    }
  })

  it('counts down itself in the last call', () => {
    expect(cue({ phase: 'lastCall', played: 8 })).toMatchObject({ lead: null, text: 'It locks by itself.' })
    expect(cue({ phase: 'lastCall', played: 8, closing: true })).toMatchObject({ lead: null, text: 'Reading every answer.' })
  })

  it('names the songs once the answers are locked, with the storyteller and the story note', () => {
    expect(line(cue({ phase: 'locked', played: 8 }))).toBe(
      'Answers locked at 21:24. Track 1 is Paper Lanterns, Mira Holm, from 0:48. Tap Reveal song 1, then play the hook while Ida tells the story. The night the boat broke down.',
    )
    expect(line(cue({ phase: 'reveal', played: 8, revealed: 1 }))).toBe(
      'Song 1: Paper Lanterns, Mira Holm. Play track 1 from 0:48 while Ida tells the story. Check the close answers below. The night the boat broke down.',
    )
    expect(line(cue({ phase: 'standings', played: 8, revealed: 4 }))).toBe(
      'Lydspor’s top 5 is on the TV. Next, track 5 is Natlys (Radio Edit), R.O.S.A., from 0:20. Tap Reveal song 5, then play the hook while Ida tells the story.',
    )
  })

  it('says what follows the last reveal', () => {
    expect(cue({ phase: 'reveal', played: 8, revealed: 8 }).text).toMatch(/Then pause Spotify and tap Show the top 5\.$/)
    expect(cue({ phase: 'reveal', played: 6, revealed: 6 }).text).toMatch(/Then pause Spotify and tap Show the top 5\.$/)
    expect(cue({ phase: 'reveal', played: 8, revealed: 8, standingsEvery: 0 }).text).toMatch(/Then pause Spotify and tap Crown Lydspor\.$/)
    expect(line(cue({ phase: 'standings', played: 8, revealed: 8 }))).toBe('Lydspor’s top 5 is on the TV. Pause Spotify. Tap Crown Lydspor.')
  })

  it('works without a storyteller and without the settings', () => {
    expect(whileStory('')).toBe('during the story')
    const bare = cueOf({ where: where({ phase: 'reveal', played: 8, revealed: 2 }), config: null, playedAt: [], lockedAt: null, tallies: {}, playing: 0, title: 'Lydspor', clock })
    expect(line(bare)).toBe('Song 2 is on the TV. Play track 2 during the story. Check the close answers below.')
  })

  it('writes the hook start as m:ss', () => {
    expect([0, 9, 48, 62, 600, 3599].map(startText)).toEqual(['0:00', '0:09', '0:48', '1:02', '10:00', '59:59'])
  })
})

describe('Hold to show the title', () => {
  it('shows the song playing and the next track while songs play, and nothing after', () => {
    expect(titleLine(where({ phase: 'lobby' }), songs)).toBe('Track 1 is Paper Lanterns, Mira Holm.')
    expect(titleLine(where({ phase: 'playing', played: 2 }), songs)).toBe('Song 2 is Seven Ferries, Coldwave. Next, track 3 is Blå Mandag, Søren Bækgaard.')
    expect(titleLine(where({ phase: 'playing', played: 8 }), songs)).toBe('Song 8 is Route 41, Mira Holm feat. Kasper Lind.')
    expect(titleLine(where({ phase: 'lastCall', played: 8 }), songs)).toBeNull()
    expect(titleLine(where({ phase: 'locked', played: 8 }), songs)).toBeNull()
  })
})

describe('the cue list', () => {
  it('shows a title only once its song is revealed, and the close answers left on revealed songs', () => {
    const rows = cueListRows({ songs }, 8, 'reveal', [1, 3, 5, 7, 9, 11, 13, 20], 2, (i) => (i === 0 ? 2 : 1))
    expect(rows.map((r) => r.named?.title ?? null)).toEqual(['Paper Lanterns', 'Seven Ferries', null, null, null, null, null, null])
    expect(rows.map((r) => r.close)).toEqual([2, 1, 0, 0, 0, 0, 0, 0])
    expect(rows.every((r) => r.state === 'played')).toBe(true)
  })

  it('marks the song playing Now and the next track Next', () => {
    const rows = cueListRows({ songs }, 8, 'playing', [1, 3, 5], 0, () => 0)
    expect(rows.map((r) => r.state)).toEqual(['played', 'played', 'now', 'next', 'later', 'later', 'later', 'later'])
    expect(rows.every((r) => r.named === null)).toBe(true)
    expect(cueListRows({ songs }, 8, 'lobby', [], 0, () => 0)[0].state).toBe('next')
  })
})
