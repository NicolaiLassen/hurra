// The rehearsal's Participant fusion player (docs/engine-v2.md, 3.6 and 8.4).
// Guests lock in on every picture asked, the two in it too, with two of the
// names the guess offers at a random moment inside its countdown; the scripted
// host runs the round like a person at the host page would. Relative imports only, no React, no
// browser globals, randomness only from sight.random: the rehearsal runs this
// under Node.
import type { BotMove, BotSight, GameBot, HostBotSight } from '../core/bot'
import { readState, type FusionConfig, type FusionState } from './logic'
import { nameKey } from '../core/names'
import { defaultLabel, GRACE_MS, isLegacyState, pictureKey, readPublic, REVEAL_HOLD_MS, WAKE_MARGIN_MS } from './shapes'

/** Pictures in a scripted round. */
export const BOT_PICTURES = 4
export const BOT_SECONDS = 10
/** How long the scripted host lets the wall show before it asks the next picture. */
const WALL_PAUSE_MS = 3000
/** If a timer hasn't moved the round on this long after it was due, the host taps the step by hand. */
const TIMER_PATIENCE_MS = 5000

export const bot: GameBot = {
  /**
   * 4 pictures whose people are pairs of the first 8 players (fewer players
   * repeat pairs), 10 s to guess. The settings name guests by name, but the
   * rehearsal knows only ids here: ids as settings saved before names held
   * them, which the start turns into the guests' names.
   */
  settings(playerIds) {
    const pool = playerIds.slice(0, 8)
    return {
      pictures: Array.from({ length: BOT_PICTURES }, (_, i) => {
        const a = pool[(2 * i) % Math.max(1, pool.length)]
        const b = pool[(2 * i + 1) % Math.max(1, pool.length)]
        return pool.length >= 2 && a !== b ? { label: defaultLabel(i + 1), people: [a, b] } : { label: defaultLabel(i + 1) }
      }),
      pointsPerPerson: 1,
      bonusForBoth: 1,
      seconds: BOT_SECONDS,
    }
  },

  /**
   * Locks in on the picture being asked, the two in it too, with 2 random
   * names the guess offers (never the bot's own), at a random moment inside
   * its countdown: after the TV's suspense, as a phone shows the picker then.
   */
  move(sight: BotSight): BotMove {
    const pub = readPublic(sight.publicState)
    const current = pub?.phase === 'asking' ? pub.current : null
    if (!current || current.key in sight.myAnswers) return null
    const prompt = sight.prompts.find((p) => p.key === current.key)
    if (!prompt || prompt.closedAt !== null || prompt.revealedAt !== null) return null
    // The picker comes once the picture is in on the TV.
    if (sight.now < current.startsAt) return null
    const left = current.endsAt - sight.now
    // A phone stops taking taps when its countdown ends.
    if (left <= 0) return null
    // Called about once a second: a chance of one in the seconds left spreads the
    // locks evenly over the countdown, and the last second always locks in.
    if (left > 1000 && sight.random() >= 1000 / left) return null
    const me = sight.players.find((p) => p.id === sight.playerId)?.name ?? ''
    const offered = prompt.spec.kind === 'choice' && Array.isArray(prompt.spec.options) ? prompt.spec.options : sight.players.map((p) => p.name)
    const others = offered.filter((name) => nameKey(name) !== nameKey(me))
    if (others.length < 2) return null
    return { kind: 'answer', key: current.key, answer: { choice: pickTwo(others, sight.random) } }
  },

  /**
   * From the lobby, and from the wall after a pause, asks the next picture
   * (setting a missing key first), or crowns the face detective when none is
   * left; Reveal now once everyone here has locked in (the timer reveals
   * otherwise); nothing in the reveal (the wall comes back by itself). A timer
   * 5 s overdue gets its step tapped by hand.
   */
  hostMove(sight: HostBotSight) {
    if (!sight.state || isLegacyState(sight.state)) return null
    const state = readState(sight.state as FusionState)
    const config = sight.config as FusionConfig | null
    if (!config || !Array.isArray(config.pictures)) return null
    const numbers = config.pictures.map((_, i) => i + 1)

    switch (state.phase) {
      case 'lobby':
      case 'wall': {
        // The wall came back after the last reveal.
        const last = state.revealed.at(-1)
        const revealedAt = last !== undefined ? state.results[last]?.at : undefined
        const wallFrom = revealedAt !== undefined ? revealedAt + REVEAL_HOLD_MS : 0
        if (state.phase === 'wall' && sight.now < wallFrom + WALL_PAUSE_MS) return null
        const next = numbers.find((n) => !state.revealed.includes(n))
        if (next === undefined) return { action: { type: 'finish' } }
        if (!state.key[next]) {
          // Typed on the night, as the host would with Show who.
          const names = sight.players.map((p) => p.name)
          if (names.length < 2) return { action: { type: 'finish' } }
          return { action: { type: 'setKey', n: next, people: [names[0], names[1]] } }
        }
        return { action: { type: 'ask', n: next } }
      }
      case 'asking': {
        const n = state.current
        if (n === null) return null
        const key = pictureKey(n)
        const everyone = sight.players.length > 0 && (sight.tallies[key] ?? 0) >= sight.players.length
        const overdue = state.endsAt !== null && sight.now >= state.endsAt + GRACE_MS + WAKE_MARGIN_MS + TIMER_PATIENCE_MS
        return everyone || overdue ? { action: { type: 'reveal', n }, close: [key] } : null
      }
      case 'reveal': {
        const n = state.current
        const overdue = state.revealedAt !== null && sight.now >= state.revealedAt + REVEAL_HOLD_MS + TIMER_PATIENCE_MS
        return n !== null && overdue ? { action: { type: 'wall', from: 'reveal', n } } : null
      }
      default:
        return null
    }
  },
}

/** Two different names, at random. */
function pickTwo(names: readonly string[], random: () => number): [string, string] {
  const first = Math.floor(random() * names.length)
  let second = Math.floor(random() * (names.length - 1))
  if (second >= first) second++
  return [names[first], names[second]]
}
