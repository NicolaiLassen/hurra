// Rehearsal bots (docs/engine-v2.md, 3.6). The rehearsal plays every game
// through these, so the script knows no game's rules. Each game exports `bot`
// from src/games/<folder>/bot.ts; src/games/bots.ts maps game types to them.
// A bot file follows the logic rules: relative imports only, no React, no
// browser globals, randomness only from sight.random.
import type { AnswerPayload, PlayerId, Prompt } from './Game'

/** What a guest bot sees: what its phone sees. */
export type BotSight = {
  readonly playerId: PlayerId
  readonly players: readonly { readonly id: PlayerId; readonly name: string; readonly code: string }[]
  readonly publicState: unknown
  readonly view: unknown
  /** This game's prompts this round. */
  readonly prompts: readonly Prompt[]
  readonly myAnswers: Readonly<Record<string, AnswerPayload>>
  /** Ms since epoch by the database clock. */
  readonly now: number
  readonly random: () => number
}

/** What the scripted host sees: the host page's view of the game. */
export type HostBotSight = Omit<BotSight, 'playerId' | 'view' | 'myAnswers'> & {
  readonly state: unknown
  readonly config: unknown
  readonly tallies: Readonly<Record<string, number>>
}

export type BotMove =
  | { readonly kind: 'action'; readonly action: unknown }
  | { readonly kind: 'answer'; readonly key: string; readonly answer: AnswerPayload }
  | null

export type GameBot = {
  /** Settings for a scripted round, given the party's player ids. Default {}. */
  settings?(playerIds: readonly PlayerId[]): Record<string, unknown>
  /** A guest's next move, or null to wait. Called about once a second per bot and live game. */
  move(sight: BotSight): BotMove
  /** The scripted host's next action, or null to wait (timers move the game on). */
  hostMove?(sight: HostBotSight): { action: unknown; close?: string[] } | null
}
