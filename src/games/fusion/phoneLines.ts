// Participant fusion's words on a guest's phone (spec 6.3; docs/identity.md,
// Participant fusion on a phone), phase by phase and case by case, as pure
// functions: the screens only lay them out, and phoneLines.test.ts reads them.
// No exclamation marks, no dashes, and only times the database holds.
import { ordinal } from '@/components/phone/text'
import type { LockState } from '@/games/fusion/lock'
import {
  countHits,
  listNames,
  plural,
  pointsFor,
  scoringLine,
  type FusionPlayerView,
  type FusionPublicPicture,
  type FusionPublicState,
  type FusionRules,
} from '@/games/fusion/shapes'

/** A screen's words: its head (the phone's heading size), a line under it, and the reading text. */
export type Words = { head: string; line: string | null; body?: string | null }

/** The lobby: the round has started, and the TV opens it. */
export function lobbyWords(onStage: boolean, rules: FusionRules): Words {
  return {
    head: 'Two guests, one face.',
    line: onStage ? 'Watch the TV.' : 'It starts on the TV soon.',
    body: `The pictures come up on the TV one at a time. For each one, pick the two names in it here and lock in. ${scoringLine(rules)}`,
  }
}

/** A picture asked, while the TV shows which one it is: the picker comes once it is in. */
export function waitWords(onStage: boolean): Words {
  return {
    head: onStage ? 'Look at the TV.' : 'The next picture is coming.',
    line: 'The next picture is on its way. Then pick the two in it.',
  }
}

/** The wall, between pictures: what comes next. */
export function wallWords(revealed: number, total: number, onStage: boolean): Words {
  if (total > 0 && revealed >= total) return { head: 'That was the last picture.', line: 'The face detective is crowned soon.' }
  return {
    head: revealed === 0 ? 'The guessing starts soon.' : 'The next picture is coming up.',
    line: onStage ? 'Watch the TV.' : null,
  }
}

/** One piece of a line; `leader` marks the rank that is first, which the screen sets in gold. */
export type Part = { text: string; leader?: boolean }

/**
 * Where you stand in the round: "You have 3 points, 4th of the face
 * detectives so far.", the rank gold only at 1st, and named for the round so
 * it isn't read as the night's place on the card below; "No points yet." once
 * a picture is revealed; nothing before (a late joiner's null view reads as no
 * points).
 */
export function placeParts(view: FusionPlayerView | null, anyRevealed: boolean): Part[] | null {
  const points = view?.points ?? 0
  if (points <= 0) return anyRevealed ? [{ text: 'No points yet.' }] : null
  if (!view?.rank) return [{ text: `You have ${plural(points, 'point')}.` }]
  return [{ text: `You have ${plural(points, 'point')}, ` }, { text: ordinal(view.rank), leader: view.rank === 1 }, { text: ' of the face detectives so far.' }]
}

/** How a revealed picture went for this guest. */
export type Outcome = 'both' | 'one' | 'none' | 'noGuess'

/**
 * A revealed picture's outcome for this guest, whether they are in it or not:
 * from their view's hits (the logic's count), or, without them (a view not
 * caught up, a late joiner), from their own lock against the two names.
 */
export function outcomeFor(
  picture: Pick<FusionPublicPicture, 'n'> & { revealed: { names: readonly [string, string] } | null },
  me: string,
  view: FusionPlayerView | null,
  mine: readonly string[] | null,
): Outcome {
  const names = picture.revealed?.names
  const hits = view?.hits[picture.n] ?? (mine && names ? countHits(mine, names, me) : undefined)
  if (hits === undefined) return 'noGuess'
  return hits >= 2 ? 'both' : hits === 1 ? 'one' : 'none'
}

const HEADS: Record<Outcome, string> = {
  both: 'You got both.',
  one: 'You got one of the two.',
  none: 'Not this time.',
  noGuess: 'No guess this time.',
}

/** The reveal's head on this phone. */
export const outcomeHead = (outcome: Outcome) => HEADS[outcome]

/** How many of the two an outcome got. */
const hitsOf = (outcome: Outcome) => (outcome === 'both' ? 2 : outcome === 'one' ? 1 : 0)

/** The points an outcome gave, by the round's rules. */
export const outcomePoints = (outcome: Outcome, rules: Pick<FusionRules, 'perPerson' | 'bothBonus'>) =>
  outcome === 'noGuess' ? 0 : pointsFor(hitsOf(outcome), rules)

/** The outcome in one line, with the points when it scored: "You got both (+3).", "Not this time." */
export function outcomeLine(outcome: Outcome, points: number): string {
  const head = HEADS[outcome].replace(/\.$/, '')
  return points > 0 ? `${head} (+${points}).` : `${head}.`
}

/** "Mads and Ida", "Mads and one more": the picks so far. */
const picked = (names: readonly string[]) => (names.length >= 2 ? `${names[0]} and ${names[1]}` : `${names[0]} and one more`)

/**
 * The status line while a guest picks: how picking works, the picks so far,
 * the lock on its way, or why the database refused it (with "Try again." when
 * another lock can work). Everyone picks the same way, the two in the
 * picture too: their own name is never offered.
 */
export function pickLine(names: readonly string[], lock: LockState): string {
  if (lock.kind === 'refused') return lock.message
  if (lock.kind === 'sending' || lock.kind === 'locked') return `Locking in ${picked(names)}…`
  if (names.length === 0) return 'Pick two names, then lock in. Only your first lock counts.'
  if (names.length === 1) return `${picked(names)}.`
  return `${picked(names)}. Lock in when you're sure.`
}

/** The lock bar's names beside the two slots. */
export const barNames = (names: readonly string[]) => (names.length === 0 ? 'Pick two' : picked(names))

