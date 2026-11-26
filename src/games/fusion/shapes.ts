// What every Participant fusion screen and the logic share (docs/engine-v2.md,
// 8.4): the public state, the player view, the host actions, the constants,
// and the readers every screen reads saved JSON through.
//
// Bundled into the Netlify function with logic.ts: relative imports only, no
// React, no browser globals.
import type { PlayerId, PromptSpec } from '../core/Game'

export type FusionPhase = 'lobby' | 'showing' | 'wall' | 'asking' | 'reveal' | 'done'

/** How the round is timed and scored, from the settings it started with. */
export type FusionRules = {
  /** Seconds to guess each picture: its countdown. */
  seconds: number
  /** Seconds each picture shows in the showing. */
  showSeconds: number
  /** Points for each of a picture's two people a guest got right. */
  perPerson: number
  /** Extra points for getting both. */
  bothBonus: number
}

/** A revealed picture: who is in it and how the room did. */
export type FusionReveal = {
  people: [PlayerId, PlayerId]
  /** Their names when it was revealed, for anyone who has left since. */
  names: [string, string]
  /** Of the voters (guests who locked in and aren't in it): how many got both, one, none. */
  both: number
  one: number
  none: number
  voters: number
  /**
   * The two people's own photos, in the order of `people`: a game-media path
   * (the full image; its thumbnail sits beside it), or null where the host
   * added none. Secret like the key: here only once the picture is revealed.
   */
  originals: [string | null, string | null]
  /** Its place in the guessing: 1 for the first picture asked. */
  step: number
  /** When it was revealed (database clock); null in a save from the background version. */
  at: number | null
}

export type FusionPublicPicture = {
  /** 1 to 40: its place in the settings. */
  n: number
  /** Its prompt key, 'p' + n: what phones answer while it is asked. */
  key: string
  /** What the print says: "#3" unless the host named it. */
  label: string
  /** A game-media path (the full image; its thumbnail sits beside it), or null: screens show the label instead. */
  image: string | null
  /** Set once it is revealed, never before. */
  revealed: FusionReveal | null
}

/** The picture being guessed (asking) or just revealed (reveal). */
export type FusionCurrent = {
  n: number
  /** Its place in the guessing, this one included: "Picture 4 of 12". */
  step: number
  /** Its prompt key. */
  key: string
  /** When it was asked, and when its countdown ends (database clock). Locks are taken until endsAt + GRACE_MS. */
  openedAt: number
  endsAt: number
  /** Set in the reveal phase; null while it is asked. */
  revealedAt: number | null
}

/** A face detective in the top 5: ties share a rank (1, 2, 2, 4). */
export type FusionTopRow = { playerId: PlayerId; points: number; rank: number }

/**
 * A guest on the host's guest list who hasn't joined: a picture may be of
 * them, so a guess may name them (docs/guest-list.md, 9.2). Their id and name
 * only, nothing else about them.
 */
export type FusionGuest = { id: PlayerId; name: string }

/** What everyone sees. Never who is in a picture before its reveal. */
export type FusionPublicState = {
  phase: FusionPhase
  /** Every picture, in the settings' order. */
  pictures: FusionPublicPicture[]
  rules: FusionRules
  /**
   * The showing while it runs: picture i (from 0) is on from
   * startedAt + i * rules.showSeconds * 1000, and the wall follows at endsAt.
   * Null in every other phase.
   */
  showing: { startedAt: number; endsAt: number } | null
  /** Set in asking and reveal; null in every other phase. */
  current: FusionCurrent | null
  /** The top 5 face detectives still in the party, most points first. */
  top: FusionTopRow[]
  /**
   * Everyone on the guest list who hasn't joined, in the order the host added
   * them: the phone's picker lists them after the guests here. Every one of
   * them, whether a picture is of them or not, so the list says nothing about
   * the key. Empty in saves from before the guest list.
   */
  expected: FusionGuest[]
}

/** What one guest sees. Their own lock comes from myAnswers. */
export type FusionPlayerView = {
  /** Their points in this round. */
  points: number
  /** Their place among the face detectives; null until they score. */
  rank: number | null
  /** For each revealed picture they locked in on and aren't in, by picture number: how many of its two they got (0 to 2). */
  hits: Record<string, number>
  /** They are in the picture being guessed or just revealed: they don't vote on it. */
  inPicture: boolean
}

