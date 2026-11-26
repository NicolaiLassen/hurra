import { describe, expect, it } from 'vitest'
import { createGameContext } from '../core/context'
import { checkGameContract } from '../core/contract'
import { GameError, type AnyGame, type GameInfo, type RecapRound } from '../core/Game'
import { FakeDbError, simulateParty, type FakeParty } from '../core/simulate'
import { jsonbRoundTrip } from '../core/testing'
import {
  checkQuizConfig,
  formatNumber,
  GRACE_MS,
  joinNames,
  promptKey,
  QuizGame,
  rankPlayers,
  REVEAL_HOLD_MS,
  speedPoints,
  WAKE_MARGIN_MS,
  type QuizConfig,
  type QuizHostAction,
  type QuizPlayerView,
  type QuizPublicState,
  type QuizQuestion,
  type QuizState,
} from './logic'

const quiz = new QuizGame()
const GAME = 'quiz'

const QUESTIONS: QuizQuestion[] = [
  { text: 'Which country invented LEGO?', options: ['Sweden', 'Denmark', 'Germany', 'Switzerland'], correct: 1 },
  { text: 'How many keys does a piano have?', options: ['76', '88', '92'], correct: 1, seconds: 20 },
  { text: 'True or false: honey keeps for thousands of years.', options: ['True', 'False'], correct: 0 },
  { text: 'What is a group of flamingos called?', options: ['A parade', 'A blush', 'A flamboyance', 'A disco'], correct: 2 },
  { text: 'Which animal has three hearts?', options: ['Jellyfish', 'Octopus', 'Starfish', 'Seahorse'], correct: 1 },
  { text: 'How many hours are there in a week?', options: ['148', '172', '168'], correct: 2 },
]
const CONFIG: QuizConfig = { questions: QUESTIONS, seconds: 10, pointsPerRight: 2 }

/** A party of `players` with the quiz started on the TV. */
function startQuiz(players = 4, config: QuizConfig = CONFIG): FakeParty {
  const party = simulateParty({ games: [quiz], players })
  party.addGame(GAME, 'quiz', 'Quiz', config)
  expect(party.send(party.hostUser, { type: 'start', gameId: GAME }).kind).toBe('commit')
  return party
}

const host = (party: FakeParty, action: QuizHostAction, close?: string[]) =>
  party.send(party.hostUser, { type: 'host-action', gameId: GAME, action, close })
const state = (party: FakeParty) => party.stateOf(GAME)!.state as QuizState
const pub = (party: FakeParty) => party.game(GAME).publicState as QuizPublicState
const viewOf = (party: FakeParty, n: number) => party.game(GAME).views[party.players[n].id] as QuizPlayerView
const idOf = (party: FakeParty, n: number) => party.players[n].id
const recapOf = (party: FakeParty) => party.recapRounds(GAME).map((round) => round as RecapRound<QuizState, QuizConfig>)
/** Player n answers the open question, `afterMs` after it opened. */
const answer = (party: FakeParty, n: number, choice: number, afterMs: number) =>
  party.submit(GAME, promptKey(state(party).index), idOf(party, n), { choice: [String(choice)] }, afterMs)
/** Reveal now, as the host page sends it: closing the question first. */
const revealNow = (party: FakeParty) =>
  host(party, { type: 'reveal', index: state(party).index }, [promptKey(state(party).index)])
/** Lets the timer reveal the open question, as the TV's sync does. */
function timerReveal(party: FakeParty) {
  party.now = state(party).endsAt! + GRACE_MS + WAKE_MARGIN_MS
  return party.sync(GAME)
}