/** Locked in: the two, and where the answer comes. */
export function lockedWords(names: readonly string[], onStage: boolean): Words {
  return {
    head: `Locked in: ${picked(names)}.`,
    line: onStage ? 'The answer comes up on the TV.' : 'The answer comes up soon.',
  }
}

/**
 * The countdown ran out before this guest locked in; `refusal`, the
 * database's words when it was a lock that came too late.
 */
export function timeUpWords(refusal: string | null = null): Words {
  return { head: "Time's up.", line: refusal ? `${refusal} No guess from you this time.` : 'No guess from you this time.' }
}

/** What a guest's phone shows while a picture is asked. */
export type AskingCase = 'locked' | 'timeUp' | 'picking'

/**
 * Which of the asking screens this phone shows: a lock in (or on its way)
 * shows as locked; time's up without one; else the picker. A late joiner (no
 * view yet) picks like anyone.
 */
export function askingCase({ lockedIn, sending, over }: { lockedIn: boolean; sending: boolean; over: boolean }): AskingCase {
  if (lockedIn) return 'locked'
  if (sending) return 'picking'
  return over ? 'timeUp' : 'picking'
}

/** The round ended while live, before the result card takes over. */
export const doneWords = (title: string): Words => ({ head: `${title} is over.`, line: null })

/**
 * The row of fusion's section on the phone home while another game holds the
 * main card. `asking` says where this guest is with the picture being asked.
 */
export function cardLine(
  pub: FusionPublicState | null,
  view: FusionPlayerView | null,
  asking: AskingCase | null,
  reveal: { names: readonly string[]; outcome: Outcome; points: number } | null,
): string {
  if (!pub) return 'Getting the pictures ready…'
  const total = pub.pictures.length
  const revealed = pub.pictures.filter((p) => p.revealed !== null).length
  const points = plural(view?.points ?? 0, 'point')
  const label = pub.pictures.find((p) => p.n === pub.current?.n)?.label ?? 'The picture'
  switch (pub.phase) {
    case 'lobby':
      return 'Starts on the TV soon'
    case 'wall':
      return revealed === 0 ? `${plural(total, 'picture')}. The guessing starts soon.` : `${revealed} of ${total} revealed. You have ${points}.`
    case 'asking':
      if (asking === 'locked') return `Locked in on ${label}`
      if (asking === 'timeUp') return `Time's up on ${label}`
      return `Guess ${label} now`
    case 'reveal':
      if (!reveal) return `${label} is revealed`
      return `${label} was ${listNames(reveal.names)}. ${outcomeLine(reveal.outcome, reveal.points)}`
    case 'done':
      return `Over. You have ${points}.`
  }
}

/** The result card's words once the round is over (spec 6.3, ResultView). */
export type ResultWords =
  | { kind: 'won'; head: string; line: string; tie: string | null }
  | { kind: 'other'; head: string; scored: string; detail: string }
  | { kind: 'nobody'; head: string; scored: string | null }

/**
 * "You have the sharpest eye.", or who did and how you did: points, how
 * often both people were right, and your place among the face detectives.
 */
export function resultWords({
  title,
  winners,
  meWon,
  points,
  both,
  revealed,
  total,
  rank,
}: {
  title: string
  /** The winners' names, this phone's guest left out. */
  winners: readonly string[]
  meWon: boolean
  points: number
  /** Revealed pictures this guest got both people of. */
  both: number
  revealed: number
  total: number
  rank: number | null
}): ResultWords {
  const pictures = revealed === total ? plural(total, 'picture') : `the ${revealed} revealed`
  if (meWon) {
    const right = both > 0 ? `, both people right on ${plural(both, 'picture')}` : ''
    return {
      kind: 'won',
      head: winners.length > 0 ? 'You share the sharpest eye.' : 'You have the sharpest eye.',
      line: `${plural(points, 'point')}${right}. ${winners.length > 0 ? "You're a face detective." : "You're the face detective."}`,
      tie: winners.length > 0 ? `A tie with ${listNames(winners)}.` : null,
    }
  }
  const scored = points > 0 ? `You scored ${plural(points, 'point')}` : 'No points for you this time'
  if (winners.length === 0) return { kind: 'nobody', head: `${title} is over. Nobody scored this time.`, scored: null }
  const place = rank ? ` You're ${ordinal(rank)} of the face detectives.` : ''
  return {
    kind: 'other',
    head: `${listNames(winners)} had the sharpest ${winners.length > 1 ? 'eyes' : 'eye'}`,
    scored,
    detail: revealed > 0 ? `Both people right on ${both} of ${pictures}.${place}` : 'No pictures were revealed.',
  }
}

/** A name on a picker tile up to this many characters a line keeps 15 px; a longer one steps to 13 px. */
export const TILE_NAME_CHARS = 8

/**
 * A guest's name on a picker tile, whole where it can be: it breaks after a
 * hyphen or at a space onto a second line (Marie- over Louise, as the token's
 * slate does), and a line over 8 characters steps down to 13 px, so
 * Christoffer fits a 76 px tile on a 360 px phone. Only a longer line than
 * that ends in an ellipsis.
 */
export function tileNameLines(name: string): string[] {
  const trimmed = name.trim().replace(/\s+/g, ' ')
  // The first break: after a hyphen (it stays on the first line) or at a space.
  const hyphen = trimmed.search(/[-\u2010]./)
  const space = trimmed.indexOf(' ')
  const breaks = [hyphen > 0 ? hyphen + 1 : -1, space].filter((at) => at > 0)
  if (breaks.length === 0) return [trimmed]
  const at = Math.min(...breaks)
  return [trimmed.slice(0, at).trim(), trimmed.slice(at).trim()]
}
