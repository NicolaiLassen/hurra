// The quiz's rehearsal bot (docs/engine-v2.md, 3.6 and 8.3): guests answer
// each question at a random moment inside its countdown, and the scripted host
// moves the quiz on like a person at the host page would. A bot file follows
// the logic rules: relative imports only, no React, no browser globals,
// randomness only from sight.random.
import type { BotMove, BotSight, GameBot, HostBotSight } from '../core/bot'
import { GRACE_MS, promptKey, REVEAL_HOLD_MS, WAKE_MARGIN_MS, type QuizConfig, type QuizPublicState, type QuizState } from './logic'

/** Questions in a scripted round, each this many seconds. */
export const BOT_QUESTIONS = 10
export const BOT_SECONDS = 10
/** How long the scripted host lets the leaderboard show before the next question. */
const LEADERBOARD_PAUSE_MS = 3000
/** If a timer hasn't moved the quiz on this long after it was due, the host taps the step by hand. */
const TIMER_PATIENCE_MS = 5000

export const bot: GameBot = {
  settings: () => ({
    seconds: BOT_SECONDS,
    pointsPerRight: 1,
    questions: Array.from({ length: BOT_QUESTIONS }, (_, i) => ({
      text: `Rehearsal question ${i + 1}: which option is right?`,
      options: ['Option A', 'Option B', 'Option C', 'Option D'],
      correct: i % 4,
    })),
  }),

  /** Answers an open question it hasn't answered, with a random option, at a random moment inside the countdown. */
  move(sight: BotSight): BotMove {
    const pub = sight.publicState as Partial<QuizPublicState> | null
    const question = pub?.phase === 'question' ? pub.question : null
    if (!question || question.key in sight.myAnswers) return null
    const prompt = sight.prompts.find((p) => p.key === question.key)
    if (!prompt || prompt.closedAt !== null || prompt.revealedAt !== null) return null
    const left = question.endsAt - sight.now
    // A phone stops taking taps when its countdown ends.
    if (left <= 0) return null
    // Called about once a second: answering with a chance of one in the seconds
    // left spreads the answers evenly over the countdown, and the last second always answers.
    if (left > 1000 && sight.random() >= 1000 / left) return null
    const choice = Math.min(question.options.length - 1, Math.floor(sight.random() * question.options.length))
    return { kind: 'answer', key: question.key, answer: { choice: [String(choice)] } }
  },

  /**
   * Next from the lobby and the leaderboard, Reveal now once every player has
   * answered (the timer reveals otherwise), nothing in the reveal (the
   * leaderboard follows by itself), and Crown the winner after the last question.
   */
  hostMove(sight: HostBotSight) {
    const state = sight.state as QuizState | null
    const config = sight.config as QuizConfig | null
    if (!state || !config) return null
    switch (state.phase) {
      case 'lobby':
        return { action: { type: 'next', from: state.index } }
      case 'question': {
        const key = promptKey(state.index)
        const everyone = sight.players.length > 0 && (sight.tallies[key] ?? 0) >= sight.players.length
        const overdue = state.endsAt !== null && sight.now >= state.endsAt + GRACE_MS + WAKE_MARGIN_MS + TIMER_PATIENCE_MS
        return everyone || overdue ? { action: { type: 'reveal', index: state.index }, close: [key] } : null
      }
      case 'reveal': {
        const overdue = state.revealedAt !== null && sight.now >= state.revealedAt + REVEAL_HOLD_MS + TIMER_PATIENCE_MS
        return overdue ? { action: { type: 'leaderboard', index: state.index } } : null
      }
      case 'leaderboard': {
        const shownAt = (state.revealedAt ?? 0) + REVEAL_HOLD_MS
        if (sight.now < shownAt + LEADERBOARD_PAUSE_MS) return null
        return state.index + 1 < config.questions.length
          ? { action: { type: 'next', from: state.index } }
          : { action: { type: 'finish' } }
      }
      default:
        return null
    }
  },
}
