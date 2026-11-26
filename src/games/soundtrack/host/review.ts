// The host's review of a revealed song's typed answers (spec 10.1): the close
// answers to accept, the other answers in a fold, and what the rule counted
// already. Read from the state the lock built (`review`), never from guests'
// phones. Pure, so the tests pin it against the logic's own counts.
import type { PlayerId } from '../../core/Game'
import type { ReviewRow, SoundtrackConfig, SoundtrackState, TypedPart } from '../types'

export type PartReview = {
  part: TypedPart
  /** The truth as the reveal shows it. */
  truth: string
  /** Close answers, most guests first, then fewest letters off. */
  close: ReviewRow[]
  /** Wrong answers, most guests first: the host may still accept one (a cover, a nickname). */
  wrong: ReviewRow[]
  /** Answers the rule counted for a typo: shown read-only, so the host sees what it gave. */
  typo: ReviewRow[]
  /** Scoring guests whose answer counts, the host's accepts included. */
  got: number
}

export type SongReview = {
  /** The song's number, from 1. */
  n: number
  index: number
  /** Scoring guests for this song: present, not sitting out, not in its photo, with any answer at the lock. */
  of: number
  title: PartReview
  singer: PartReview
}

const counts = (row: ReviewRow) => row.verdict === 'exact' || row.verdict === 'typo' || row.accepted

/** Who can score on song `index`, as the logic counts them (spec 8.2). */
export function scoringOn(state: Pick<SoundtrackState, 'sitOut' | 'picks' | 'inPhoto'>, players: readonly { id: PlayerId }[], index: number): Set<PlayerId> {
  const sitOut = new Set(state.sitOut)
  const inPhoto = new Set(state.inPhoto[index] ?? [])
  const picks = state.picks ?? {}
  return new Set(players.map((p) => p.id).filter((id) => !sitOut.has(id) && !inPhoto.has(id) && Object.hasOwn(picks, id)))
}

/**
 * Song `index`'s review for the host, or null before the lock. Each row keeps
 * only the guests it can score for, and a row with none of them left (only
 * someone sitting out, or in the photo, typed it) is dropped: accepting it
 * would change nothing.
 */
export function songReview(
  state: Pick<SoundtrackState, 'review' | 'sitOut' | 'picks' | 'inPhoto'>,
  config: Pick<SoundtrackConfig, 'songs'> | null,
  players: readonly { id: PlayerId }[],
  index: number,
): SongReview | null {
  const song = state.review?.[index]
  if (!song) return null
  const scoring = scoringOn(state, players, index)
  const part = (name: TypedPart): PartReview => {
    const rows = (song[name] ?? [])
      .map((row) => ({ ...row, players: row.players.filter((id) => scoring.has(id)) }))
      .filter((row) => row.players.length > 0)
    const truth = config?.songs[index]?.[name] ?? ''
    return {
      part: name,
      truth,
      close: rows.filter((row) => row.verdict === 'close'),
      wrong: rows.filter((row) => row.verdict === 'wrong'),
      typo: rows.filter((row) => row.verdict === 'typo'),
      got: rows.filter(counts).reduce((sum, row) => sum + row.players.length, 0),
    }
  }
  return { n: index + 1, index, of: scoring.size, title: part('title'), singer: part('singer') }
}

/** Close answers on song `index` the host hasn't accepted yet: the cue list's "2 close". */
export function closeLeft(review: SongReview | null): number {
  if (!review) return 0
  return [...review.title.close, ...review.singer.close].filter((row) => !row.accepted).length
}

/** Why a close answer is close, as its quiet tag in the review. */
export function reasonTag(row: Pick<ReviewRow, 'reason' | 'off'>, part: TypedPart): string {
  switch (row.reason) {
    case 'spelling':
      return row.off === null ? 'Spelling' : `${row.off} ${row.off === 1 ? 'letter' : 'letters'} off`
    case 'part':
      return 'Part of it'
    case 'extra':
      return 'With extra words'
    case 'order':
      return 'Words in another order'
    case 'otherPart':
      return part === 'title' ? "That's the singer" : "That's the title"
    default:
      return 'Close'
  }
}

/** "1 guest", "3 guests". */
export const guests = (count: number) => `${count} ${count === 1 ? 'guest' : 'guests'}`

/** The id of an Accept or Undo in flight, so its button shows it. */
export const acceptId = (index: number, part: TypedPart, key: string) => `accept:${index}:${part}:${key}`
