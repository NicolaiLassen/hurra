import { describe, expect, it } from 'vitest'
import type { BotSight, HostBotSight } from '../core/bot'
import { botExample, botSight, checkGameContract, hostBotSight } from '../core/contract'
import type { Prompt } from '../core/Game'
import { simulateParty } from '../core/simulate'
import { seededRandom } from '../core/testing'
import { bot, BOT_QUESTIONS, BOT_SECONDS } from './bot'
import { GRACE_MS, QuizGame, REVEAL_HOLD_MS, WAKE_MARGIN_MS, type QuizConfig, type QuizPublicState, type QuizState } from './logic'

const quiz = new QuizGame()
const GAME = 'quiz'

/** A whole quiz played by the bots, a tick a second, with the TV's syncs, as the rehearsal plays it. */
function playWithBots(players: number, rounds = 1000) {
  const party = simulateParty({ games: [quiz], players })
  party.addGame(GAME, 'quiz', 'Bot quiz', bot.settings!(party.players.map((p) => p.id)))
  expect(party.send(party.hostUser, { type: 'start', gameId: GAME }).kind).toBe('commit')
  const random = seededRandom(5)
  const live = () => party.game(GAME).status === 'active'
  const refusals: string[] = []
  for (let round = 0; round < rounds && live(); round++) {
    for (const player of party.players) {
      const move = bot.move(botSight(party, GAME, player.id, random))
      if (move?.kind === 'action') refusals.push('a guest bot sent a move')
      if (move?.kind === 'answer') {
        const prompt = party.promptsOf(GAME).find((p) => p.key === move.key)!
        // Throws if the database refuses it: a bot never answers too late or twice.
        party.submit(GAME, move.key, player.id, move.answer, party.now - prompt.openedAt)
      }
    }
    const hostMove = live() ? bot.hostMove!(hostBotSight(party, GAME, random)) : null
    if (hostMove) {
      const result = party.send(party.hostUser, { type: 'host-action', gameId: GAME, action: hostMove.action, close: hostMove.close })
      if (result.kind === 'refuse') refusals.push(result.message)
    }
    party.tick(1000)
    const wake = party.game(GAME).wakeAt
    if (live() && wake !== null && wake <= party.now) party.sync(GAME)
  }
  return { party, refusals }
}

describe('the quiz bot', () => {
  it('plays a whole quiz to the crown: every guest answers every question, inside its countdown', () => {
    const { party, refusals } = playWithBots(8)
    expect(refusals).toEqual([])
    expect(party.game(GAME)).toMatchObject({ status: 'finished', finishedBy: 'game' })
    const state = party.stateOf(GAME)!.state as QuizState
    expect(state.results).toHaveLength(BOT_QUESTIONS)
    expect(state.results.every((r) => Object.keys(r.answers).length === 8)).toBe(true)

    // Answers spread over the countdown rather than all at once.
    const times = state.results.flatMap((r) => Object.values(r.answers).map((a) => a.ms))
    expect(Math.max(...times)).toBeLessThan(BOT_SECONDS * 1000)
    expect(new Set(times).size).toBeGreaterThan(4)

    // Someone got something right in 10 questions of 4 options, so a winner was crowned.
    expect(party.game(GAME).winners.length).toBeGreaterThan(0)
    expect(party.feed.some((f) => f.message.endsWith('the quiz!') && f.interrupt)).toBe(true)
  })

  it('keeps the game contract over a round it plays, with a join and a leave', () => {
    const result = botExample(quiz, bot, { players: 6, rounds: 400 })
    expect('example' in result).toBe(true)
    if (!('example' in result)) return
    expect(checkGameContract(quiz, result.example)).toEqual([])
    // Played to the crown by itself: the example needed no End.
    expect(result.example.steps.some((s) => s.kind === 'end')).toBe(false)
  })

  it('makes settings the quiz accepts: 10 questions of 10 s with 4 options', () => {
    const settings = bot.settings!([]) as QuizConfig
    expect(quiz.parseConfig!({ ...quiz.defaultConfig, ...settings })).toEqual(settings)
    expect(settings.questions).toHaveLength(10)
    expect(settings.questions.every((q) => q.options.length === 4)).toBe(true)
    expect(settings.seconds).toBe(10)
  })
})