describe('settings', () => {
  it('ships default settings that refuse to start without questions', () => {
    expect(jsonbRoundTrip(quiz.defaultConfig)).toEqual({ questions: [], seconds: 20, pointsPerRight: 1 })
    const party = simulateParty({ games: [quiz], players: 2 })
    party.addGame(GAME, 'quiz', 'Quiz')
    expect(party.send(party.hostUser, { type: 'start', gameId: GAME })).toMatchObject({
      kind: 'refuse',
      code: 'rule',
      message: 'Add at least one question in the settings',
    })
  })

  it('cleans what it accepts: texts trimmed, seconds kept where set, extras dropped', () => {
    const config = quiz.parseConfig!({
      questions: [
        { text: '  Which country invented LEGO? ', options: [' Denmark', 'Sweden '], correct: 0, seconds: 30, note: 'x' },
        { text: 'Two?', options: ['1', '2'], correct: '1', seconds: '' },
      ],
      seconds: '15',
      pointsPerRight: 0,
      theme: 'neon',
    })
    expect(config).toEqual({
      questions: [
        { text: 'Which country invented LEGO?', options: ['Denmark', 'Sweden'], correct: 0, seconds: 30 },
        { text: 'Two?', options: ['1', '2'], correct: 1 },
      ],
      seconds: 15,
      pointsPerRight: 0,
    })
  })

  const question = { text: 'Q?', options: ['A', 'B'], correct: 0 }
  it.each([
    ['no questions', { questions: [] }, 'Add at least one question in the settings'],
    ['questions that are not a list', { questions: 'Q?' }, 'Add at least one question in the settings'],
    ['51 questions', { questions: Array.from({ length: 51 }, () => question) }, 'A quiz holds up to 50 questions'],
    ['an empty question', { questions: [{ ...question, text: '  ' }] }, 'Question 1 needs a question'],
    ['a long question', { questions: [{ ...question, text: 'x'.repeat(201) }] }, 'Question 1 is longer than 200 characters'],
    ['one option', { questions: [{ ...question, options: ['A'] }] }, 'Question 1 needs 2 to 4 options'],
    ['five options', { questions: [{ ...question, options: ['A', 'B', 'C', 'D', 'E'] }] }, 'Question 1 needs 2 to 4 options'],
    ['an empty option', { questions: [question, { ...question, options: ['A', ' '] }] }, 'Question 2 has an empty option'],
    ['a long option', { questions: [{ ...question, options: ['A', 'b'.repeat(81)] }] }, 'Question 1 has an option longer than 80 characters'],
    ['the same option twice', { questions: [{ ...question, options: ['Yes', 'yes '] }] }, 'Question 1 has the same option twice'],
    ['no right answer', { questions: [{ ...question, correct: undefined }] }, 'Pick the right answer for question 1'],
    ['a right answer out of range', { questions: [{ ...question, correct: 2 }] }, 'Pick the right answer for question 1'],
    ['a right answer that is not whole', { questions: [{ ...question, correct: 0.5 }] }, 'Pick the right answer for question 1'],
    ['4 seconds for a question', { questions: [{ ...question, seconds: 4 }] }, 'Question 1 needs a time of 5 to 60 seconds'],
    ['61 seconds for a question', { questions: [{ ...question, seconds: 61 }] }, 'Question 1 needs a time of 5 to 60 seconds'],
    ['a default of 3 seconds', { questions: [question], seconds: 3 }, 'The time per question must be 5 to 60 seconds'],
    ['11 points per right answer', { questions: [question], pointsPerRight: 11 }, 'Points per right answer must be a whole number from 0 to 10'],
    ['half a point per right answer', { questions: [question], pointsPerRight: 0.5 }, 'Points per right answer must be a whole number from 0 to 10'],
  ])('refuses %s', (_, settings, message) => {
    const input = { ...quiz.defaultConfig, ...settings } as Record<string, unknown>
    expect(() => quiz.parseConfig!(input)).toThrow(new GameError(message))
  })

  it('lists every problem for the settings editor, in the order a host fixes them', () => {
    const { problems } = checkQuizConfig({
      questions: [
        { text: '', options: ['A'], correct: 3 },
        { text: 'Fine?', options: ['Yes', 'No'], correct: 1 },
      ],
      seconds: 90,
      pointsPerRight: 1,
    })
    expect(problems).toEqual([
      'Question 1 needs a question',
      'Question 1 needs 2 to 4 options',
      'Pick the right answer for question 1',
      'The time per question must be 5 to 60 seconds',
    ])
  })
})

