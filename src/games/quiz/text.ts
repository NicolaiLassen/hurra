// The quiz's questions as plain text, so a host can write them anywhere and
// paste them into the settings in one go, or copy them out as a backup:
//
//   Which country invented LEGO? [15 s]
//   Sweden
//   *Denmark
//   Germany
//
// One question per block, blocks apart by an empty line. The first line is the
// question (with its own time in brackets, if any), then 2 to 4 options, one
// per line, with * before the right one.
import { MAX_OPTIONS, MIN_OPTIONS, type QuizQuestion } from './logic'

const SECONDS_TAG = /\s*\[\s*(\d{1,3})\s*(?:s|sec|secs|seconds?)?\s*\]\s*$/i
const BULLET = /^(?:[-•]\s+)/
const RIGHT = /^\*\s*/
const LETTERED = /^([A-Da-d])[).:]\s+/

/** The questions in a pasted text, and why any block was left out. */
export function parseQuestionsText(text: string): { questions: QuizQuestion[]; problems: string[] } {
  const questions: QuizQuestion[] = []
  const problems: string[] = []
  const blocks = text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.split('\n').map((line) => line.trim()).filter(Boolean))
    .filter((lines) => lines.length > 0)

  blocks.forEach(([first, ...rest], i) => {
    const n = i + 1
    const tag = first.match(SECONDS_TAG)
    const questionText = tag ? first.slice(0, tag.index).trim() : first
    let options = rest.map((line) => line.replace(BULLET, ''))
    const marked = options.map((line) => RIGHT.test(line))
    options = options.map((line) => line.replace(RIGHT, ''))
    // "A) Sweden", "B) Denmark": letters in order are labels, not part of the options.
    const letters = options.map((line) => line.match(LETTERED)?.[1].toUpperCase())
    if (options.length > 0 && letters.every((letter, j) => letter === 'ABCD'[j])) {
      options = options.map((line) => line.replace(LETTERED, ''))
    }

    if (!questionText) problems.push(`Block ${n} has no question`)
    else if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
      problems.push(`Block ${n} needs ${MIN_OPTIONS} to ${MAX_OPTIONS} options under the question`)
    } else if (!marked.includes(true)) problems.push(`Block ${n}: put * before the right option`)
    else if (marked.filter(Boolean).length > 1) problems.push(`Block ${n} marks more than one right option`)
    else {
      questions.push({
        text: questionText,
        options,
        correct: marked.indexOf(true),
        ...(tag ? { seconds: Number(tag[1]) } : {}),
      })
    }
  })
  return { questions, problems }
}

/** The questions in the same format, ready to copy. */
export function questionsToText(questions: readonly QuizQuestion[]): string {
  return questions
    .map((q) =>
      [
        `${q.text}${q.seconds !== undefined ? ` [${q.seconds} s]` : ''}`,
        ...q.options.map((option, i) => `${i === q.correct ? '*' : ''}${option}`),
      ].join('\n'),
    )
    .join('\n\n')
}
