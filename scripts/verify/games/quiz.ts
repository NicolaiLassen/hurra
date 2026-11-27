// The quiz's oracle: every right answer scores 1,000 at once down to 500 at
// the end of its countdown (the grace second included at 500), pointsPerRight
// per right answer on the day's scoreboard, the first answer counts, and the
// winner is the top of the quiz points among guests still here. Recomputed
// from the answers the database took and the prompts' reveals.
import { botSight, hostBotSight } from '../../../src/games/core/contract'
import type { AnswerPayload, PlayerId, Prompt } from '../../../src/games/core/Game'
import type { Step } from '../../../src/games/core/runtime'
import type { QuizConfig, QuizPlayerView, QuizPublicState, QuizState } from '../../../src/games/quiz/logic'
import { competitionRank, sameScores, sameSet, show, stringsIn, type Adapter, type HostStep, type Move, type Oracle, type Run } from '../core'

type Answered = { choice: number; at: number }

export const quiz: Adapter = {
  type: 'quiz',
  settings(run) {
    const { rng } = run
    const count = rng.between(1, run.size >= 24 ? 6 : 9)
    return {
      seconds: rng.between(5, 20),
      pointsPerRight: rng.chance(0.15) ? 0 : rng.between(1, 10),
      questions: Array.from({ length: count }, (_, i) => {
        const options = Array.from({ length: rng.between(2, 4) }, (_, k) => `Verifier option ${String.fromCharCode(65 + k)} of q${i + 1}`)
        return {
          text: `Verifier question ${i + 1} (seed ${run.seed})`,
          options,
          correct: rng.int(options.length),
          ...(rng.chance(0.3) ? { seconds: rng.between(5, 25) } : {}),
        }
      }),
    }
  },
  begin: (run) => new QuizOracle(run),
}

class QuizOracle implements Oracle {
  private readonly config: QuizConfig
  /** First answers per prompt key, by player (the prompt is final). */
  private readonly answers = new Map<string, Map<PlayerId, Answered>>()
  private readonly points = new Map<PlayerId, number>()
  private readonly right = new Map<PlayerId, number>()
  private readonly scored = new Set<string>()
  private readonly skill = new Map<PlayerId, number>()

  private readonly run: Run

  constructor(run: Run) {
    this.run = run
    this.config = run.config<QuizConfig>()
  }

  private skillOf(id: PlayerId) {
    if (!this.skill.has(id)) this.skill.set(id, this.run.rng.next() * 0.9)
    return this.skill.get(id)!
  }

  guest(playerId: PlayerId): Move | null {
    const { run } = this
    const pub = run.publicState<QuizPublicState>()
    // Now and then a tap lands in the grace second after the countdown, or a second tap on a question already answered.
    if (pub?.phase === 'question' && pub.question && run.rng.chance(0.01)) {
      return { kind: 'answer', key: pub.question.key, answer: { choice: [String(run.rng.int(pub.question.options.length))] }, note: 'a stray tap' }
    }
    const move = run.bot.move(botSight(run.party, run.gameId, playerId, run.rng.fn()))
    if (!move || move.kind !== 'answer') return move
    const index = Number(move.key.slice(1)) - 1
    const question = this.config.questions[index]
    if (question && run.rng.chance(this.skillOf(playerId))) {
      return { kind: 'answer', key: move.key, answer: { choice: [String(question.correct)] }, note: 'knows it' }
    }
    return move
  }

  host(): HostStep | null {
    const { run } = this
    const state = run.state<QuizState>()
    if (!state) return null
    if (run.rng.chance(0.75)) return run.bot.hostMove?.(hostBotSight(run.party, run.gameId, run.rng.fn())) ?? null
    const key = `q${state.index + 1}`
    const steps: HostStep[] = [
      { action: { type: 'next', from: state.index } },
      { action: { type: 'next', from: state.index - 1 }, note: 'stale' },
      { action: { type: 'reveal', index: state.index }, close: [key] },
      { action: { type: 'reveal', index: state.index }, note: 'without closing' },
      { action: { type: 'reveal', index: Math.max(0, state.index - 1) }, close: [key], note: 'maybe stale' },
      { action: { type: 'leaderboard', index: state.index } },
    ]
    if (run.rng.chance(0.03)) return { action: { type: 'finish' }, note: 'crown early' }
    return run.rng.pick(steps)
  }

  answered(playerId: PlayerId, key: string, answer: AnswerPayload) {
    const choice = 'choice' in answer ? Number(answer.choice[0]) : NaN
    const list = this.answers.get(key) ?? new Map<PlayerId, Answered>()
    this.answers.set(key, list)
    if (!list.has(playerId)) list.set(playerId, { choice, at: this.run.party.now })
  }

  dropped(playerId: PlayerId) {
    for (const list of this.answers.values()) list.delete(playerId)
    this.points.delete(playerId)
    this.right.delete(playerId)
  }

  after(_call: unknown, result: Step) {
    if (result.kind !== 'commit') return
    for (const prompt of this.run.prompts()) {
      if (prompt.revealedAt === null || this.scored.has(prompt.key)) continue
      this.scored.add(prompt.key)
      this.score(prompt)
    }
  }

