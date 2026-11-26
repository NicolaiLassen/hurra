import { describe, expect, it } from 'vitest'
import type { QuizConfig, QuizQuestion } from './logic'
import { quizSetup } from './setup'

const question = (n: number, patch: Partial<QuizQuestion> = {}): QuizQuestion => ({
  text: `Question number ${n}?`,
  options: ['Yes', 'No', 'Maybe'],
  correct: n % 3,
  ...patch,
})
const ten = (change: (n: number) => Partial<QuizQuestion> = () => ({})) => Array.from({ length: 10 }, (_, i) => question(i + 1, change(i + 1)))
const settings = (questions: QuizQuestion[], patch: Partial<QuizConfig> = {}): QuizConfig => ({ questions, seconds: 20, pointsPerRight: 1, ...patch })

describe('the quiz’s readiness', () => {
  it('is ready with every question answerable, and says the time', () => {
    expect(quizSetup(settings(ten()))).toEqual({ ready: true, line: '10 questions ready, 20 s each' })
    expect(quizSetup(settings(ten((n) => (n === 2 ? { seconds: 30 } : {}))))).toEqual({ ready: true, line: '10 questions ready' })
  })

  it('counts the questions still without their right answer, text or options', () => {
    const answers = ten((n) => (n === 3 || n === 8 ? { correct: 7 } : {}))
    expect(quizSetup(settings(answers))).toEqual({ ready: false, line: '8 of 10 questions ready: 2 need the right answer' })
    const mixed = ten((n) => (n === 1 ? { text: ' ' } : n === 2 ? { options: ['Yes', 'yes'], correct: 0 } : n === 4 ? { options: ['Only'], correct: 0 } : {}))
    expect(quizSetup(settings(mixed))).toEqual({
      ready: false,
      line: '7 of 10 questions ready: 1 has no question text, 2 have options to fix',
    })
    const timed = ten((n) => (n === 5 ? { seconds: 2 } : {}))
    expect(quizSetup(settings(timed))).toEqual({ ready: false, line: '9 of 10 questions ready: 1 needs a fix' })
  })

  it('says what else the start refuses', () => {
    expect(quizSetup(settings(ten(), { seconds: 500 }))).toEqual({
      ready: false,
      line: '10 questions ready, but the time per question must be 5 to 60 seconds',
    })
  })

  it('says when there are no questions yet', () => {
    expect(quizSetup(settings([]))).toEqual({ ready: false, line: 'No questions yet' })
    expect(quizSetup({} as QuizConfig)).toEqual({ ready: false, line: 'No questions yet' })
  })
})