describe('secrets', () => {
  it('keeps the right answer out of the public state, the views and the prompt spec until its reveal', () => {
    const party = startQuiz(3)
    expect(host(party, { type: 'next', from: -1 }).kind).toBe('commit')

    expect(party.promptsOf(GAME)[0].spec).toEqual({ kind: 'choice', options: ['0', '1', '2', '3'], final: true })
    expect(pub(party).reveal).toBeNull()
    expect(JSON.stringify(pub(party))).not.toContain('correct')
    expect(viewOf(party, 0).last).toBeNull()

    answer(party, 0, 1, 2000)
    expect(revealNow(party).kind).toBe('commit')
    expect(pub(party).reveal?.correct).toBe(1)
    expect(viewOf(party, 0).last).toMatchObject({ index: 0, choice: 1, correct: 1 })

    // The next question: only the revealed one's answer is out.
    party.tick(REVEAL_HOLD_MS)
    party.sync(GAME)
    expect(host(party, { type: 'next', from: 0 }).kind).toBe('commit')
    expect(pub(party).reveal).toBeNull()
    expect(JSON.stringify(pub(party))).not.toContain('correct')
    expect(party.promptsOf(GAME)[1].spec).toEqual({ kind: 'choice', options: ['0', '1', '2'], final: true })
    for (const view of Object.values(party.game(GAME).views) as QuizPlayerView[]) expect(view.last?.index).toBe(0)
  })

  it('shows the question asked, never one ahead', () => {
    const party = startQuiz()
    expect(pub(party)).toEqual({ phase: 'lobby', index: -1, total: 6, question: null, reveal: null, leaderboard: [] })
    host(party, { type: 'next', from: -1 })
    expect(pub(party).question).toEqual({
      key: 'q1',
      text: QUESTIONS[0].text,
      options: QUESTIONS[0].options,
      endsAt: party.now + 10_000,
    })
    expect(JSON.stringify(pub(party))).not.toContain(QUESTIONS[1].text)
  })
})

describe('speed scoring', () => {
  it('gives 1,000 for a right answer at once, down to 500 at the end of the countdown', () => {
    expect(speedPoints(0, 10)).toBe(1000)
    expect(speedPoints(2500, 10)).toBe(875)
    expect(speedPoints(5000, 10)).toBe(750)
    expect(speedPoints(10_000, 10)).toBe(500)
    // In the grace second, and with a clock that ran backwards.
    expect(speedPoints(10_900, 10)).toBe(500)
    expect(speedPoints(-40, 10)).toBe(1000)
  })

  it('scores each answer by its own speed and question, and the day by right answers', () => {
    const party = startQuiz(5)
    host(party, { type: 'next', from: -1 })
    answer(party, 0, 1, 0) // right at once
    answer(party, 1, 1, 10_000) // right as the countdown ends
    answer(party, 2, 1, 10_600) // right in the grace second
    answer(party, 3, 0, 1000) // wrong
    // Player 4 doesn't answer, and after the deadline nobody can.
    party.tick(11_000)
    expect(() => answer(party, 4, 1, 11_000)).toThrow(FakeDbError)
    expect(timerReveal(party).kind).toBe('commit')

    expect(state(party).quizPoints).toEqual({ [idOf(party, 0)]: 1000, [idOf(party, 1)]: 500, [idOf(party, 2)]: 500 })
    expect(state(party).right).toEqual({ [idOf(party, 0)]: 1, [idOf(party, 1)]: 1, [idOf(party, 2)]: 1 })
    expect(party.game(GAME).scores).toEqual({ [idOf(party, 0)]: 2, [idOf(party, 1)]: 2, [idOf(party, 2)]: 2 })
    expect(pub(party).reveal).toEqual({
      correct: 1,
      counts: [1, 3, 0, 0],
      answered: 4,
      rightCount: 3,
      fastest: [
        { playerId: idOf(party, 0), ms: 0 },
        { playerId: idOf(party, 1), ms: 10_000 },
        { playerId: idOf(party, 2), ms: 10_600 },
      ],
    })
    expect(viewOf(party, 0)).toEqual({ quizPoints: 1000, rank: 1, right: 1, last: { index: 0, choice: 1, correct: 1, points: 1000 } })
    expect(viewOf(party, 3)).toEqual({ quizPoints: 0, rank: null, right: 0, last: { index: 0, choice: 0, correct: 1, points: 0 } })
    expect(viewOf(party, 4)).toEqual({ quizPoints: 0, rank: null, right: 0, last: { index: 0, choice: null, correct: 1, points: 0 } })

    // Question 2 runs 20 s (its own seconds), so the same 5 s earn more.
    party.tick(REVEAL_HOLD_MS)
    party.sync(GAME)
    host(party, { type: 'next', from: 0 })
    expect(state(party).endsAt).toBe(party.now + 20_000)
    answer(party, 3, 1, 5000)
    revealNow(party)
    expect(state(party).quizPoints[idOf(party, 3)]).toBe(875)
    expect(viewOf(party, 3).rank).toBe(2)
    expect(pub(party).leaderboard).toEqual([
      { playerId: idOf(party, 0), points: 1000, gained: 0, rank: 1 },
      { playerId: idOf(party, 3), points: 875, gained: 875, rank: 2 },
      { playerId: idOf(party, 1), points: 500, gained: 0, rank: 3 },
      { playerId: idOf(party, 2), points: 500, gained: 0, rank: 3 },
    ])
  })

  it('ranks ties together and in join order, whatever order jsonb keeps the keys in', () => {
    const players = ['p1', 'p2', 'p3', 'p4'].map((id) => ({ id }))
    const points = jsonbRoundTrip({ p4: 900, p3: 500, p2: 900, p1: 700 })
    expect(rankPlayers(points, players)).toEqual([
      { playerId: 'p2', points: 900, rank: 1 },
      { playerId: 'p4', points: 900, rank: 1 },
      { playerId: 'p1', points: 700, rank: 3 },
      { playerId: 'p3', points: 500, rank: 4 },
    ])
    // Someone who left drops out.
    expect(rankPlayers(points, players.slice(0, 3)).map((row) => row.playerId)).toEqual(['p2', 'p1', 'p3'])
  })
})