/**
 * The host's steps. Each names the step the host page showed: a phase, or a
 * picture number. One whose step has passed returns the state unchanged, which
 * the engine answers as skipped, so a double tap or a race with a timer does
 * nothing. `reveal` is sent with close: [pictureKey(n)].
 */
export type FusionHostAction =
  | { type: 'show' }
  | { type: 'wall'; from: 'lobby' | 'showing' }
  | { type: 'wall'; from: 'reveal'; n: number }
  | { type: 'ask'; n: number }
  | { type: 'reveal'; n: number }
  | { type: 'setKey'; n: number; people: [PlayerId, PlayerId] }
  | { type: 'finish' }

export const PHASES: readonly FusionPhase[] = ['lobby', 'showing', 'wall', 'asking', 'reveal', 'done']

export const MAX_PICTURES = 40
export const MAX_LABEL_LENGTH = 20
export const MAX_POINTS = 10
export const DEFAULT_SECONDS = 30
export const MIN_SECONDS = 10
export const MAX_SECONDS = 90
export const DEFAULT_SHOW_SECONDS = 6
export const MIN_SHOW_SECONDS = 3
export const MAX_SHOW_SECONDS = 20
/** Locks are taken this long past the countdown, for taps still on their way. */
export const GRACE_MS = 1000
/** The timer reveals this long after the deadline, so game_load has closed the prompt (the quiz's reason). */
export const WAKE_MARGIN_MS = 250
/** A reveal holds the TV this long before the wall comes back by itself. */
export const REVEAL_HOLD_MS = 10_000
/** How many face detectives the public state ranks. */
export const TOP_SIZE = 5

/** The prompt phones answer for picture n. */
export const pictureKey = (n: number) => `p${n}`
/** The label a picture gets when the settings leave it blank. */
export const defaultLabel = (n: number) => `#${n}`

/**
 * Each picture's guess: two other guests, and the first lock counts. Anyone on
 * the guest list, so a guess can name a guest who never came (only guests here
 * answer). Public: never anything about the answer.
 */
export const VOTE_SPEC: PromptSpec = { kind: 'choice', options: 'guests', min: 2, max: 2, exclude_self: true, final: true }

/** What the host hears for a round started with the background version. */
export const LEGACY_MESSAGE = 'This round started before the update. End it, then restart it.'

// Readers ----------------------------------------------------------------------
// Saved JSON is read through these, never cast: a save from the background
// version, or a fixture with parts left out, still gives every screen the full
// shape (docs/engine-v2.md, 8.4, Old saves).

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value)
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isWhole = (value: unknown, min: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min
const count = (value: unknown) => (isFiniteNumber(value) && value >= 0 ? value : 0)
const isPair = (value: unknown): value is [string, string] =>
  Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === 'string')

/** The public state in its full shape, or null when there is none yet (a pending game). */
export function readPublic(raw: unknown): FusionPublicState | null {
  if (!isObject(raw) || !Array.isArray(raw.pictures)) return null

  const pictures: FusionPublicPicture[] = raw.pictures.map((item, i) => {
    const p = isObject(item) ? item : {}
    const n = isWhole(p.n, 1) ? p.n : i + 1
    return {
      n,
      key: typeof p.key === 'string' ? p.key : pictureKey(n),
      label: typeof p.label === 'string' ? p.label : defaultLabel(n),
      image: typeof p.image === 'string' && p.image !== '' ? p.image : null,
      revealed: readReveal(p.revealed),
    }
  })

  // Revealed pictures without a step (the background version's) get one in reveal order.
  const known = pictures.map((p) => p.revealed?.step ?? 0)
  let next = Math.max(0, ...known) + 1
  const unstepped = pictures
    .filter((p) => p.revealed !== null && p.revealed.step === 0)
    .sort((a, b) => order(a.revealed!.at) - order(b.revealed!.at) || a.n - b.n)
  for (const picture of unstepped) picture.revealed!.step = next++

  const rules = readRules(raw.rules, raw.scoring)
  let phase: FusionPhase = PHASES.includes(raw.phase as FusionPhase) ? (raw.phase as FusionPhase) : 'lobby'

  let showing: FusionPublicState['showing'] = null
  if (phase === 'showing') {
    const s = isObject(raw.showing) ? raw.showing : {}
    if (isFiniteNumber(s.startedAt) && isFiniteNumber(s.endsAt)) showing = { startedAt: s.startedAt, endsAt: s.endsAt }
    else phase = 'wall'
  }

  let current: FusionCurrent | null = null
  if (phase === 'asking' || phase === 'reveal') {
    current = readCurrent(raw.current, pictures, phase)
    if (!current) phase = 'wall'
  }

  return { phase, pictures, rules, showing, current, top: readTop(raw.top), expected: readGuests(raw.expected) }
}

