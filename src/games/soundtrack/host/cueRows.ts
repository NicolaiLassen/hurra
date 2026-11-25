// The rows of the host's cue list (spec section 10), pure so the tests pin
// what it may show: a song's title only once it is revealed.
import type { SoundtrackConfig, SoundtrackPhase } from '../types'

export type CueListRow = {
  n: number
  startAt: number | null
  /** When it was played, by the database clock. */
  playedAt: number | null
  /** Title and singer, only once the song is revealed. */
  named: { title: string; singer: string } | null
  /** Close answers the host hasn't accepted yet, on a revealed song. */
  close: number
  state: 'played' | 'now' | 'next' | 'later'
}

/** Every song for the cue list: its number and start, where it is, and its title only once revealed. */
export function cueListRows(
  config: Pick<SoundtrackConfig, 'songs'> | null,
  total: number,
  phase: SoundtrackPhase,
  playedAt: readonly number[],
  revealed: number,
  closeLeft: (index: number) => number,
): CueListRow[] {
  const played = playedAt.length
  const playing = phase === 'playing' || phase === 'lastCall'
  const songsOn = phase === 'lobby' || phase === 'playing'
  return Array.from({ length: Math.max(total, config?.songs.length ?? 0) }, (_, i) => {
    const song = config?.songs[i]
    const isRevealed = i < revealed
    return {
      n: i + 1,
      startAt: song ? song.startAt : null,
      playedAt: playedAt[i] ?? null,
      named: isRevealed && song ? { title: song.title, singer: song.singer } : null,
      close: isRevealed ? closeLeft(i) : 0,
      state: i < played ? (playing && i === played - 1 ? 'now' : 'played') : songsOn && i === played ? 'next' : 'later',
    }
  })
}