describe('timers', () => {
  it('reveals when time is up and shows the leaderboard 7 s later, by itself', () => {
    const party = startQuiz(3)
    host(party, { type: 'next', from: -1 })
    const endsAt = state(party).endsAt!
    expect(party.game(GAME).wakeAt).toBe(endsAt + GRACE_MS + WAKE_MARGIN_MS)
    answer(party, 0, 1, 3000)

    // Syncs before the wake change nothing, even once the deadline has closed the question.
    party.now = endsAt
    expect(party.sync(GAME).kind).toBe('skip')
    party.now = endsAt + GRACE_MS
    expect(party.sync(GAME).kind).toBe('skip')
    expect(party.promptsOf(GAME)[0].closedAt).toBe(endsAt + GRACE_MS)
    expect(state(party).phase).toBe('question')

    party.now = endsAt + GRACE_MS + WAKE_MARGIN_MS
    expect(party.sync(GAME).kind).toBe('commit')
    expect(state(party)).toMatchObject({ phase: 'reveal', revealedAt: party.now })
    expect(party.promptsOf(GAME)[0].revealedAt).toBe(party.now)
    expect(state(party).quizPoints[idOf(party, 0)]).toBe(speedPoints(3000, 10))
    expect(party.game(GAME).wakeAt).toBe(party.now + REVEAL_HOLD_MS)

    party.tick(REVEAL_HOLD_MS - 1)
    expect(party.sync(GAME).kind).toBe('skip')
    party.tick(1)
    expect(party.sync(GAME).kind).toBe('commit')
    expect(state(party).phase).toBe('leaderboard')
    expect(party.game(GAME).wakeAt).toBeNull()
    expect(party.log.some((row) => row.kind === 'game.wake_stuck')).toBe(false)
  })

  it('reveals once when the sync comes long after the deadline, and holds the reveal from then', () => {
    const party = startQuiz(2)
    host(party, { type: 'next', from: -1 })
    party.tick(60_000)
    expect(party.sync(GAME).kind).toBe('commit')
    expect(state(party)).toMatchObject({ phase: 'reveal', revealedAt: party.now })
    expect(state(party).results).toHaveLength(1)
  })

  it('never scores a question without its answers, should a sync beat the database close', () => {
    // WAKE_MARGIN_MS rules this out in the database; if it happens anyway,
    // onWake closes the question and waits for Reveal now instead of scoring nobody.
    const open: QuizState = {
      phase: 'question',
      index: 0,
      openedAt: 0,
      endsAt: 10_000,
      revealedAt: null,
      results: [],
      quizPoints: {},
      right: {},
    }
    const info: GameInfo<QuizConfig> = {
      gameId: GAME,
      round: 1,
      session: { id: 's', name: 'Party', data: {} },
      players: [{ id: 'p1', name: 'Ana', profile: {} }],
      guests: [{ id: 'p1', name: 'Ana', joined: true }],
      scoreboard: {},
      config: CONFIG,
      now: 11_250,
      prompts: {
        q1: {
          key: 'q1',
          spec: { kind: 'choice', options: ['0', '1'], final: true },
          openedAt: 0,
          closesAt: 11_000,
          closedAt: null,
          revealedAt: null,
        },
      },
      answers: {},
    }
    const { ctx, effects } = createGameContext(info, () => 0.5, { actor: { kind: 'timer' } })
    expect(quiz.onWake!(open, ctx)).toBe(open)
    expect(effects.prompts).toEqual({ open: [], close: ['q1'], reveal: [] })
  })
})

