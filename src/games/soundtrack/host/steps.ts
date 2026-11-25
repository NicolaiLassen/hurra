// The host's steps through Lydspor (spec section 10): the one gold step for
// where the game is, the extra time beside the last call, and the steps that
// skip ahead, which go in the menu behind a confirmation (docs/identity.md,
// The host room). Pure, so the tests pin every phase. Every action names the
// step it was made for, so a double tap or a race with the timer is a skip.
import { MAX_MORE, MORE_MS, playedKeys } from '../logic'
import type { SoundtrackHostAction, SoundtrackPhase } from '../types'

/** Where the game stands, from the public state, the state and the settings. */
export type Where = {
  phase: SoundtrackPhase
  /** Songs played so far. */
  played: number
  /** Songs in the settings. */
  total: number
  revealed: number
  /** Show the top 5 after every this many reveals; 0 never. */
  standingsEvery: number
  lastCallSeconds: number
  /** Last call extensions so far. */
  extended: number
  /** The timer has closed the prompts and the lock follows. */
  closing: boolean
}

export type StepIcon = 'play' | 'lastCall' | 'more' | 'lock' | 'reveal' | 'top' | 'crown'

export type Step = {
  /** Unique per step, so a pending button knows itself. */
  id: string
  label: string
  icon: StepIcon
  action: SoundtrackHostAction
  /** Prompts to close first, so the action reads their final answers. */
  close?: string[]
  /** Asked before a step that skips ahead or can't be taken back. */
  confirm?: { title: string; description: string; label: string }
}

/**
 * The top 5 is due after this reveal: the settings' every n reveals, as the
 * bot counts them, and always after the last song played, so the final top 5
 * and the photos that had no song reach the TV however many songs ran.
 */
export const topDue = (where: Pick<Where, 'phase' | 'revealed' | 'played' | 'standingsEvery'>) =>
  where.phase === 'reveal' &&
  where.standingsEvery > 0 &&
  where.revealed > 0 &&
  (where.revealed % where.standingsEvery === 0 || where.revealed === where.played)

/** "Song 7 won't play", "Songs 7 and 8 won't play", "Songs 6 to 8 won't play". */
export function songsLeft(from: number, to: number, verb: string): string {
  if (from === to) return `Song ${from} ${verb}`
  return `Songs ${from} ${to === from + 1 ? 'and' : 'to'} ${to} ${verb.replace(/^isn't\b/, "aren't").replace(/^doesn't\b/, "don't")}`
}

const play = (index: number): Step => ({
  id: `play:${index}`,
  label: `Play song ${index + 1}`,
  icon: 'play',
  action: { type: 'play', index },
})

const reveal = (index: number): Step => ({
  id: `reveal:${index}`,
  label: `Reveal song ${index + 1}`,
  icon: 'reveal',
  action: { type: 'reveal', index },
})

const top = (after: number, label = 'Show the top 5'): Step => ({
  id: `standings:${after}`,
  label,
  icon: 'top',
  action: { type: 'standings', after },
})

const crown = (label = 'Crown Lydspor'): Step => ({ id: 'crown', label, icon: 'crown', action: { type: 'crown' } })

/** The one gold step, or null while nothing is the host's to do (the last call runs, or it is over). */
export function nextStep(where: Where): Step | null {
  const { phase, played, total, revealed } = where
  switch (phase) {
    case 'lobby':
      return total > 0 ? play(0) : null
    case 'playing':
      if (played < total) return play(played)
      return { id: `lastCall:${played}`, label: 'Last call', icon: 'lastCall', action: { type: 'lastCall', after: played } }
    case 'lastCall':
      return null
    case 'locked':
      return played > 0 ? reveal(0) : crown()
    case 'reveal':
      if (topDue(where)) return top(revealed)
      return revealed < played ? reveal(revealed) : crown()
    case 'standings':
      return revealed < played ? reveal(revealed) : crown()
    case 'done':
      return null
  }
}

/** More time beside the last call's countdown: +30 s, twice, until the timer closes the answers. */
export function moreTime(where: Where): (Step & { left: number }) | null {
  if (where.phase !== 'lastCall' || where.closing || where.extended >= MAX_MORE) return null
  const n = where.extended + 1
  return {
    id: `more:${n}`,
    label: `More time (+${MORE_MS / 1000} s)`,
    icon: 'more',
    action: { type: 'more', n },
    left: MAX_MORE - where.extended,
  }
}

/** The steps in the menu beside the gold one: each skips ahead, so the ones that can't be undone ask first. */
export function menuSteps(where: Where): Step[] {
  const { phase, played, total, revealed } = where
  const steps: Step[] = []
  const lockNow: Step = {
    id: 'lock',
    label: 'Lock now…',
    icon: 'lock',
    action: { type: 'lock' },
    close: playedKeys(played),
    confirm: {
      title: 'Lock the answers now?',
      description:
        phase === 'lastCall'
          ? 'The last call ends now. Nobody can change an answer after this, and you reveal the songs one by one.'
          : 'There is no last call: nobody can change an answer after this, and you reveal the songs one by one.',
      label: 'Lock now',
    },
  }
  if (phase === 'playing' && played > 0) {
    if (played < total) {
      steps.push({
        id: `lastCall:${played}`,
        label: 'Last call now…',
        icon: 'lastCall',
        action: { type: 'lastCall', after: played },
        confirm: {
          title: `Lock after song ${played}?`,
          description: `${songsLeft(played + 1, total, "won't play")}. The answers lock ${where.lastCallSeconds} s after you tap.`,
          label: 'Last call',
        },
      })
    }
    steps.push(lockNow)
  }
  // Also while the timer is closing the answers: the way on by hand if its sync doesn't get through.
  if (phase === 'lastCall') steps.push(lockNow)
  if (phase === 'reveal') {
    if (topDue(where)) {
      steps.push(revealed < played ? { ...reveal(revealed), label: `Skip the top 5: reveal song ${revealed + 1}` } : crown('Skip the top 5: crown Lydspor'))
    } else if (revealed < played) {
      steps.push(top(revealed, 'Show the top 5 now'))
    }
  }
  if ((phase === 'locked' || phase === 'reveal' || phase === 'standings') && revealed < played) {
    steps.push({
      ...crown('Crown Lydspor now…'),
      confirm: {
        title: 'Crown Lydspor now?',
        description:
          revealed === 0
            ? 'No song is revealed yet, so nobody scores and nobody wins.'
            : `${songsLeft(revealed + 1, played, "isn't revealed yet")}. ${played - revealed === 1 ? 'It stays' : 'They stay'} secret, and only the revealed songs count.`,
        label: 'Crown Lydspor',
      },
    })
  }
  return steps
}
