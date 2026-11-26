// The quiz's readiness in the host's Games panel (GameModule.setupStatus), from
// its own check (checkQuizConfig and checkQuestion, what the start refuses):
// every question with its text, its options and the right one picked, and a
// time and points the start accepts.
import { counted, lowerFirst, need, readyLine, type Need, type SetupStatus } from '@/games/core/setup'
import { checkQuestion, checkQuizConfig, type QuizConfig } from '@/games/quiz/logic'

/** What a question's problem is about, from checkQuestion's words. */
function kindOf(problem: string): 'text' | 'options' | 'answer' | 'other' {
  if (/^Question \d+ needs a question$/.test(problem)) return 'text'
  if (/^Pick the right answer/.test(problem)) return 'answer'
  if (/option/.test(problem)) return 'options'
  return 'other'
}

export function quizSetup(config: QuizConfig): SetupStatus {
  const raw = Array.isArray(config?.questions) ? config.questions : []
  if (raw.length === 0) return { ready: false, line: 'No questions yet' }

  const kinds = raw.map((question, i) => new Set(checkQuestion(question, i + 1).problems.map(kindOf)))
  const count = (kind: ReturnType<typeof kindOf>) => kinds.filter((k) => k.has(kind)).length
  const ready = kinds.filter((k) => k.size === 0).length
  const needs: Need[] = [
    { count: count('text'), one: 'has no question text', many: 'have no question text' },
    { count: count('options'), one: 'has options to fix', many: 'have options to fix' },
    need(count('answer'), 'the right answer'),
    need(count('other'), 'a fix'),
  ]
  const questionsLine = readyLine(ready, raw.length, ['question', 'questions'], needs)

  // The rest: the time per question and the points, as the start checks them.
  const { problems } = checkQuizConfig(config as unknown as Record<string, unknown>)
  const rest = problems.filter((problem) => !/^Question \d+|^Pick the right answer for question \d+$|^A quiz holds up to/.test(problem))
  if (rest.length > 0) {
    if (ready < raw.length) return { ready: false, line: `${questionsLine}. ${counted(rest.length, 'other setting')} to fix` }
    return { ready: false, line: `${questionsLine}, but ${lowerFirst(rest[0])}` }
  }
  if (problems.length > 0 && ready === raw.length) return { ready: false, line: problems[0] }
  if (ready < raw.length) return { ready: false, line: questionsLine }

  const timed = raw.some((q) => q && typeof q === 'object' && 'seconds' in q && q.seconds !== undefined && q.seconds !== null)
  return { ready: true, line: timed ? questionsLine : `${questionsLine}, ${config.seconds} s each` }
}