describe('host steps', () => {
  it('opens one question when Next is tapped twice', () => {
    const party = startQuiz()
    expect(host(party, { type: 'next', from: -1 }).kind).toBe('commit')
    expect(host(party, { type: 'next', from: -1 }).kind).toBe('skip')
    expect(party.promptsOf(GAME).map((p) => p.key)).toEqual(['q1'])
    expect(state(party).index).toBe(0)
  })

  it('scores once when Reveal now races the timer, either way round, with no error', () => {
    // Reveal now first: the timer then finds nothing due.
    const first = startQuiz(2)
    host(first, { type: 'next', from: -1 })
    answer(first, 0, 1, 1000)
    first.tick(9000)
    expect(revealNow(first).kind).toBe('commit')
    first.now = state(first).endsAt! + GRACE_MS + WAKE_MARGIN_MS
    expect(first.sync(GAME).kind).toBe('skip')
    expect(state(first).results).toHaveLength(1)
    expect(state(first).quizPoints[idOf(first, 0)]).toBe(speedPoints(1000, 10))

    // The timer first: the late Reveal now is skipped.
    const second = startQuiz(2)
    host(second, { type: 'next', from: -1 })
    answer(second, 0, 1, 1000)
    expect(timerReveal(second).kind).toBe('commit')
    expect(host(second, { type: 'reveal', index: 0 }, ['q1']).kind).toBe('skip')
    expect(state(second).results).toHaveLength(1)
    expect(state(second).quizPoints[idOf(second, 0)]).toBe(speedPoints(1000, 10))
  })

  it('skips a stale Show the leaderboard', () => {
    const party = startQuiz()
    host(party, { type: 'next', from: -1 })
    timerReveal(party)
    party.tick(REVEAL_HOLD_MS)
    expect(party.sync(GAME).kind).toBe('commit')
    expect(state(party).phase).toBe('leaderboard')
    expect(host(party, { type: 'leaderboard', index: 0 }).kind).toBe('skip')
    // While a reveal shows, the host's Show the leaderboard works.
    host(party, { type: 'next', from: 0 })
    revealNow(party)
    expect(host(party, { type: 'leaderboard', index: 1 }).kind).toBe('commit')
    expect(state(party).phase).toBe('leaderboard')
    expect(party.game(GAME).wakeAt).toBeNull()
  })

  it('refuses the steps that make no sense, in words for the host', () => {
    const party = startQuiz()
    host(party, { type: 'next', from: -1 })
    expect(host(party, { type: 'next', from: 0 })).toMatchObject({ kind: 'refuse', code: 'rule', message: 'Reveal this question first' })
    expect(host(party, { type: 'finish' })).toMatchObject({ kind: 'refuse', code: 'rule', message: 'Reveal this question first' })
    // Reveal now without closing the question first can't see its answers.
    expect(host(party, { type: 'reveal', index: 0 })).toMatchObject({ kind: 'refuse', code: 'rule', message: 'The question is still open' })
    expect(host(party, { type: 'nope' } as unknown as QuizHostAction)).toMatchObject({ kind: 'refuse', code: 'rule' })
  })

  it('lets the host skip the leaderboard, and stops after the last question', () => {
    const party = startQuiz(2, { ...CONFIG, questions: QUESTIONS.slice(0, 2) })
    host(party, { type: 'next', from: -1 })
    revealNow(party)
    // Next from the reveal goes straight to the next question.
    expect(host(party, { type: 'next', from: 0 }).kind).toBe('commit')
    revealNow(party)
    expect(host(party, { type: 'next', from: 1 })).toMatchObject({
      kind: 'refuse',
      message: 'That was the last question. Crown the winner.',
    })
    expect(state(party).phase).toBe('reveal')
  })

  it('takes answers from guests who join mid-quiz', () => {
    const party = startQuiz(2)
    host(party, { type: 'next', from: -1 })
    const late = party.addPlayer('Late Lars')
    party.sync(GAME)
    expect(party.game(GAME).views[late.id]).toEqual({ quizPoints: 0, rank: null, right: 0, last: null })
    party.submit(GAME, 'q1', late.id, { choice: ['1'] }, 4000)
    revealNow(party)
    expect(party.game(GAME).views[late.id]).toMatchObject({ quizPoints: speedPoints(4000, 10), rank: 1, right: 1 })
  })
})