/** The expected guests a save carries: well formed ones, each id once. */
function readGuests(raw: unknown): FusionGuest[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const guests: FusionGuest[] = []
  for (const item of raw) {
    if (!isObject(item) || typeof item.id !== 'string' || item.id === '' || typeof item.name !== 'string' || seen.has(item.id)) continue
    seen.add(item.id)
    guests.push({ id: item.id, name: item.name })
  }
  return guests
}

/** Null-at-times last when ordering by time. */
const order = (at: number | null) => (at === null ? Number.MAX_SAFE_INTEGER : at)

function readReveal(raw: unknown): FusionReveal | null {
  if (!isObject(raw) || !isPair(raw.people)) return null
  return {
    people: [raw.people[0], raw.people[1]],
    names: isPair(raw.names) ? [raw.names[0], raw.names[1]] : ['A guest', 'A guest'],
    both: count(raw.both),
    one: count(raw.one),
    none: count(raw.none),
    voters: count(raw.voters),
    originals: readOriginals(raw.originals),
    // 0 until readPublic fills it in.
    step: isWhole(raw.step, 1) ? raw.step : 0,
    at: isFiniteNumber(raw.at) ? raw.at : null,
  }
}

/** Two game-media paths or nulls, whatever was saved: [null, null] for none (every save before originals existed). */
export function readOriginals(raw: unknown): [string | null, string | null] {
  const path = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
  return Array.isArray(raw) ? [path(raw[0]), path(raw[1])] : [null, null]
}

function readRules(raw: unknown, scoring: unknown): FusionRules {
  const r = isObject(raw) ? raw : isObject(scoring) ? scoring : {}
  return {
    seconds: isFiniteNumber(r.seconds) ? r.seconds : DEFAULT_SECONDS,
    showSeconds: isFiniteNumber(r.showSeconds) ? r.showSeconds : DEFAULT_SHOW_SECONDS,
    perPerson: isFiniteNumber(r.perPerson) ? r.perPerson : 1,
    bothBonus: isFiniteNumber(r.bothBonus) ? r.bothBonus : 0,
  }
}

function readCurrent(raw: unknown, pictures: readonly FusionPublicPicture[], phase: 'asking' | 'reveal'): FusionCurrent | null {
  if (!isObject(raw) || !isFiniteNumber(raw.openedAt) || !isFiniteNumber(raw.endsAt)) return null
  const picture = pictures.find((p) => p.n === raw.n)
  if (!picture) return null
  const revealed = pictures.filter((p) => p.revealed !== null).length
  const fallbackStep = phase === 'reveal' ? (picture.revealed?.step ?? revealed) : revealed + 1
  return {
    n: picture.n,
    step: isWhole(raw.step, 1) ? raw.step : Math.max(1, fallbackStep),
    key: typeof raw.key === 'string' ? raw.key : picture.key,
    openedAt: raw.openedAt,
    endsAt: raw.endsAt,
    revealedAt: isFiniteNumber(raw.revealedAt) ? raw.revealedAt : null,
  }
}

function readTop(raw: unknown): FusionTopRow[] {
  if (!Array.isArray(raw)) return []
  const rows = raw.filter(
    (row): row is Json & { playerId: string; points: number } =>
      isObject(row) && typeof row.playerId === 'string' && isFiniteNumber(row.points),
  )
  return rows.map((row) => ({
    playerId: row.playerId,
    points: row.points,
    // The background version saved no ranks: competition ranks by points.
    rank: isWhole(row.rank, 1) ? row.rank : 1 + rows.filter((other) => other.points > row.points).length,
  }))
}

/** A player's view in its full shape, or null when they have none (joined since the last save). */
export function readView(raw: unknown): FusionPlayerView | null {
  if (!isObject(raw)) return null
  const hits: Record<string, number> = {}
  if (isObject(raw.hits)) {
    for (const [n, value] of Object.entries(raw.hits)) if (value === 0 || value === 1 || value === 2) hits[n] = value
  }
  return {
    points: isFiniteNumber(raw.points) ? raw.points : 0,
    rank: isWhole(raw.rank, 1) ? raw.rank : null,
    hits,
    inPicture: raw.inPicture === true,
  }
}

