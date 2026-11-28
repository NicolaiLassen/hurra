// What Lydspor's TV says (.design/lydspor/spec.md, section 9), as pure
// functions of the public state, so the words are tested. No React and no
// motion: TvStatus reads these too, and the registry brings TvStatus to every
// phone. The TV never shows a typed answer: nothing here reads one, and the
// public state carries none.
import { joinNames } from '../logic'
import { letterOf, type SoundtrackPoints, type SoundtrackPublicState, type SoundtrackReveal } from '../types'

const WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve']

/** "Eight" for 8, up to twelve; larger numbers as figures. */
export function numberWord(n: number): string {
  return WORDS[n] ?? String(n)
}

export const plural = (n: number, word: string, words = `${word}s`) => `${n} ${n === 1 ? word : words}`

/** The lobby's first line: the host's intro, else "Eight songs, eight events. Pair each song with its event." */
export function lobbyLine(pub: Pick<SoundtrackPublicState, 'intro' | 'storyteller' | 'total'> & { momentTyped?: boolean }): string {
  const intro = pub.intro.trim()
  if (intro) return intro
  if (pub.momentTyped) {
    if (pub.total === 1) return 'One song, one moment. Name the song and its moment.'
    const n = numberWord(pub.total)
    return `${n} songs, ${n.toLowerCase()} moments. Name each song and its moment.`
  }
  if (pub.total === 1) return 'One song, one event. Pair the song with its event.'
  const n = numberWord(pub.total)
  return `${n} songs, ${n.toLowerCase()} events. Pair each song with its event.`
}

/** The lobby's rules, in the phone's order (spec 4.1), short enough for the TV. */
export const RULES = [
  'A song plays. Type its title and who sings it, then tap its photo.',
  'Close spelling counts. Any song can change until the last call.',
  'Each photo fits one song. Some photos fit none.',
] as const

/** The rules with typed moments on: each song shows its own photo, and the phones type its moment. */
export const MOMENT_RULES = [
  'A song plays and its photo shows. Type the moment, the title and who sings it.',
  'Close spelling counts. Any song can change until the last call.',
  'Each song has its own photo. The moment is what happened in it.',
] as const

/** The rules with typed moments on the wall: the photo is picked, and the moment, title and singer typed. */
export const WALL_MOMENT_RULES = [
  'A song plays. Type its moment, its title and who sings it, and pick its photo from the wall.',
  'Close spelling counts. Any song can change until the last call.',
  'Each photo fits one song. Every part scores on its own.',
] as const

/** The lobby's rules for the mode. */
export const rulesFor = (momentTyped: boolean, onWall = false): readonly string[] =>
  momentTyped && onWall ? WALL_MOMENT_RULES : momentTyped ? MOMENT_RULES : RULES

/** The points a song gives, as the lobby's chips: Event +2, Title +1, Singer +1 (Moment +2 with typed moments on). */
export function pointChips(points: SoundtrackPoints, momentTyped = false, onWall = false): { label: string; points: number }[] {
  if (momentTyped && onWall) {
    return [
      { label: 'Picture', points: points.event },
      { label: 'Moment', points: points.moment ?? 2 },
      { label: 'Title', points: points.title },
      { label: 'Singer', points: points.singer },
    ]
  }
  return [
    { label: momentTyped ? 'Moment' : 'Event', points: points.event },
    { label: 'Title', points: points.title },
    { label: 'Singer', points: points.singer },
  ]
}

/** Who reveals the songs: "Then Ida reveals each song and tells its story." */
export function revealsLine(storyteller: string): string {
  const name = storyteller.trim()
  return name ? `Then ${name} reveals each song and tells its story.` : 'Then each song is revealed with its story.'
}

/** Under "Song 5 is playing.": what to do, and that nothing is final yet. */
export const PLAYING_LINE = 'Type its title and who sings it on your phone, and tap its photo. Any song can change until the last call.'

/** Under "Song 5 is playing." with typed moments on. */
export const MOMENT_PLAYING_LINE = 'Type its moment, its title and who sings it on your phone. Any song can change until the last call.'

/** Under "Song 5 is playing." with typed moments on the wall. */
export const WALL_MOMENT_PLAYING_LINE = 'Type its moment, its title and who sings it on your phone, and pick its photo. Any song can change until the last call.'

/** Under the last call's countdown (the strap says Last call). */
export const LAST_CALL_LINE = 'Check every song on your phone now. Then all the answers lock.'

/** After the lock: what comes next. */
export function lockedLine(storyteller: string): string {
  const name = storyteller.trim()
  return name
    ? `Up first: song 1. ${name} reveals the songs in order and tells each story.`
    : 'Up first: song 1. The songs are revealed in order, each with its story.'
}

/** The reveal's last line: "Ida tells the story.", or "Story time." without a storyteller. */
export function storyLine(storyteller: string): string {
  const name = storyteller.trim()
  return name ? `${name} tells the story.` : 'Story time.'
}

/** "have typed a title", or "has typed a title" for one. */
export const typedWords = (count: number) => (count === 1 ? 'has typed a title' : 'have typed a title')

/** One count at the reveal: the figure ("15 of 22") and its words ("got the event, photo B"). */
export type RevealCount = { part: 'event' | 'moment' | 'title' | 'singer'; figure: string; words: string }