describe('a burst of answers', () => {
  it('takes 45 answers at once and reveals them all in one save', () => {
    const party = startQuiz(45)
    host(party, { type: 'next', from: -1 })
    party.players.forEach((player, i) => party.submit(GAME, 'q1', player.id, { choice: [String(i % 4)] }, 200 * i))
    expect(party.talliesOf(GAME)).toEqual({ q1: 45 })

    const before = party.pings.length
    expect(revealNow(party).kind).toBe('commit')
    // One room ping for the close in game_load, one for the reveal: never one per phone.
    expect(party.pings.slice(before)).toEqual(['room', 'room'])
    expect(pub(party).reveal).toMatchObject({ counts: [12, 11, 11, 11], answered: 45, rightCount: 11 })
    const views = Object.values(party.game(GAME).views) as QuizPlayerView[]
    expect(views).toHaveLength(45)
    expect(views.every((view) => view.last?.index === 0)).toBe(true)
    expect(views.filter((view) => (view.last?.points ?? 0) > 0)).toHaveLength(11)
    expect(pub(party).leaderboard).toHaveLength(10)
    expect(pub(party).leaderboard[0]).toEqual({ playerId: idOf(party, 1), points: 990, gained: 990, rank: 1 })
    expect(party.log.filter((row) => row.kind === 'prompt.answered')).toHaveLength(45)
  })
})