describe('a guest bot', () => {
  const OPENED = 1_000_000
  const prompt = (overrides: Partial<Prompt> = {}): Prompt => ({
    key: 'q1',
    spec: { kind: 'choice', options: ['0', '1', '2', '3'], final: true },
    openedAt: OPENED,
    closesAt: OPENED + 11_000,
    closedAt: null,
    revealedAt: null,
    ...overrides,
  })
  const asking = (endsAt = OPENED + 10_000): QuizPublicState => ({
    phase: 'question',
    index: 0,
    total: 3,
    question: { key: 'q1', text: 'Q?', options: ['A', 'B', 'C', 'D'], endsAt },
    reveal: null,
    leaderboard: [],
  })
  const sight = (overrides: Partial<BotSight> = {}): BotSight => ({
    playerId: 'p1',
    players: [],
    publicState: asking(),
    view: null,
    prompts: [prompt()],
    myAnswers: {},
    now: OPENED + 9500,
    random: () => 0.5,
    ...overrides,
  })

  it('answers an open question in its last second, with one of its options', () => {
    expect(bot.move(sight())).toEqual({ kind: 'answer', key: 'q1', answer: { choice: ['2'] } })
    expect(bot.move(sight({ random: () => 0.999 }))).toEqual({ kind: 'answer', key: 'q1', answer: { choice: ['3'] } })
  })

  it('answers earlier by chance, about once in the seconds left', () => {
    const early = { now: OPENED + 2000 } // 8 s left: a chance of 1 in 8
    expect(bot.move(sight({ ...early, random: () => 0.1 }))?.kind).toBe('answer')
    expect(bot.move(sight({ ...early, random: () => 0.2 }))).toBeNull()
  })

  it('waits when there is nothing to answer', () => {
    expect(bot.move(sight({ publicState: null }))).toBeNull()
    expect(bot.move(sight({ publicState: { ...asking(), phase: 'reveal' } }))).toBeNull()
    expect(bot.move(sight({ myAnswers: { q1: { choice: ['1'] } } }))).toBeNull()
    expect(bot.move(sight({ prompts: [] }))).toBeNull()
    expect(bot.move(sight({ prompts: [prompt({ closedAt: OPENED + 5000 })] }))).toBeNull()
    // The countdown is over: a phone takes no more taps.
    expect(bot.move(sight({ now: OPENED + 10_000 }))).toBeNull()
  })
})

describe('the scripted host', () => {
  const quizState = (overrides: Partial<QuizState>): QuizState => ({
    phase: 'lobby',
    index: -1,
    openedAt: null,
    endsAt: null,
    revealedAt: null,
    results: [],
    quizPoints: {},
    right: {},
    ...overrides,
  })
  const config = bot.settings!([]) as QuizConfig
  const players = ['p1', 'p2', 'p3'].map((id) => ({ id, name: id, code: id }))
  const sight = (state: QuizState | null, overrides: Partial<HostBotSight> = {}): HostBotSight => ({
    players,
    publicState: null,
    prompts: [],
    now: 50_000,
    random: () => 0.5,
    state,
    config,
    tallies: {},
    ...overrides,
  })

  it('starts the first question from the lobby', () => {
    expect(bot.hostMove!(sight(quizState({})))).toEqual({ action: { type: 'next', from: -1 } })
  })

  it('lets the timer reveal unless everyone has answered, then taps Reveal now with the question closed', () => {
    const asking = quizState({ phase: 'question', index: 2, openedAt: 40_000, endsAt: 50_000 })
    expect(bot.hostMove!(sight(asking, { now: 45_000, tallies: { q3: 2 } }))).toBeNull()
    expect(bot.hostMove!(sight(asking, { now: 45_000, tallies: { q3: 3 } }))).toEqual({
      action: { type: 'reveal', index: 2 },
      close: ['q3'],
    })
    // A timer that never came: the host moves on by hand.
    const late = 50_000 + GRACE_MS + WAKE_MARGIN_MS + 5000
    expect(bot.hostMove!(sight(asking, { now: late - 1, tallies: { q3: 1 } }))).toBeNull()
    expect(bot.hostMove!(sight(asking, { now: late, tallies: { q3: 1 } }))).toEqual({
      action: { type: 'reveal', index: 2 },
      close: ['q3'],
    })
  })

  it('leaves the reveal to the timer, then lets the leaderboard show a moment', () => {
    const revealed = quizState({ phase: 'reveal', index: 2, endsAt: 50_000, revealedAt: 51_000 })
    expect(bot.hostMove!(sight(revealed, { now: 51_000 + REVEAL_HOLD_MS }))).toBeNull()
    expect(bot.hostMove!(sight(revealed, { now: 51_000 + REVEAL_HOLD_MS + 5000 }))).toEqual({
      action: { type: 'leaderboard', index: 2 },
    })
    const board = quizState({ phase: 'leaderboard', index: 2, endsAt: 50_000, revealedAt: 51_000 })
    expect(bot.hostMove!(sight(board, { now: 51_000 + REVEAL_HOLD_MS + 2000 }))).toBeNull()
    expect(bot.hostMove!(sight(board, { now: 51_000 + REVEAL_HOLD_MS + 3000 }))).toEqual({ action: { type: 'next', from: 2 } })
  })

  it('crowns the winner after the last question, and does nothing once done', () => {
    const last = quizState({ phase: 'leaderboard', index: BOT_QUESTIONS - 1, revealedAt: 0 })
    expect(bot.hostMove!(sight(last))).toEqual({ action: { type: 'finish' } })
    expect(bot.hostMove!(sight(quizState({ phase: 'done', index: BOT_QUESTIONS - 1 })))).toBeNull()
    expect(bot.hostMove!(sight(null))).toBeNull()
  })
})