/**
 * The reveal's three counts, of the guests who could score on this song (the
 * host's accepts included). Empty when nobody could: the screen then says so.
 */
export function revealCounts(reveal: Pick<SoundtrackReveal, 'counts' | 'scoring' | 'event'>, momentTyped = false): RevealCount[] {
  if (reveal.scoring <= 0) return []
  const of = (n: number) => `${n} of ${reveal.scoring}`
  const event = momentTyped ? 'got the moment' : reveal.event >= 0 ? `got the event, photo ${letterOf(reveal.event)}` : 'got the event'
  return [
    { part: 'event', figure: of(reveal.counts.event), words: event },
    { part: 'title', figure: of(reveal.counts.title), words: 'got the title' },
    { part: 'singer', figure: of(reveal.counts.singer), words: 'got the singer' },
  ]
}

/**
 * With typed moments on the wall: the four counts, the picture first. In a
 * game played in teams (every guest who could score has a team), each counts
 * teams: "3 of 4" "teams got the title". Otherwise guests, as revealCounts.
 */
export function wallRevealCounts(
  reveal: Pick<SoundtrackReveal, 'counts' | 'scoring' | 'event' | 'got'>,
  teamOf?: (playerId: string) => string | null | undefined,
): RevealCount[] {
  const photo = reveal.event >= 0 ? `the picture, photo ${letterOf(reveal.event)}` : 'the picture'
  const what = { event: photo, moment: 'the moment', title: 'the title', singer: 'the singer' } as const
  const parts = ['event', 'moment', 'title', 'singer'] as const
  const got = reveal.got
  const teams = got && teamOf && got.scoring.length > 0 && got.scoring.every((id) => teamOf(id)) ? new Set(got.scoring.map((id) => teamOf(id))) : null
  if (got && teams && teams.size >= 2) {
    return parts.map((part) => ({
      part,
      figure: `${new Set(got[part].map((id) => teamOf!(id))).size} of ${teams.size}`,
      words: `teams got ${what[part]}`,
    }))
  }
  if (reveal.scoring <= 0) return []
  const count = (part: (typeof parts)[number]) => (part === 'moment' ? (reveal.counts.moment ?? 0) : reveal.counts[part])
  return parts.map((part) => ({ part, figure: `${count(part)} of ${reveal.scoring}`, words: `got ${what[part]}` }))
}

/** When nobody could score on a revealed song. */
export const NOBODY_LINE = 'Nobody answered this one.'

/** The top 5's heading: "The top 5 after 4 songs", "The top 5 after all 8 songs". */
export function topHeading(revealed: number, played: number): string {
  if (revealed >= played && played > 1) return `The top 5 after all ${played} songs`
  return `The top 5 after ${plural(revealed, 'song')}`
}

/** The programme strap's words while Lydspor holds the stage (TvStatus `strap`). */
export function strapWords(pub: SoundtrackPublicState | null, finished = false): string {
  if (finished || pub?.phase === 'done') return 'Final result'
  if (!pub) return 'Getting ready'
  const played = pub.playedAt.length
  switch (pub.phase) {
    case 'lobby':
      return `${plural(pub.total, 'song')}, starting soon`
    case 'playing':
      return `Song ${played} of ${pub.total}`
    case 'lastCall':
      return 'Last call'
    case 'locked':
      return played === pub.total ? `All ${plural(played, 'song')} played` : `${played} of ${pub.total} songs played`
    case 'reveal':
      return `Reveal ${pub.revealed} of ${played}`
    case 'standings':
      return `After reveal ${pub.revealed} of ${played}`
  }
}

/** The points a song gives at most, and so the round: songs revealed times that. */
export const mostPoints = (pub: Pick<SoundtrackPublicState, 'points' | 'revealed'>) =>
  pub.revealed * (pub.points.event + pub.points.title + pub.points.singer)

/**
 * The deck under the winner's cheer: "Won Lydspor with 26 of 32 points.", or
 * for a shared win "Shared Lydspor with 26 of 32 points each."
 */
export function winnerDeck(title: string, winners: number, points: number, most: number): string {
  const of = most > 0 ? `${points} of ${most} points` : plural(points, 'point')
  return winners > 1 ? `Shared ${title} with ${of} each.` : `Won ${title} with ${of}.`
}

/** The line under the deck: who came next, "Ana was 2nd with 24 points." Null when nobody did. */
export function runnerUpLine(
  final: readonly { playerId: string; points: number; place: number }[] | null,
  nameOf: (id: string) => string,
): { names: string; text: string } | null {
  if (!final) return null
  const first = final.find((row) => row.place === 1)
  const next = final.filter((row) => row.place > 1 && row.points > 0)
  if (!first || next.length === 0) return null
  const place = Math.min(...next.map((row) => row.place))
  const rows = next.filter((row) => row.place === place)
  const names = joinNames(rows.map((row) => nameOf(row.playerId)))
  return { names, text: `${rows.length > 1 ? 'were' : 'was'} ${ordinal(place)} with ${plural(rows[0].points, 'point')}.` }
}

/** "2nd", "3rd", "11th". */
export function ordinal(n: number): string {
  const tens = n % 100
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
  return `${n}${suffix}`
}
