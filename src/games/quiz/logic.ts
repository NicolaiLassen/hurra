// The live quiz (docs/engine-v2.md, 8.3): the host runs questions on the TV,
// everyone answers on their phone, right answers score more the faster they
// came, a leaderboard follows each question, and the host crowns the winner.
//
// Answers never reach this code one by one. Each question is a prompt that
// phones answer straight to the database (submit_answer); the reveal (a host
// action, or the timer) gets every final answer at once in ctx.answers and
// turns them into points. The right answer lives only in the host-only
// settings and in the state: never in publicState, a player view or a prompt
// spec before its reveal.
//
// Bundled into the Netlify function: relative imports only, no React, no
// browser globals, time only from ctx.now.
import {
  Game,
  GameError,
  type Answer,
  type AnswerPayload,
  type GameContext,
  type GameInfo,
  type GamePlayer,
  type Highlight,
  type PlayerId,
  type RecapRound,
  type Scores,
} from '../core/Game'

export type QuizQuestion = { text: string; options: string[]; correct: number; seconds?: number }
export type QuizConfig = { questions: QuizQuestion[]; seconds: number; pointsPerRight: number }

export type QuizPhase = 'lobby' | 'question' | 'reveal' | 'leaderboard' | 'done'

/** One revealed question: the right option, how many picked each, and every answer with its points. */
export type QuizResult = {
  index: number
  correct: number
  counts: number[]
  answers: Record<PlayerId, { choice: number; ms: number; points: number }>
}

export type QuizState = {
  phase: QuizPhase
  /** The question asked last, from 0; -1 before the first one. */
  index: number
  openedAt: number | null
  /** What screens count down to. Answers are taken until GRACE_MS after it. */
  endsAt: number | null
  revealedAt: number | null
  /** Revealed questions only, in order. */
  results: QuizResult[]
  /** The quiz's own ranking: 500 to 1,000 per right answer, by speed. */
  quizPoints: Record<PlayerId, number>
  /** Right answers per player: the day's scoreboard gets these times pointsPerRight. */
  right: Record<PlayerId, number>
}

/**
 * Host steps. Each names the step the host page showed (3.5): `from` is the
 * index it showed for Next (-1 in the lobby), `index` the question it showed.
 * One whose step has passed changes nothing, which the engine answers as
 * skipped, so a double tap or a race with the timer does nothing.
 */
export type QuizHostAction =
  | { type: 'next'; from: number }
  | { type: 'reveal'; index: number }
  | { type: 'leaderboard'; index: number }
  | { type: 'finish' }

export type QuizLeaderboardRow = { playerId: PlayerId; points: number; gained: number; rank: number }

export type QuizPublicState = {
  phase: QuizPhase
  index: number
  total: number
  /** The question asked, never its answer. Null in the lobby and once done. */
  question: { key: string; text: string; options: string[]; endsAt: number } | null
  /** The last question's answer and counts, during its reveal and the leaderboard after it. */
  reveal: {
    correct: number
    counts: number[]
    answered: number
    rightCount: number
    fastest: { playerId: PlayerId; ms: number }[]
  } | null
  /** The top 10 by quiz points; `gained` is what the last question added while it shows. */
  leaderboard: QuizLeaderboardRow[]
}

export type QuizPlayerView = {
  quizPoints: number
  /** Competition rank by quiz points (1, 2, 2, 4); null until you score. */
  rank: number | null
  right: number
  /** The last revealed question: your pick (null for none), the right option and your points. */
  last: { index: number; choice: number | null; correct: number; points: number } | null
}

/** Lasting achievements across rounds, shown as badges. */
export type QuizProfile = { wins?: number }

