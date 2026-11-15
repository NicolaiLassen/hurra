// The quiz's projections as the screens read them. Snapshots carry them as
// plain JSON (a fixture, or a save from an older bundle), so every screen
// reads them through these, which fill in what is missing instead of crashing.
import type { AnswerPayload, PlayerId } from '../core/Game'
import { promptKey, type QuizLeaderboardRow, type QuizPhase, type QuizPlayerView, type QuizPublicState } from './logic'

const PHASES: readonly QuizPhase[] = ['lobby', 'question', 'reveal', 'leaderboard', 'done']

const record = (value: unknown) =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
const number = (value: unknown, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
const strings = (value: unknown) => (Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item : String(item ?? ''))) : [])

/** The public state in its full shape, or null when there is none yet. */
export function readPublic(raw: unknown): QuizPublicState | null {
  const pub = record(raw)
  if (!pub || !PHASES.includes(pub.phase as QuizPhase)) return null
  const question = record(pub.question)
  const reveal = record(pub.reveal)
  const index = number(pub.index, -1)
  return {
    phase: pub.phase as QuizPhase,
    index,
    total: number(pub.total, Math.max(index + 1, 0)),
    question: question
      ? {
          key: typeof question.key === 'string' ? question.key : promptKey(index),
          text: typeof question.text === 'string' ? question.text : '',
          options: strings(question.options),
          endsAt: number(question.endsAt),
        }
      : null,
    reveal: reveal
      ? {
          correct: number(reveal.correct, -1),
          counts: Array.isArray(reveal.counts) ? reveal.counts.map((n) => number(n)) : [],
          answered: number(reveal.answered, Array.isArray(reveal.counts) ? reveal.counts.reduce<number>((sum, n) => sum + number(n), 0) : 0),
          rightCount: number(reveal.rightCount),
          fastest: (Array.isArray(reveal.fastest) ? reveal.fastest : [])
            .map(record)
            .filter((row): row is Record<string, unknown> => row !== null && typeof row.playerId === 'string')
            .map((row) => ({ playerId: row.playerId as PlayerId, ms: number(row.ms) })),
        }
      : null,
    leaderboard: readBoard(pub.leaderboard),
  }
}

/** A player's own view in its full shape, or null when they have none. */
export function readView(raw: unknown): QuizPlayerView | null {
  const view = record(raw)
  if (!view) return null
  const last = record(view.last)
  return {
    quizPoints: number(view.quizPoints),
    rank: typeof view.rank === 'number' && view.rank > 0 ? view.rank : null,
    right: number(view.right),
    last: last
      ? {
          index: number(last.index, -1),
          choice: typeof last.choice === 'number' ? last.choice : null,
          correct: number(last.correct, -1),
          points: number(last.points),
        }
      : null,
  }
}

/** The option an answer picked (0 for A), or null. */
export function choiceIndex(answer: AnswerPayload | undefined): number | null {
  if (!answer || !('choice' in answer) || !Array.isArray(answer.choice)) return null
  const choice = Number(answer.choice[0])
  return Number.isInteger(choice) && choice >= 0 ? choice : null
}

/** The leaderboard rows, highest first, with competition ranks where a row lacks one. */
function readBoard(raw: unknown): QuizLeaderboardRow[] {
  const rows = (Array.isArray(raw) ? raw : [])
    .map(record)
    .filter((row): row is Record<string, unknown> => row !== null && typeof row.playerId === 'string')
    .map((row) => ({ playerId: row.playerId as PlayerId, points: number(row.points), gained: number(row.gained), rank: number(row.rank) }))
  return rows.map((row) => ({
    ...row,
    rank: row.rank > 0 ? row.rank : rows.filter((other) => other.points > row.points).length + 1,
  }))
}