describe('finishing', () => {
  /** Two questions: player 0 gets both right, player 1 the first; the leaderboard shows. */
  function playTwo(players = 3) {
    const party = startQuiz(players, { ...CONFIG, questions: QUESTIONS.slice(0, 2) })
    host(party, { type: 'next', from: -1 })
    answer(party, 0, 1, 1000)
    answer(party, 1, 1, 2000)
    revealNow(party)
    host(party, { type: 'next', from: 0 })
    answer(party, 0, 1, 1000)
    answer(party, 1, 0, 1000)
    revealNow(party)
    host(party, { type: 'leaderboard', index: 1 })
    return party
  }

  it('crowns the top of the quiz points: the room, the winner, the badge, a finish by the game', () => {
    const party = playTwo()
    const winner = party.players[0]
    expect(state(party).quizPoints[winner.id]).toBe(1925)
    expect(host(party, { type: 'finish' }).kind).toBe('commit')

    expect(party.game(GAME)).toMatchObject({ status: 'finished', finishedBy: 'game', winners: [winner.id], wakeAt: null })
    expect(state(party).phase).toBe('done')
    expect(party.feed.map((f) => [f.message, f.detail, f.audience, f.sound, f.interrupt])).toEqual([
      [`${winner.name} wins the quiz!`, '1,925 quiz points', null, 'fanfare', true],
      ['You won the quiz!', '1,925 quiz points', [winner.id], 'fanfare', false],
    ])
    expect(party.players[0].profile.quiz).toEqual({ wins: 1 })
    expect(pub(party)).toMatchObject({ phase: 'done', question: null, reveal: null })
    // A finished quiz refuses further steps.
    expect(host(party, { type: 'finish' })).toMatchObject({ kind: 'refuse', code: 'not_running' })
  })

  it('crowns everyone tied at the top', () => {
    const party = startQuiz(3, { ...CONFIG, questions: QUESTIONS.slice(0, 1) })
    host(party, { type: 'next', from: -1 })
    answer(party, 0, 1, 1000)
    answer(party, 2, 1, 1000)
    revealNow(party)
    host(party, { type: 'finish' })
    const [a, , c] = party.players
    expect(party.game(GAME).winners).toEqual([a.id, c.id])
    expect(party.feed[0]).toMatchObject({ message: `${a.name} and ${c.name} win the quiz!`, detail: 'A tie at 950 quiz points' })
    expect(party.feed[1].audience).toEqual([a.id, c.id])
  })

  it('crowns nobody when nobody scored', () => {
    const party = startQuiz(3)
    host(party, { type: 'next', from: -1 })
    answer(party, 0, 0, 1000)
    revealNow(party)
    host(party, { type: 'finish' })
    expect(party.game(GAME)).toMatchObject({ status: 'finished', finishedBy: 'game', winners: [] })
    expect(party.feed.map((f) => [f.message, f.detail])).toEqual([['The quiz is over', 'Nobody scored this time']])

    // From the lobby too.
    const lobby = startQuiz(2)
    expect(host(lobby, { type: 'finish' }).kind).toBe('commit')
    expect(lobby.game(GAME)).toMatchObject({ status: 'finished', winners: [] })
  })

  it('shows how it stood when the host ends it mid-question, leaving the open question unscored', () => {
    const party = startQuiz(3, { ...CONFIG, questions: QUESTIONS.slice(0, 3) })
    host(party, { type: 'next', from: -1 })
    answer(party, 1, 1, 500)
    revealNow(party)
    host(party, { type: 'next', from: 0 })
    answer(party, 0, 1, 100) // right, but never revealed
    expect(party.send(party.hostUser, { type: 'end', gameId: GAME }).kind).toBe('commit')

    const leader = party.players[1]
    expect(party.game(GAME)).toMatchObject({ status: 'finished', finishedBy: 'host', winners: [leader.id] })
    expect(state(party).phase).toBe('done')
    expect(state(party).results).toHaveLength(1)
    expect(state(party).quizPoints).toEqual({ [leader.id]: 975 })
    expect(party.feed[0]).toMatchObject({ message: 'The quiz is over', detail: `${leader.name} won with 975 quiz points`, interrupt: true })
    expect(party.feed[1]).toMatchObject({ message: 'You won the quiz!', audience: [leader.id] })
    expect(leader.profile.quiz).toEqual({ wins: 1 })
    expect(party.promptsOf(GAME).every((p) => p.closedAt !== null)).toBe(true)
    expect(party.promptsOf(GAME).find((p) => p.key === 'q2')?.revealedAt).toBeNull()
    expect(pub(party).question).toBeNull()
  })

  it('never crowns or ranks a guest who left', () => {
    const party = playTwo(3)
    const [top, second] = party.players
    party.removePlayer(top.id)
    party.sync(GAME)
    expect(pub(party).leaderboard.map((row) => row.playerId)).toEqual([second.id])
    host(party, { type: 'finish' })
    expect(party.game(GAME).winners).toEqual([second.id])
    expect(party.feed[0].message).toBe(`${second.name} wins the quiz!`)
  })
})

describe('recap', () => {
  it('names no question the host never got to, nor the answer of one left open', () => {
    const party = startQuiz(4)
    for (let i = 0; i < 3; i++) {
      host(party, { type: 'next', from: i - 1 })
      answer(party, 0, QUESTIONS[i].correct, 1000 + i)
      answer(party, 1, (QUESTIONS[i].correct + 1) % QUESTIONS[i].options.length, 1500)
      revealNow(party)
    }
    host(party, { type: 'next', from: 2 })
    answer(party, 2, QUESTIONS[3].correct, 900)
    party.send(party.hostUser, { type: 'end', gameId: GAME })

    const [round] = recapOf(party)
    expect(round.finished).toBe(true)
    const highlights = quiz.recap!(round)
    const text = JSON.stringify(highlights)
    for (const unasked of QUESTIONS.slice(3)) {
      expect(text).not.toContain(unasked.text)
      expect(text).not.toContain(unasked.options[unasked.correct])
    }
    const [winner] = party.players
    expect(highlights.map((h) => h.title)).toEqual([
      `${winner.name} won the quiz`,
      `Fastest right answer: ${winner.name}`,
      `Hardest question: “${QUESTIONS[0].text}”`,
      `Perfect score: ${winner.name}`,
    ])
    expect(highlights[0]).toMatchObject({ detail: '2,875 quiz points', weight: 'headline', players: [winner.id] })
    expect(highlights[1]).toMatchObject({ detail: '1.0 s on question 1', players: [winner.id] })
    expect(highlights[1].at).toBeTypeOf('number')
    expect(highlights[2].detail).toBe('1 of 2 knew “Denmark”')
    expect(highlights[3].detail).toBe('Every one of the 3 questions right')
  })

  it('says nothing about a round still running, or a quiz nobody played', () => {
    const party = startQuiz(2)
    host(party, { type: 'next', from: -1 })
    answer(party, 0, 1, 1000)
    revealNow(party)
    const [running] = recapOf(party)
    expect(running.finished).toBe(false)
    expect(quiz.recap!(running)).toEqual([])

    const empty = startQuiz(2)
    host(empty, { type: 'finish' })
    expect(quiz.recap!(recapOf(empty)[0])).toEqual([])
  })

  it('logs each reveal for the night’s story', () => {
    const party = startQuiz(3)
    host(party, { type: 'next', from: -1 })
    answer(party, 2, 1, 700)
    answer(party, 0, 1, 900)
    revealNow(party)
    expect(party.log.find((row) => row.kind === 'game.record')).toMatchObject({
      about: [idOf(party, 2)],
      data: { type: 'revealed', index: 0, key: 'q1', answered: 2, right: 2, fastest: { player_id: idOf(party, 2), ms: 700 } },
    })
  })
})

