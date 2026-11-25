// The cue card on the host phone (spec section 10): what to do in Spotify
// and in the app, phase by phase. While songs play it names tracks by number
// and start only, never by title, since the host phone is out in the room and
// the playlist runs in order; the titles come once the answers are locked.
// Pure, so the tests pin every line. Times are the ones the database holds.
import { promptKey, type SoundtrackConfig, type SoundtrackSong } from '../types'
import { topDue, type Where } from './steps'

export type Cue = {
  /** The first sentence, in bold. Null in the last call: the card counts down itself. */
  lead: string | null
  /** What to do next, after the lead. */
  text: string
  /** While songs play: how many typed a title, a singer and tapped a photo for the song playing. */
  counts: { title: number; singer: number; event: number; of: number } | null
  /** The story note of the song this cue is about. */
  note: string | null
}

export type CueInput = {
  where: Where
  /** Null while the settings load: the cue then says what it can without them. */
  config: Pick<SoundtrackConfig, 'songs' | 'storyteller' | 'lastCallSeconds'> | null
  playedAt: readonly number[]
  lockedAt: number | null
  tallies: Readonly<Record<string, number>>
  /** Present guests minus those sitting out: the "of" while songs play. */
  playing: number
  /** The game's title, for "the Lydspor playlist". */
  title: string
  clock: (at: number) => string
}

/** 48 as "0:48", 62 as "1:02". */
export function startText(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** "while Ida tells the story", or without a storyteller "during the story". */
export const whileStory = (storyteller: string) => (storyteller.trim() ? `while ${storyteller.trim()} tells the story` : 'during the story')

const from = (song: SoundtrackSong | undefined) => (song ? `, from ${startText(song.startAt)}` : '')
const noteOf = (song: SoundtrackSong | undefined) => (song?.note.trim() ? song.note.trim() : null)
const named = (song: SoundtrackSong | undefined) => (song ? `${song.title}, ${song.singer}` : null)

export function cueOf({ where, config, playedAt, lockedAt, tallies, playing, title, clock }: CueInput): Cue {
  const { phase, played, total, revealed } = where
  const songs = config?.songs ?? []
  const song = (n: number) => songs[n - 1]
  const story = whileStory(config?.storyteller ?? '')
  const startedAt = playedAt[played - 1]
  const startLine = startedAt !== undefined ? `Song ${played} started at ${clock(startedAt)}.` : `Song ${played} is playing.`
  switch (phase) {
    case 'lobby':
      return {
        lead: `Spotify: the ${title} playlist, track 1${from(song(1))}.`,
        text: 'Press play, then tap Play song 1.',
        counts: null,
        note: null,
      }
    case 'playing': {
      // Tallies count every first answer, a guest sitting out included (their phone asks nothing, but the
      // database takes an answer): never more than the guests playing.
      const tally = (part: 'title' | 'singer' | 'event') => Math.min(tallies[promptKey(played, part)] ?? 0, playing)
      const counts = { title: tally('title'), singer: tally('singer'), event: tally('event'), of: playing }
      if (played < total) {
        const next = played + 1
        const seek = song(next) ? `seek to ${startText(song(next)!.startAt)}, ` : ''
        return {
          lead: startLine,
          text: `When the room is ready: pause, next track (${next}), ${seek}press play, then tap Play song ${next}.`,
          counts,
          note: null,
        }
      }
      const seconds = config ? ` Answers lock ${config.lastCallSeconds} s later.` : ''
      return { lead: startLine, text: `When the room is ready: pause, then tap Last call.${seconds}`, counts, note: null }
    }
    case 'lastCall':
      return {
        lead: null,
        text: where.closing ? 'Reading every answer.' : 'It locks by itself.',
        counts: null,
        note: null,
      }
    case 'locked': {
      const lead = lockedAt !== null ? `Answers locked at ${clock(lockedAt)}.` : 'The answers are locked.'
      const track = named(song(1)) ? `Track 1 is ${named(song(1))}${from(song(1))}. ` : ''
      return { lead, text: `${track}Tap Reveal song 1, then play the hook ${story}.`, counts: null, note: noteOf(song(1)) }
    }
    case 'reveal': {
      const n = revealed
      const last = n >= played
      const then = !last ? '' : topDue(where) ? ' Then pause Spotify and tap Show the top 5.' : ' Then pause Spotify and tap Crown Lydspor.'
      return {
        lead: named(song(n)) ? `Song ${n}: ${named(song(n))}.` : `Song ${n} is on the TV.`,
        text: `Play track ${n}${from(song(n)).replace(', from', ' from')} ${story}. Check the close answers below.${then}`,
        counts: null,
        note: noteOf(song(n)),
      }
    }
    case 'standings': {
      if (revealed >= played) return { lead: `${title}'s top 5 is on the TV.`, text: 'Pause Spotify. Tap Crown Lydspor.', counts: null, note: null }
      const next = revealed + 1
      const track = named(song(next)) ? `Next, track ${next} is ${named(song(next))}${from(song(next))}. ` : ''
      return {
        lead: `${title}'s top 5 is on the TV.`,
        text: `${track}Tap Reveal song ${next}, then play the hook ${story}.`,
        counts: null,
        note: noteOf(song(next)),
      }
    }
    case 'done':
      return { lead: `${title} is over.`, text: 'Accepts are closed.', counts: null, note: null }
  }
}

/**
 * What "Hold to show the title" shows while songs play, for an operator who
 * lost their place in the playlist: the song playing and the next track.
 */
export function titleLine(where: Where, songs: readonly SoundtrackSong[]): string | null {
  const { phase, played } = where
  if (phase !== 'lobby' && phase !== 'playing') return null
  const line = (prefix: string, song: SoundtrackSong | undefined) => (song ? `${prefix} ${song.title}, ${song.singer}.` : null)
  const now = played > 0 ? line(`Song ${played} is`, songs[played - 1]) : null
  const next = played < songs.length ? line(`Track ${played + 1} is`, songs[played]) : null
  const text = [now, next ? (now ? next.replace(/^Track/, 'Next, track') : next) : null].filter(Boolean).join(' ')
  return text || null
}