  /** A question's reveal: speed points for every right first answer from a guest here. */
  private score(prompt: Prompt) {
    const { run } = this
    const index = Number(prompt.key.slice(1)) - 1
    const question = this.config.questions[index]
    if (!question) return run.fail('scores-match-oracle', `${prompt.key} was revealed but the settings have no such question`)
    const seconds = question.seconds ?? this.config.seconds
    run.count('questions revealed')
    const present = new Set(run.present().map((p) => p.id))
    const counts = question.options.map(() => 0)
    for (const [id, answer] of this.answers.get(prompt.key) ?? []) {
      if (!present.has(id)) continue
      counts[answer.choice]++
      if (answer.choice !== question.correct) continue
      const ms = Math.max(0, answer.at - prompt.openedAt)
      const window = Math.max(1, seconds * 1000)
      const points = Math.round(1000 * (1 - Math.min(1, ms / window) / 2))
      if (points < 500 || points > 1000) run.fail('payouts-within-limits', `a right answer earned ${points} quiz points`)
      this.points.set(id, (this.points.get(id) ?? 0) + points)
      this.right.set(id, (this.right.get(id) ?? 0) + 1)
      run.count('right answers scored')
    }
    const pub = run.publicState<QuizPublicState>()
    if (pub.reveal && pub.index === index && pub.reveal.counts.join() !== counts.join()) {
      run.fail('scores-match-oracle', `${prompt.key}'s reveal counts ${pub.reveal.counts.join('/')}, the answers give ${counts.join('/')}`)
    }
    if (pub.reveal && pub.reveal.correct !== question.correct) run.fail('scores-match-oracle', `${prompt.key} revealed the wrong option`)
  }

  check() {
    const { run } = this
    const present = run.present()
    const ppr = this.config.pointsPerRight
    const want: Record<PlayerId, number> = {}
    for (const p of present) if ((this.right.get(p.id) ?? 0) * ppr !== 0) want[p.id] = (this.right.get(p.id) ?? 0) * ppr
    const got = run.scores()
    if (!sameScores(got, want)) run.fail('scores-match-oracle', `scores are ${show(got, run.nameOf)}, the oracle has ${show(want, run.nameOf)}`)
    const revealed = this.scored.size
    for (const [id, points] of Object.entries(got)) {
      if (points < 0 || points > revealed * ppr || points % Math.max(1, ppr) !== 0) {
        run.fail('payouts-within-limits', `${run.nameOf(id)} has ${points} on the board from ${revealed} revealed questions at ${ppr} each`)
      }
    }

    const scoredPoints = present.map((p) => this.points.get(p.id) ?? 0).filter((x) => x > 0)
    const views = run.views()
    const pub = run.publicState<QuizPublicState>()
    for (const p of present) {
      const view = views[p.id] as QuizPlayerView | undefined
      if (!view) continue
      const points = this.points.get(p.id) ?? 0
      const rank = points > 0 ? competitionRank(points, scoredPoints) : null
      if (view.quizPoints !== points || view.right !== (this.right.get(p.id) ?? 0) || (run.fresh() && view.rank !== rank)) {
        run.fail(
          'scores-match-oracle',
          `${p.name}'s phone shows ${view.quizPoints} points, ${view.right} right, rank ${view.rank}; the oracle has ${points}, ${this.right.get(p.id) ?? 0}, ${rank}`,
        )
      }
      // Secret: the question being asked is never among a phone's results.
      if (pub?.phase === 'question' && view.last && view.last.index >= pub.index) {
        run.fail('secrets-kept', `${p.name}'s phone has the result of question ${view.last.index + 1} while it is asked`)
      }
    }
    if (!pub) return

    // The leaderboard: the top 10 still here, most points first, ties in join order.
    const order = new Map(present.map((p, i) => [p.id, i]))
    const board = present
      .map((p) => ({ id: p.id, points: this.points.get(p.id) ?? 0 }))
      .filter((row) => row.points > 0)
      .sort((a, b) => b.points - a.points || order.get(a.id)! - order.get(b.id)!)
      .slice(0, 10)
    const shown = pub.leaderboard.map((row) => `${row.playerId}:${row.points}:${row.rank}`).join()
    const expected = board.map((row) => `${row.id}:${row.points}:${competitionRank(row.points, scoredPoints)}`).join()
    if (run.fresh() && shown !== expected) run.fail('scores-match-oracle', 'the leaderboard differs from the oracle’s top 10')

    // Secrets: no answer before its reveal, and nothing of questions not asked yet.
    if (pub.phase === 'question') {
      if (pub.reveal !== null) run.fail('secrets-kept', `the public state has a reveal while question ${pub.index + 1} is asked`)
      const prompt = run.prompts().find((p) => p.key === `q${pub.index + 1}`)
      const options = prompt?.spec.kind === 'choice' ? prompt.spec.options : null
      if (!Array.isArray(options) || !options.every((o, i) => o === String(i))) {
        run.fail('secrets-kept', `question ${pub.index + 1}'s prompt offers more than option numbers`)
      }
    }
    if (JSON.stringify(pub.question ?? {}).includes('correct')) run.fail('secrets-kept', 'the asked question carries its answer')
    const strings = stringsIn(pub)
    this.config.questions.forEach((question, i) => {
      const asked = pub.phase !== 'lobby' && i <= pub.index
      if (asked) return
      if (strings.has(question.text) || question.options.some((o) => strings.has(o))) {
        run.fail('secrets-kept', `question ${i + 1} shows in the public state before it is asked`)
      }
    })
  }

  finished() {
    const { run } = this
    const present = run.present()
    const top = Math.max(0, ...present.map((p) => this.points.get(p.id) ?? 0))
    const want = top > 0 ? present.filter((p) => (this.points.get(p.id) ?? 0) === top).map((p) => p.id) : []
    const got = run.party.game(run.gameId).winners
    if (!sameSet(got, want)) {
      run.fail('winners-match-oracle', `the quiz crowned ${got.map(run.nameOf).join(', ') || 'nobody'}, the oracle ${want.map(run.nameOf).join(', ') || 'nobody'}`)
    }
  }
}