/** Answers are taken this long past the countdown, for taps still on their way. */
export const GRACE_MS = 1000
/** The reveal shows this long before the leaderboard follows by itself. */
export const REVEAL_HOLD_MS = 7000
/** A right answer at once; half of it for one at the last moment. */
export const MAX_QUIZ_POINTS = 1000
/**
 * The timer reveals this long after a question's deadline. game_load closes
 * due prompts with an earlier clock reading than the `now` it reports (and
 * rounds that to the millisecond), so a sync landing exactly on the deadline
 * could otherwise find the question still open and its answers missing.
 */
export const WAKE_MARGIN_MS = 250

export const MAX_QUESTIONS = 50
export const MAX_TEXT_LENGTH = 200
export const MAX_OPTION_LENGTH = 80
export const MIN_OPTIONS = 2
export const MAX_OPTIONS = 4
export const MIN_SECONDS = 5
export const MAX_SECONDS = 60
export const MAX_POINTS_PER_RIGHT = 10
/** How many players the public leaderboard holds. */
export const LEADERBOARD_SIZE = 10

/** Question i (from 0) is prompt q1, q2, ... */
export const promptKey = (index: number) => `q${index + 1}`

/** The seconds a question runs: its own, or the quiz's default. */
export const secondsOf = (question: Pick<QuizQuestion, 'seconds'>, config: Pick<QuizConfig, 'seconds'>) =>
  question.seconds ?? config.seconds

/** Quiz points for a right answer that came `ms` after the question opened: 1,000 at once, down to 500 at the end. */
export function speedPoints(ms: number, seconds: number): number {
  const window = Math.max(1, seconds * 1000)
  return Math.round(MAX_QUIZ_POINTS * (1 - Math.min(1, Math.max(0, ms) / window) / 2))
}

