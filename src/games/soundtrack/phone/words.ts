// Lydspor's words on a guest's phone (.design/lydspor/spec.md, section 4),
// pure so words.test.ts pins them. No exclamation marks, no dashes, only
// clock times the database holds. Typed answers are shown as the guest typed
// them, in curly quotes, never corrected. Relative imports only.
import { letterOf, type EventResult, type PartResult, type Picks, type SongPart } from '../types'

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve']

/** "Eight songs", "One song", "13 songs". */
export function songsWord(count: number): string {
  const number = NUMBER_WORDS[count] ?? String(count)
  return `${number} ${count === 1 ? 'song' : 'songs'}`
}

/** The lobby's first line: the host's intro, else "Eight songs, eight events. Pair each song with its event." */
export function introLine(intro: string, total: number): string {
  const own = intro.trim()
  if (own !== '') return own
  if (total === 1) return 'One song, one event. Pair the song with its event.'
  const events = `${(NUMBER_WORDS[total] ?? String(total)).toLowerCase()} events`
  return `${songsWord(total)}, ${events}. Pair each song with its event.`
}

/** The lobby's last line: who reveals the songs, and where the points go. */
export function payoutLine(storyteller: string): string {
  const who = storyteller.trim()
  const reveal = who !== '' ? `Then ${who} reveals each song and tells its story.` : 'Then each song is revealed and its story told.'
  return `${reveal} Lydspor pays out on the night board.`
}

/** Songs not played yet: "Songs 7 and 8 come later.", "Song 8 comes later.", "Songs 6 to 8 come later." Null when none. */
export function laterLine(played: number, total: number): string | null {
  const first = played + 1
  if (first > total) return null
  if (first === total) return `Song ${total} comes later.`
  if (first + 1 === total) return `Songs ${first} and ${total} come later.`
  return `Songs ${first} to ${total} come later.`
}

/** The longest typed text a line quotes before it ends in an ellipsis. */
export const QUOTE_MAX = 40

/** A typed answer as typed, in curly quotes, cut with an ellipsis at 40 characters. */
export function quoted(text: string, max = QUOTE_MAX): string {
  const chars = Array.from(text.trim())
  const cut = chars.length > max ? `${chars.slice(0, max).join('').trimEnd()}…` : chars.join('')
  return `“${cut}”`
}

/** "Started at 21:01. You have “Seven Ferries” by “Coldwave”." for the photo sheet (spec 4.6). */
export function sheetReminder(startedAt: string | null, title: string | null, singer: string | null): string {
  const started = startedAt ? `Started at ${startedAt}.` : ''
  let have = ''
  if (title && singer) have = `You have ${quoted(title)} by ${quoted(singer)}.`
  else if (title) have = `You have ${quoted(title)}.`
  else if (singer) have = `You have a song by ${quoted(singer)}.`
  return [started, have].filter(Boolean).join(' ')
}

/** The question a missing part asks in the last call's one-tap rows: "who sings it?" */
export const MISSING_ASK: Record<SongPart, string> = {
  title: 'what is it called?',
  singer: 'who sings it?',
  event: 'which event?',
}

/** The cell of an empty part on the board, still open: "Type a title". */
export const EMPTY_CELL: Record<SongPart, string> = { title: 'Type a title', singer: 'Type a singer', event: 'Pick an event' }

/** After the photo on Now playing (spec 4.4): "Song 5 is named.", or what it still needs. */
export function namedLine(n: number, hasTitle: boolean, hasSinger: boolean): string {
  if (hasTitle && hasSinger) return `Song ${n} is named.`
  if (!hasTitle && !hasSinger) return `Song ${n} needs its title and singer.`
  return `Song ${n} needs its ${hasTitle ? 'singer' : 'title'}.`
}

/** The swap toast's two lines (spec 4.7), with the letters of the photos. */
export function swapToast(
  move: { kind: 'swap' | 'take'; n: number; other: number; photo: number; gave: number | null },
): { title: string; detail: string } {
  if (move.kind === 'take') {
    return { title: `Song ${move.n} took ${letterOf(move.photo)} from song ${move.other}.`, detail: `Song ${move.other} needs an event now.` }
  }
  const [a, b] = move.n < move.other ? [move.n, move.other] : [move.other, move.n]
  const photoOf = (song: number) => letterOf(song === move.n ? move.photo : (move.gave ?? 0))
  return { title: `Song ${a} and song ${b} swapped events.`, detail: `Song ${a} has ${photoOf(a)} now, song ${b} has ${photoOf(b)}.` }
}

/** "The storyteller tells the story." over "Look at the TV."; without a storyteller, "Story time." */
export function storyLine(storyteller: string): string {
  const who = storyteller.trim()
  return who !== '' ? `${who} tells the story.` : 'Story time.'
}

/** The sub line of a revealed title or singer (spec 4.11): what the guest typed and whether it counted. */
export function partLine(result: PartResult, typed: string | null): string {
  if (result === 'none' || typed === null) return 'No answer.'
  const said = `You typed ${quoted(typed)}.`
  switch (result) {
    case 'typo':
      return `${said} Spelling forgiven.`
    case 'accepted':
      return `${said} Close, the host accepted it.`
    case 'close':
      return `${said} Close, not counted.`
    default:
      return said
  }
}

/** Whether a typed part counted. */
export const partCounts = (result: PartResult) => result === 'exact' || result === 'typo' || result === 'accepted'

/** The sub line of a revealed event: "You had photo F.", the guard, or no answer. Null when it was right. */
export function eventLine(result: EventResult, mine: number | null): string | null {
  if (result === 'right') return null
  if (result === 'none' || mine === null) return 'No answer.'
  if (result === 'doubled') return `You had photo ${letterOf(mine)} on two songs, so it counts on neither.`
  return `You had photo ${letterOf(mine)}.`
}

/** "18 of 22 got it." */
export const gotItLine = (count: number, of: number) => `${count} of ${of} got it.`

/**
 * "Song 2 is next. You have photo F, “Sevn feries” and “coldwave”." (as typed;
 * a missing part says so), as its lead and what the guest has, which the
 * phone sets in bold. `have` is null with no answer at all.
 */
export function nextLine(n: number, mine: Picks | null): { lead: string; have: string | null } {
  const i = n - 1
  const photo = mine?.event[i] ?? null
  const title = mine?.title[i] ?? null
  const singer = mine?.singer[i] ?? null
  const lead = `Song ${n} is next.`
  if (photo === null && title === null && singer === null) return { lead, have: null }
  const parts = [photo === null ? 'no photo' : `photo ${letterOf(photo)}`, title === null ? 'no title' : quoted(title), singer === null ? 'no singer' : quoted(singer)]
  return { lead, have: `${parts[0]}, ${parts[1]} and ${parts[2]}` }
}

/** "3 Lydspor points so far, 6th." split as the figure and the words; the place only once scored. */
export function soFarWords(points: number, place: string | null): string {
  const word = points === 1 ? 'Lydspor point' : 'Lydspor points'
  return place ? `${word} so far, ${place}.` : `${word} so far.`
}
