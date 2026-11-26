// Participant fusion's steps in the host control room, as a pure function of
// what the host page holds (docs/engine-v2.md, 8.4; docs/identity.md, The host
// room): one gold step at a time, the steps that skip ahead in the menu beside
// it, and the line under them. HostView draws them; host.test.ts pins them.
import type { PlayerId } from '../core/Game'
import type { FusionState } from './logic'
import {
  countsLine,
  isLegacyState,
  pictureKey,
  plural,
  REVEAL_HOLD_MS,
  revealedCount,
  strapWords,
  type FusionHostAction,
  type FusionPhase,
  type FusionPublicPicture,
  type FusionPublicState,
} from './shapes'

/** Which icon a step wears; the view maps it to Phosphor's. */
export type StepIcon = 'wall' | 'ask' | 'reveal' | 'crown'

/** What a step asks before it goes. */
export type HostConfirm = { title: string; description: string; cancel: string; action: string }

export type HostStep = {
  label: string
  icon: StepIcon
  action: FusionHostAction
  /** Prompts to close first, so the step sees their final locks (Reveal now). */
  close?: string[]
  /** Asks first: crowning while pictures are still unasked. */
  confirm?: HostConfirm
}

export type HostSteps = {
  /** The one gold step, or null when there is none. */
  main: HostStep | null
  /** The steps that skip ahead, in the menu beside the gold one. */
  extra: HostStep[]
  /** The line under the steps: what happens next, and by when. */
  line: string | null
  /** The crown's confirmation while unasked pictures remain, else null. */
  confirm: HostConfirm | null
}

const NONE: HostSteps = { main: null, extra: [], line: null, confirm: null }

/** The phase as a word on a chip. */
export const PHASE_CHIP: Record<FusionPhase, string> = {
  lobby: 'Ready',
  wall: 'The wall',
  asking: 'Guessing',
  reveal: 'Revealed',
  done: 'Over',
}

/** The title line beside the chip: "12 pictures", "4 of 12 revealed", "Picture 5 of 12: #5". */
export function headline(pub: FusionPublicState): string {
  const total = pub.pictures.length
  switch (pub.phase) {
    case 'lobby':
      return plural(total, 'picture')
    case 'wall':
      return revealedCount(pub) > 0 ? strapWords(pub) : plural(total, 'picture')
    case 'asking':
    case 'reveal': {
      const label = pub.pictures.find((p) => p.n === pub.current?.n)?.label ?? ''
      return `${strapWords(pub)}: ${label}`
    }
    case 'done':
      return 'Participant fusion is over'
  }
}

/** Pictures that haven't been asked: not revealed, and not the one being asked now. */
export function unasked(pub: FusionPublicState): FusionPublicPicture[] {
  return pub.pictures.filter((p) => p.revealed === null && !(pub.phase === 'asking' && pub.current?.n === p.n))
}

/** The lowest unasked picture whose two people are set: the next one to ask. */
export function nextToAsk(pub: FusionPublicState, state: Pick<FusionState, 'key'> | null): FusionPublicPicture | null {
  return unasked(pub).find((p) => state?.key?.[p.n] !== undefined) ?? null
}

/** Whether a picture can be asked from this phase: lobby, wall or reveal. */
export const canAsk = (phase: FusionPhase) => phase === 'lobby' || phase === 'wall' || phase === 'reveal'

/** Everyone in the party may lock in on the picture being asked, the two in it too. */
export function mayVote(players: readonly { id: PlayerId }[]): number {
  return players.length
}

/** The crown's confirmation, when it leaves `left` pictures unasked. */
export function crownConfirm(left: number): HostConfirm {
  return {
    title: 'Crown the face detective now?',
    description:
      left === 1
        ? "1 picture hasn't been asked. It stays secret, and nobody scores on it."
        : `${left} pictures haven't been asked. They stay secret, and nobody scores on them.`,
    cancel: 'Keep going',
    action: 'Crown now',
  }
}

/** Seconds until `at`, rounded up. */
const secondsTo = (at: number, now: number) => Math.ceil((at - now) / 1000)

/**
 * The host's steps for where the round is. `now` is the database clock, for
 * the lines that count down. A round of the background version has none: the
 * host room says to End and restart it.
 */
export function hostSteps(
  pub: FusionPublicState,
  state: FusionState | null,
  tallies: Readonly<Record<string, number>>,
  players: readonly { id: PlayerId }[],
  now: number,
): HostSteps {
  if (state && isLegacyState(state)) return NONE
  const left = unasked(pub).length
  const confirm = left > 0 && pub.phase !== 'asking' && pub.phase !== 'done' ? crownConfirm(left) : null
  const next = nextToAsk(pub, state)
  const ask = (prefix: string): HostStep | null =>
    next ? { label: `${prefix}${next.label}`, icon: 'ask', action: { type: 'ask', n: next.n } } : null
  const crown = (label: string): HostStep => ({
    label: confirm ? `${label}…` : label,
    icon: 'crown',
    action: { type: 'finish' },
    ...(confirm ? { confirm } : {}),
  })

  switch (pub.phase) {
    case 'lobby': {
      const main = ask('Ask ')
      const wall: HostStep = { label: 'Show the wall first', icon: 'wall', action: { type: 'wall', from: 'lobby' } }
      return {
        main,
        extra: [wall],
        line: main
          ? 'Ask when the room is looking at the TV: it picks the picture with a little suspense, then the guessing starts.'
          : "No picture has its two people yet. Type them with Show who, then ask.",
        confirm,
      }
    }
    case 'wall': {
      const main = ask('Ask ')
      if (main) {
        return {
          main,
          extra: [crown('Crown the face detective now')],
          line: 'Ask the next picture when the room is ready, or ask any picture below.',
          confirm,
        }
      }
      return {
        main: crown('Crown the face detective'),
        extra: [],
        line:
          left > 0
            ? `${left === 1 ? "1 picture doesn't" : `${left} pictures don't`} have their two people set. Set them with Show who to ask them, or crown the face detective.`
            : 'That was the last picture. Crown the face detective.',
        confirm,
      }
    }
    case 'asking': {
      const current = pub.current!
      const key = current.key || pictureKey(current.n)
      const locked = tallies[key] ?? 0
      const voters = mayVote(players)
      return {
        main: { label: 'Reveal now', icon: 'reveal', action: { type: 'reveal', n: current.n }, close: [key] },
        extra: [],
        line:
          now < current.startsAt
            ? 'The TV is picking the picture. The guessing starts in a moment.'
            : now >= current.endsAt
              ? "Time's up. Tap Reveal now if the reveal doesn't come."
              : voters > 0 && locked >= voters
                ? 'Everyone has locked in. Reveal now.'
                : `${locked} of ${voters} have locked in. It reveals by itself when time's up.`,
        confirm: null,
      }
    }
    case 'reveal': {
      const current = pub.current!
      const reveal = pub.pictures.find((p) => p.n === current.n)?.revealed
      const skip = ask('Skip the wall: ask ') ?? crown('Skip the wall: crown the face detective')
      const wallIn = current.revealedAt !== null ? secondsTo(current.revealedAt + REVEAL_HOLD_MS, now) : 0
      const counts = reveal ? `${countsLine(reveal)} ` : ''
      return {
        main: { label: 'Back to the wall', icon: 'wall', action: { type: 'wall', from: 'reveal', n: current.n } },
        extra: [skip],
        line: `${counts}${wallIn > 0 ? `The wall follows by itself in ${wallIn} s.` : 'The wall is coming up.'}`,
        confirm,
      }
    }
    case 'done':
      return NONE
  }
}