/** 2350 as "2,350". The same on every runtime (no locale data). */
export function formatNumber(value: number): string {
  const digits = String(Math.abs(Math.round(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return value < 0 ? `-${digits}` : digits
}

/** "Ana", "Ana and Bo", "Ana, Bo and Cy". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** 1234 ms as "1.2 s". */
export const formatSeconds = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(1)} s`

/** The ranking by quiz points: present players who scored, highest first, ties in join order, with competition ranks. */
export function rankPlayers(
  points: Readonly<Record<PlayerId, number>>,
  players: readonly Pick<GamePlayer, 'id'>[],
): { playerId: PlayerId; points: number; rank: number }[] {
  const rows = players
    .map((p, order) => ({ playerId: p.id, points: points[p.id] ?? 0, order }))
    .filter((row) => row.points > 0)
    .sort((a, b) => b.points - a.points || a.order - b.order)
  let rank = 0
  return rows.map((row, i) => {
    if (i === 0 || rows[i - 1].points !== row.points) rank = i + 1
    return { playerId: row.playerId, points: row.points, rank }
  })
}

/**
 * The settings, cleaned, with every problem in them, in the order a host
 * would fix them. parseConfig refuses the first; the settings editor shows
 * them all as you type.
 */
export function checkQuizConfig(input: Record<string, unknown>): { config: QuizConfig; problems: string[] } {
  const problems: string[] = []
  const raw = Array.isArray(input.questions) ? input.questions : []
  if (raw.length === 0) problems.push('Add at least one question in the settings')
  else if (raw.length > MAX_QUESTIONS) problems.push(`A quiz holds up to ${MAX_QUESTIONS} questions`)
  const questions = raw.slice(0, MAX_QUESTIONS).map((question, i) => {
    const checked = checkQuestion(question, i + 1)
    problems.push(...checked.problems)
    return checked.question
  })

  const seconds = whole(input.seconds)
  if (seconds === null || seconds < MIN_SECONDS || seconds > MAX_SECONDS) {
    problems.push(`The time per question must be ${MIN_SECONDS} to ${MAX_SECONDS} seconds`)
  }
  const pointsPerRight = whole(input.pointsPerRight)
  if (pointsPerRight === null || pointsPerRight < 0 || pointsPerRight > MAX_POINTS_PER_RIGHT) {
    problems.push(`Points per right answer must be a whole number from 0 to ${MAX_POINTS_PER_RIGHT}`)
  }
  return { config: { questions, seconds: seconds ?? 20, pointsPerRight: pointsPerRight ?? 1 }, problems }
}

/** One question, cleaned (texts trimmed), with its problems. `n` counts from 1. */
export function checkQuestion(input: unknown, n: number): { question: QuizQuestion; problems: string[] } {
  const problems: string[] = []
  const q = (input !== null && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>

  const text = typeof q.text === 'string' ? q.text.trim() : ''
  if (!text) problems.push(`Question ${n} needs a question`)
  else if (length(text) > MAX_TEXT_LENGTH) problems.push(`Question ${n} is longer than ${MAX_TEXT_LENGTH} characters`)

  const options = Array.isArray(q.options)
    ? q.options.map((option) => (typeof option === 'string' ? option.trim() : typeof option === 'number' ? String(option) : ''))
    : []
  if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
    problems.push(`Question ${n} needs ${MIN_OPTIONS} to ${MAX_OPTIONS} options`)
  } else if (options.some((option) => !option)) {
    problems.push(`Question ${n} has an empty option`)
  } else if (options.some((option) => length(option) > MAX_OPTION_LENGTH)) {
    problems.push(`Question ${n} has an option longer than ${MAX_OPTION_LENGTH} characters`)
  } else if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) {
    problems.push(`Question ${n} has the same option twice`)
  }

  const correct = whole(q.correct)
  if (correct === null || correct < 0 || correct >= Math.max(options.length, 1)) {
    problems.push(`Pick the right answer for question ${n}`)
  }

  const unset = q.seconds === undefined || q.seconds === null || q.seconds === ''
  const seconds = unset ? undefined : whole(q.seconds)
  if (seconds === null || (seconds !== undefined && (seconds < MIN_SECONDS || seconds > MAX_SECONDS))) {
    problems.push(`Question ${n} needs a time of ${MIN_SECONDS} to ${MAX_SECONDS} seconds`)
  }

  return {
    question: { text, options, correct: correct ?? 0, ...(typeof seconds === 'number' ? { seconds } : {}) },
    problems,
  }
}

/**
 * Questions on the TV, answers on the phones. The host taps Next; the timer
 * reveals each question (or the host taps Reveal now), the leaderboard follows
 * by itself, and the host crowns the winner after the last question.
 */
export class QuizGame extends Game<QuizState, never, QuizPublicState, QuizPlayerView, QuizConfig, QuizHostAction> {
  readonly type = 'quiz'
  readonly presentation = 'stage'
  readonly defaultConfig: QuizConfig = { questions: [], seconds: 20, pointsPerRight: 1 }

  parseConfig(input: Record<string, unknown>): QuizConfig {
    const { config, problems } = checkQuizConfig(input)
    if (problems.length > 0) throw new GameError(problems[0])
    return config
  }

  setup(): QuizState {
    // No title card or announcement of its own: the TV's "Hurra presents" card opens the game.
    return { phase: 'lobby', index: -1, openedAt: null, endsAt: null, revealedAt: null, results: [], quizPoints: {}, right: {} }
  }

  parseAction(): never {
    throw new GameError('The quiz takes answers, not moves')
  }

  handleAction(state: QuizState): QuizState {
    return state
  }

  parseHostAction(input: unknown): QuizHostAction {
    const action = (input !== null && typeof input === 'object' ? input : {}) as Record<string, unknown>
    const step = (value: unknown, min: number): value is number =>
      typeof value === 'number' && Number.isInteger(value) && value >= min && value < MAX_QUESTIONS
    switch (action.type) {
      case 'next':
        if (step(action.from, -1)) return { type: 'next', from: action.from }
        break
      case 'reveal':
      case 'leaderboard':
        if (step(action.index, 0)) return { type: action.type, index: action.index }
        break
      case 'finish':
        return { type: 'finish' }
    }
    throw new GameError('Unknown quiz step')
  }

  handleHostAction(state: QuizState, action: QuizHostAction, ctx: GameContext<QuizConfig>): QuizState {
    switch (action.type) {
      case 'next': {
        if (action.from !== state.index || state.phase === 'done') return state
        if (state.phase === 'question') throw new GameError('Reveal this question first')
        const index = state.index + 1
        const question = ctx.config.questions[index]
        if (!question) throw new GameError('That was the last question. Crown the winner.')
        const endsAt = ctx.now + secondsOf(question, ctx.config) * 1000
        ctx.openPrompt(
          promptKey(index),
          // The options as their numbers, never the texts or which is right: prompt specs are public.
          { kind: 'choice', options: question.options.map((_, i) => String(i)), final: true },
          { closesAt: endsAt + GRACE_MS },
        )
        return { ...state, phase: 'question', index, openedAt: ctx.now, endsAt, revealedAt: null }
      }
      case 'reveal':
        // The timer may have revealed it already.
        if (state.phase !== 'question' || action.index !== state.index) return state
        return this.reveal(state, ctx)
      case 'leaderboard':
        // The timer may have moved on already.
        if (state.phase !== 'reveal' || action.index !== state.index) return state
        return { ...state, phase: 'leaderboard' }
      case 'finish':
        if (state.phase === 'done') return state
        if (state.phase === 'question') throw new GameError('Reveal this question first')
        this.crown(state, ctx, 'finish')
        return { ...state, phase: 'done' }
    }
  }

  wakeAt(state: QuizState): number | null {
    if (state.phase === 'question' && state.endsAt !== null) return state.endsAt + GRACE_MS + WAKE_MARGIN_MS
    if (state.phase === 'reveal' && state.revealedAt !== null) return state.revealedAt + REVEAL_HOLD_MS
    return null
  }

  /** Time's up reveals the question; a reveal moves on to the leaderboard. So the host only taps Next, and Crown at the end. */
  onWake(state: QuizState, ctx: GameContext<QuizConfig>): QuizState {
    if (state.phase === 'question') {
      const key = promptKey(state.index)
      if (ctx.answers[key]) return this.reveal(state, ctx)
      // The database hasn't closed it yet, which WAKE_MARGIN_MS rules out. Never
      // score a question without its answers: close it and wait for Reveal now.
      if (key in ctx.prompts && ctx.prompts[key].closedAt === null) ctx.closePrompt(key)
      return state
    }
    if (state.phase === 'reveal') return { ...state, phase: 'leaderboard' }
    return state
  }

  isFinished(state: QuizState): boolean {
    return state.phase === 'done'
  }

  winners(state: QuizState, info: GameInfo<QuizConfig>): PlayerId[] {
    return topPlayers(state, info.players)
  }

  onEnd(state: QuizState, ctx: GameContext<QuizConfig>, by: 'game' | 'host'): QuizState {
    // Crown the winner already announced the result.
    if (by === 'game') return state
    this.crown(state, ctx, 'end')
    return { ...state, phase: 'done' }
  }

  /**
   * Someone left the party (removed, or the host freed their name): their
   * totals and answers go, so a guest who takes a freed name starts at 0
   * (docs/guest-list.md, 9.4). The counts per option stay as the room saw them.
   */
  onPlayerLeave(state: QuizState, playerId: PlayerId): QuizState {
    const answered = state.results.some((r) => Object.hasOwn(r.answers, playerId))
    if (!Object.hasOwn(state.right, playerId) && !Object.hasOwn(state.quizPoints, playerId) && !answered) return state
    const without = <T>(record: Record<PlayerId, T>): Record<PlayerId, T> =>
      Object.fromEntries(Object.entries(record).filter(([id]) => id !== playerId))
    return {
      ...state,
      right: without(state.right),
      quizPoints: without(state.quizPoints),
      results: state.results.map((r) => (Object.hasOwn(r.answers, playerId) ? { ...r, answers: without(r.answers) } : r)),
    }
  }

  scores(state: QuizState, info: GameInfo<QuizConfig>): Scores {
    const scores: Scores = {}
    for (const [playerId, right] of Object.entries(state.right)) {
      const points = right * info.config.pointsPerRight
      if (points !== 0) scores[playerId] = points
    }
    return scores
  }

  publicState(state: QuizState, info: GameInfo<QuizConfig>): QuizPublicState {
    const { questions } = info.config
    const question = state.index >= 0 ? questions[state.index] : undefined
    const asking = question !== undefined && state.phase !== 'lobby' && state.phase !== 'done'
    const last = state.results.at(-1)
    const revealed = last !== undefined && last.index === state.index && (state.phase === 'reveal' || state.phase === 'leaderboard')

    return {
      phase: state.phase,
      index: state.index,
      total: questions.length,
      question: asking
        ? { key: promptKey(state.index), text: question.text, options: [...question.options], endsAt: state.endsAt ?? 0 }
        : null,
      reveal: revealed
        ? {
            correct: last.correct,
            counts: [...last.counts],
            answered: last.counts.reduce((sum, n) => sum + n, 0),
            rightCount: last.counts[last.correct] ?? 0,
            fastest: fastestRight(last, info.players).slice(0, 3),
          }
        : null,
      leaderboard: rankPlayers(state.quizPoints, info.players)
        .slice(0, LEADERBOARD_SIZE)
        .map((row) => ({ ...row, gained: revealed ? (last.answers[row.playerId]?.points ?? 0) : 0 })),
    }
  }

  playerView(state: QuizState, playerId: PlayerId, info: GameInfo<QuizConfig>): QuizPlayerView {
    const last = state.results.at(-1)
    const mine = last && Object.hasOwn(last.answers, playerId) ? last.answers[playerId] : undefined
    return {
      quizPoints: state.quizPoints[playerId] ?? 0,
      rank: rankPlayers(state.quizPoints, info.players).find((row) => row.playerId === playerId)?.rank ?? null,
      right: state.right[playerId] ?? 0,
      last: last ? { index: last.index, choice: mine?.choice ?? null, correct: last.correct, points: mine?.points ?? 0 } : null,
    }
  }

  /**
   * The finished round's highlights, from revealed questions only: a question
   * the host never got to stays secret, as a later round may still ask it.
   */
  recap(round: RecapRound<QuizState, QuizConfig>): Highlight[] {
    if (!round.finished || !round.state) return []
    const questions = round.config?.questions ?? []
    // Saved states are plain JSON: skip anything that isn't a revealed question of these settings.
    const results = (Array.isArray(round.state.results) ? round.state.results : []).filter(
      (r) => r && Array.isArray(r.counts) && r.answers && typeof r.answers === 'object' && questions[r.index] !== undefined,
    )
    const nameOf = (id: PlayerId) => round.players.find((p) => p.id === id)?.name ?? 'A guest'
    const revealedAt = (index: number) =>
      round.log.find((row) => row.kind === 'game.record' && row.data.type === 'revealed' && row.data.index === index)?.at
    const highlights: Highlight[] = []

    const winners = [...round.winners]
    if (winners.length > 0) {
      const points = round.state.quizPoints?.[winners[0]] ?? 0
      highlights.push({
        title: `${joinNames(winners.map(nameOf))} won the quiz`,
        detail: `${formatNumber(points)} quiz points`,
        players: winners,
        ...(round.finishedAt !== null ? { at: round.finishedAt } : {}),
        icon: 'crown',
        tone: 'gold',
        weight: 'headline',
      })
    }

    let fastest: { playerId: PlayerId; ms: number; index: number } | null = null
    for (const result of results) {
      for (const answer of rightAnswers(result)) {
        if (!fastest || answer.ms < fastest.ms) fastest = { ...answer, index: result.index }
      }
    }
    if (fastest) {
      const at = revealedAt(fastest.index)
      highlights.push({
        title: `Fastest right answer: ${nameOf(fastest.playerId)}`,
        detail: `${formatSeconds(fastest.ms)} on question ${fastest.index + 1}`,
        players: [fastest.playerId],
        ...(at !== undefined ? { at } : {}),
        icon: 'lightning',
        tone: 'teal',
        weight: 'highlight',
      })
    }

    // The hardest: the lowest share of right answers, among questions someone got wrong.
    const answered = (r: QuizResult) => r.counts.reduce((sum, n) => sum + n, 0)
    const hardest = results
      .filter((r) => answered(r) > 0 && (r.counts[r.correct] ?? 0) < answered(r))
      .sort((a, b) => (a.counts[a.correct] ?? 0) / answered(a) - (b.counts[b.correct] ?? 0) / answered(b) || a.index - b.index)[0]
    if (hardest && results.length >= 2) {
      const question = questions[hardest.index]
      const at = revealedAt(hardest.index)
      highlights.push({
        title: `Hardest question: “${question.text}”`,
        detail: `${hardest.counts[hardest.correct] ?? 0} of ${answered(hardest)} knew “${question.options[hardest.correct] ?? ''}”`,
        ...(at !== undefined ? { at } : {}),
        icon: 'target',
        tone: 'pink',
        weight: 'highlight',
      })
    }

    // Every asked question right; only worth a line after a few questions.
    if (results.length >= 3) {
      const perfect = round.players
        .map((p) => p.id)
        .filter((id) => results.every((r) => (r.answers[id]?.points ?? 0) > 0))
      if (perfect.length > 0) {
        highlights.push({
          title: perfect.length <= 3 ? `Perfect score: ${joinNames(perfect.map(nameOf))}` : `Perfect score for ${perfect.length} guests`,
          detail: `Every one of the ${results.length} questions right`,
          players: perfect,
          icon: 'star',
          tone: 'violet',
          weight: 'highlight',
        })
      }
    }
    return highlights
  }

  /** Scores the open question from its final answers and reveals it. */
  private reveal(state: QuizState, ctx: GameContext<QuizConfig>): QuizState {
    const key = promptKey(state.index)
    const answers = ctx.answers[key]
    if (!answers) throw new GameError('The question is still open')
    const question = ctx.config.questions[state.index]
    if (!question) throw new GameError('This question is missing from the settings')

    const result = scoreQuestion(question, state.index, answers, secondsOf(question, ctx.config))
    const quizPoints = { ...state.quizPoints }
    const right = { ...state.right }
    for (const [playerId, answer] of Object.entries(result.answers)) {
      if (answer.points <= 0) continue
      quizPoints[playerId] = (quizPoints[playerId] ?? 0) + answer.points
      right[playerId] = (right[playerId] ?? 0) + 1
    }
    ctx.revealPrompt(key)

    // The night's story: how this question went, for the event log and the recap's timeline.
    const fastest = fastestRight(result, ctx.players)[0]
    ctx.record(
      'revealed',
      {
        index: state.index,
        key,
        answered: answers.length,
        right: result.counts[result.correct] ?? 0,
        fastest: fastest ? { player_id: fastest.playerId, ms: fastest.ms } : null,
      },
      { about: fastest ? [fastest.playerId] : [] },
    )
    return { ...state, phase: 'reveal', revealedAt: ctx.now, results: [...state.results, result], quizPoints, right }
  }

  /** Announces the winner (or that nobody scored) and gives them the badge. */
  private crown(state: QuizState, ctx: GameContext<QuizConfig>, how: 'finish' | 'end') {
    const winners = topPlayers(state, ctx.players)
    if (winners.length === 0) {
      ctx.announce('The quiz is over', { detail: 'Nobody scored this time', icon: 'trophy', tone: 'gold', sound: 'gong' })
      return
    }
    const names = joinNames(winners.map((id) => ctx.players.find((p) => p.id === id)?.name ?? 'Someone'))
    const points = `${formatNumber(state.quizPoints[winners[0]] ?? 0)} quiz points`
    const tie = winners.length > 1
    if (how === 'finish') {
      ctx.announce(`${names} ${tie ? 'win' : 'wins'} the quiz!`, {
        detail: tie ? `A tie at ${points}` : points,
        icon: 'crown',
        tone: 'gold',
        sound: 'fanfare',
        interrupt: true,
      })
    } else {
      ctx.announce('The quiz is over', {
        detail: `${names} won with ${points}`,
        icon: 'trophy',
        tone: 'gold',
        sound: 'fanfare',
        interrupt: true,
      })
    }
    ctx.announce('You won the quiz!', {
      detail: tie ? `A tie at ${points}` : points,
      to: winners,
      icon: 'crown',
      tone: 'gold',
      sound: 'fanfare',
    })
    for (const id of winners) {
      const profile = (ctx.players.find((p) => p.id === id)?.profile.quiz ?? {}) as QuizProfile
      ctx.updateProfile(id, { wins: (typeof profile.wins === 'number' ? profile.wins : 0) + 1 })
    }
  }
}

/** Everyone with the most quiz points who is still in the party, or nobody when that is 0. */
function topPlayers(state: QuizState, players: readonly Pick<GamePlayer, 'id'>[]): PlayerId[] {
  return rankPlayers(state.quizPoints, players)
    .filter((row) => row.rank === 1)
    .map((row) => row.playerId)
}

/** Each answer's pick and points; a right one earns 500 to 1,000 by speed. The first answer per player counts. */
function scoreQuestion(question: QuizQuestion, index: number, answers: readonly Answer[], seconds: number): QuizResult {
  const counts = question.options.map(() => 0)
  const scored: QuizResult['answers'] = {}
  for (const answer of answers) {
    const choice = choiceOf(answer.answer)
    if (choice === null || choice >= counts.length || Object.hasOwn(scored, answer.playerId)) continue
    counts[choice]++
    const ms = Math.max(0, Math.round(answer.ms))
    scored[answer.playerId] = { choice, ms, points: choice === question.correct ? speedPoints(ms, seconds) : 0 }
  }
  return { index, correct: question.correct, counts, answers: scored }
}

/** A question's right answers. In no particular order (jsonb reorders keys): sort before showing. */
function rightAnswers(result: QuizResult): { playerId: PlayerId; ms: number }[] {
  return Object.entries(result.answers)
    .filter(([, answer]) => answer.points > 0)
    .map(([playerId, answer]) => ({ playerId, ms: answer.ms }))
}

/** A question's right answers from players still in the party, fastest first, ties in join order: the TV's Fastest row and the reveal's record. */
function fastestRight(result: QuizResult, players: readonly Pick<GamePlayer, 'id'>[]): { playerId: PlayerId; ms: number }[] {
  const order = new Map(players.map((p, i) => [p.id, i]))
  return rightAnswers(result)
    .filter((a) => order.has(a.playerId))
    .sort((a, b) => a.ms - b.ms || (order.get(a.playerId) ?? 0) - (order.get(b.playerId) ?? 0))
}

/** The option an answer picked, or null for anything else. */
function choiceOf(answer: AnswerPayload): number | null {
  if (!('choice' in answer) || !Array.isArray(answer.choice) || answer.choice.length !== 1) return null
  const choice = Number(answer.choice[0])
  return Number.isInteger(choice) && choice >= 0 ? choice : null
}

/** A whole number, also from a numeric string (a settings form), else null. */
function whole(value: unknown): number | null {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof number === 'number' && Number.isInteger(number) ? number : null
}

/** Length in code points, as Postgres char_length counts. */
const length = (text: string) => Array.from(text).length
