// The rehearsal's Participant fusion player (docs/engine-v2.md, 3.6 and 8.4).
// Relative imports only, no React, no browser globals, randomness only from
// sight.random: the rehearsal runs this under Node.
import type { BotSight, GameBot, HostBotSight } from '../core/bot'
import type { PlayerId } from '../core/Game'
import { defaultLabel, pictureKey, type FusionConfig, type FusionState } from './logic'

/** Pictures in a scripted round. */
const PICTURES = 4
/** The scripted host locks voting this long after the start, if not everyone has voted by then. */
const LOCK_AFTER_MS = 60_000
const PICTURE_KEY = /^p\d+$/

export const bot: GameBot = {
  /** 4 pictures whose people are pairs of the first 8 players (fewer players repeat pairs). */
  settings(playerIds) {
    const pool = playerIds.slice(0, 8)
    return {
      pictures: Array.from({ length: PICTURES }, (_, i) => {
        const a = pool[(2 * i) % Math.max(1, pool.length)]
        const b = pool[(2 * i + 1) % Math.max(1, pool.length)]
        return pool.length >= 2 && a !== b ? { label: defaultLabel(i + 1), people: [a, b] } : { label: defaultLabel(i + 1) }
      }),
      pointsPerPerson: 1,
      bonusForBoth: 1,
    }
  },

  /** Votes on an open picture it hasn't voted on yet, with 2 random other players. */
  move(sight: BotSight) {
    const others = sight.players.filter((p) => p.id !== sight.playerId).map((p) => p.id)
    if (others.length < 2) return null
    const open = sight.prompts.filter(
      (p) => PICTURE_KEY.test(p.key) && p.closedAt === null && p.revealedAt === null && !(p.key in sight.myAnswers),
    )
    if (open.length === 0) return null
    const prompt = open[Math.floor(sight.random() * open.length)]
    return { kind: 'answer', key: prompt.key, answer: { choice: pickTwo(others, sight.random) } }
  },

  /**
   * Locks voting once everyone has voted on every picture, or a minute after
   * the start; then reveals the pictures in order (setting a missing key
   * first), then crowns the face detective.
   */
  hostMove(sight: HostBotSight) {
    const state = sight.state as FusionState | null
    const config = sight.config as FusionConfig | null
    if (!state || !config || !Array.isArray(config.pictures)) return null
    const numbers = config.pictures.map((_, i) => i + 1)

    if (state.phase === 'voting') {
      const voters = sight.players.length
      const everyone = voters > 0 && numbers.every((n) => (sight.tallies[pictureKey(n)] ?? 0) >= voters)
      const opened = sight.prompts.filter((p) => PICTURE_KEY.test(p.key)).map((p) => p.openedAt)
      const late = opened.length > 0 && sight.now - Math.min(...opened) >= LOCK_AFTER_MS
      return everyone || late ? { action: { type: 'lock' } } : null
    }

    if (state.phase === 'locked') {
      const next = numbers.find((n) => !state.revealed.includes(n))
      if (next === undefined) return { action: { type: 'finish' } }
      if (!state.key[next]) {
        // Set on the night, as the host would from the control room.
        const ids = sight.players.map((p) => p.id)
        if (ids.length < 2) return { action: { type: 'finish' } }
        const people: [PlayerId, PlayerId] = [ids[0], ids[1]]
        return { action: { type: 'setKey', n: next, people } }
      }
      return { action: { type: 'reveal', n: next }, close: [pictureKey(next)] }
    }
    return null
  },
}

/** Two different players, at random. */
function pickTwo(ids: readonly PlayerId[], random: () => number): [PlayerId, PlayerId] {
  const first = Math.floor(random() * ids.length)
  let second = Math.floor(random() * (ids.length - 1))
  if (second >= first) second++
  return [ids[first], ids[second]]
}