/** A saved full state from the background version ('voting' or 'locked'). */
export function isLegacyState(state: unknown): boolean {
  return isObject(state) && (state.phase === 'voting' || state.phase === 'locked')
}

// Words and numbers --------------------------------------------------------------

/** The showing's picture on show at `now` (0-based, clamped to the last), or null outside the showing. */
export function showingIndex(pub: FusionPublicState, now: number): number | null {
  if (pub.phase !== 'showing' || !pub.showing) return null
  const each = Math.max(1, pub.rules.showSeconds * 1000)
  const index = Math.floor((now - pub.showing.startedAt) / each)
  return Math.min(Math.max(0, pub.pictures.length - 1), Math.max(0, index))
}

/** The strap's words (TV, and the phone's strap): see 6.1. Without `now`, the showing says its length. */
export function strapWords(pub: FusionPublicState | null, now?: number): string {
  if (!pub) return 'Getting ready'
  const total = pub.pictures.length
  switch (pub.phase) {
    case 'lobby':
      return `${plural(total, 'picture')}, starting soon`
    case 'showing': {
      const index = now === undefined ? null : showingIndex(pub, now)
      return index === null ? `Showing ${plural(total, 'picture')}` : `Showing ${index + 1} of ${total}`
    }
    case 'wall': {
      const revealed = revealedCount(pub)
      if (revealed > 0) return `${revealed} of ${total} revealed`
      return total === 1 ? '1 picture' : `All ${total} pictures`
    }
    case 'asking':
    case 'reveal':
      return `Picture ${pub.current?.step ?? revealedCount(pub) + 1} of ${total}`
    case 'done':
      return 'Final result'
  }
}

/** The points one picture gives a guest who got `hits` of its two. */
export function pointsFor(hits: number, rules: Pick<FusionRules, 'perPerson' | 'bothBonus'>): number {
  return hits * rules.perPerson + (hits >= 2 ? rules.bothBonus : 0)
}

/** "1 point for each right person, plus 1 for both." */
export function scoringLine(rules: FusionRules): string {
  const { perPerson, bothBonus } = rules
  if (perPerson > 0 && bothBonus > 0) return `${plural(perPerson, 'point')} for each right person, plus ${bothBonus} for both.`
  if (perPerson > 0) return `${plural(perPerson, 'point')} for each right person.`
  if (bothBonus > 0) return `${plural(bothBonus, 'point')} for getting both.`
  return 'No points this time, just the glory.'
}

/** "9 of 21 got both, 6 got one." and its variants. */
export function countsLine(reveal: FusionReveal): string {
  const { both, one, voters } = reveal
  if (voters === 0) return 'Nobody guessed this one.'
  if (both > 0) return one > 0 ? `${both} of ${voters} got both, ${one} got one.` : `${both} of ${voters} got both.`
  return one > 0 ? `Nobody got both. ${one} got one.` : 'Nobody got either of them.'
}

/**
 * The revealed picture the fewest voters saw through, when under half got
 * both (the recap's rule). Ties go to the one revealed first, as in the recap.
 */
export function bestDisguise(
  pictures: readonly FusionPublicPicture[],
): (FusionPublicPicture & { revealed: FusionReveal }) | null {
  let best: (FusionPublicPicture & { revealed: FusionReveal }) | null = null
  const revealed = pictures
    .filter((p): p is FusionPublicPicture & { revealed: FusionReveal } => p.revealed !== null && p.revealed.voters > 0)
    .sort((a, b) => a.revealed.step - b.revealed.step)
  for (const picture of revealed) {
    const share = picture.revealed.both / picture.revealed.voters
    if (!best || share < best.revealed.both / best.revealed.voters) best = picture
  }
  return best && best.revealed.both / best.revealed.voters < 0.5 ? best : null
}

/** The TV's lock-in total: max(locked, guests - 2, 0). Never the exact count of who may vote. */
export function lockedTotal(locked: number, guests: number): number {
  return Math.max(locked, guests - 2, 0)
}

/** How many pictures are revealed. */
export function revealedCount(pub: FusionPublicState): number {
  return pub.pictures.filter((p) => p.revealed !== null).length
}

/** "Ana", "Ana and Bo", "Ana, Bo and Cy", "Ana, Bo, Cy and 2 more". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
}

/** "1 point", "3 points". */
export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}