describe('contract', () => {
  it('keeps the game contract through a quiz with a join, a leave, the timers and End', () => {
    const problems = checkGameContract(quiz, {
      config: { ...CONFIG, questions: QUESTIONS.slice(0, 3) },
      players: 4,
      steps: [
        { kind: 'host', action: { type: 'next', from: -1 } },
        { kind: 'answer', player: 0, key: 'q1', answer: { choice: ['1'] }, afterMs: 800 },
        { kind: 'answer', player: 1, key: 'q1', answer: { choice: ['0'] }, afterMs: 1200 },
        { kind: 'join' },
        { kind: 'answer', player: 4, key: 'q1', answer: { choice: ['1'] }, afterMs: 3000 },
        { kind: 'tick', ms: 10_000 + GRACE_MS + WAKE_MARGIN_MS },
        { kind: 'sync' },
        { kind: 'tick', ms: REVEAL_HOLD_MS },
        { kind: 'sync' },
        { kind: 'host', action: { type: 'next', from: 0 } },
        { kind: 'answer', player: 2, key: 'q2', answer: { choice: ['1'] }, afterMs: 500 },
        { kind: 'leave', player: 2 },
        { kind: 'host', action: { type: 'reveal', index: 1 }, close: ['q2'] },
        { kind: 'host', action: { type: 'reveal', index: 1 }, close: ['q2'] },
        { kind: 'host', action: { type: 'leaderboard', index: 1 } },
        { kind: 'host', action: { type: 'next', from: 1 } },
        { kind: 'answer', player: 3, key: 'q3', answer: { choice: ['0'] }, afterMs: 100 },
        { kind: 'end' },
      ],
    })
    expect(problems).toEqual([])
  })

  it('refuses moves from phones and garbage host steps', () => {
    // As the engine calls it: with whatever a phone sent.
    const engineView: AnyGame = quiz as unknown as AnyGame
    for (const input of [null, {}, { type: 'answer', choice: 1 }]) expect(() => engineView.parseAction(input)).toThrow(GameError)
    for (const input of [
      { type: 'next' },
      { type: 'next', from: -2 },
      { type: 'next', from: 0.5 },
      { type: 'reveal', index: '1' },
      { type: 'leaderboard', index: -1 },
      { type: 'restart' },
      [],
    ]) {
      expect(() => quiz.parseHostAction!(input)).toThrow(GameError)
    }
    expect(quiz.parseHostAction!({ type: 'next', from: -1, extra: true })).toEqual({ type: 'next', from: -1 })
    expect(quiz.parseHostAction!({ type: 'finish' })).toEqual({ type: 'finish' })
  })
})

describe('words', () => {
  it('formats numbers and names the same everywhere', () => {
    expect([0, 950, 2350, 1_000_000, -1200].map(formatNumber)).toEqual(['0', '950', '2,350', '1,000,000', '-1,200'])
    expect(joinNames([])).toBe('')
    expect(joinNames(['Ana'])).toBe('Ana')
    expect(joinNames(['Ana', 'Bo'])).toBe('Ana and Bo')
    expect(joinNames(['Ana', 'Bo', 'Cy'])).toBe('Ana, Bo and Cy')
  })
})
