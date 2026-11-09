import {
  ArrowDownIcon,
  ArrowUpIcon,
  ClipboardTextIcon,
  CopyIcon,
  PlusIcon,
  SparkleIcon,
  TrashIcon,
  WarningIcon,
  XIcon,
} from '@phosphor-icons/react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  checkQuestion,
  checkQuizConfig,
  MAX_OPTIONS,
  MAX_POINTS_PER_RIGHT,
  MAX_QUESTIONS,
  MAX_SECONDS,
  MIN_OPTIONS,
  MIN_SECONDS,
  type QuizGame,
  type QuizQuestion,
} from '@/games/quiz/logic'
import { letterOf } from '@/games/quiz/look'
import { LetterBadge } from '@/games/quiz/parts'
import { SAMPLE_QUESTIONS } from '@/games/quiz/samples'
import { parseQuestionsText, questionsToText } from '@/games/quiz/text'
import type { ConfigEditorProps } from '@/games/types'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

const PASTE_EXAMPLE = `Which country invented LEGO?
Sweden
*Denmark
Germany

True or false: honey keeps for ever? [10 s]
*True
False`

/**
 * The quiz's settings: the time per question, the party points per right
 * answer, and the questions, each with 2 to 4 options and the right one
 * picked. Paste a whole list at once, or start from 8 sample questions, whose
 * right answers the host picks (they ship without them).
 */
export default function ConfigEditor({ config, onChange, game }: ConfigEditorProps<QuizGame>) {
  const questions = readQuestions(config.questions)
  const [pasting, setPasting] = useState(false)
  // The option an Enter just added, so it takes the cursor.
  const [focus, setFocus] = useState<string | null>(null)
  const { problems } = checkQuizConfig(config as unknown as Record<string, unknown>)
  const room = MAX_QUESTIONS - questions.length

  const setQuestions = (next: QuizQuestion[]) => onChange({ ...config, questions: next.slice(0, MAX_QUESTIONS) })
  const update = (i: number, change: (question: QuizQuestion) => QuizQuestion) =>
    setQuestions(questions.map((question, j) => (j === i ? change(question) : question)))
  const move = (i: number, by: number) => {
    const next = [...questions]
    ;[next[i], next[i + by]] = [next[i + by], next[i]]
    setQuestions(next)
  }
  const addOption = (i: number) => update(i, (q) => ({ ...q, options: [...q.options, ''] }))
  const removeOption = (i: number, j: number) =>
    update(i, (q) => ({
      ...q,
      options: q.options.filter((_, k) => k !== j),
      // The right one went: pick again. A later one moves up a letter.
      correct: q.correct === j ? -1 : q.correct > j ? q.correct - 1 : q.correct,
    }))

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(questionsToText(questions))
      toast.success('Questions copied', { description: 'Paste them anywhere to keep a copy.' })
    } catch {
      toast.error("This browser didn't allow copying here")
    }
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid content-start gap-2">
          <Label htmlFor={`quiz-seconds-${game.id}`}>Seconds per question</Label>
          <Input
            id={`quiz-seconds-${game.id}`}
            type="number"
            inputMode="numeric"
            min={MIN_SECONDS}
            max={MAX_SECONDS}
            step={1}
            value={config.seconds}
            onChange={(e) => onChange({ ...config, seconds: whole(e.target.value) })}
          />
          <p className="text-xs text-muted-foreground">
            {MIN_SECONDS} to {MAX_SECONDS}. A question can have its own time.
          </p>
        </div>
        <div className="grid content-start gap-2">
          <Label htmlFor={`quiz-points-${game.id}`}>Party points per right answer</Label>
          <Input
            id={`quiz-points-${game.id}`}
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_POINTS_PER_RIGHT}
            step={1}
            value={config.pointsPerRight}
            onChange={(e) => onChange({ ...config, pointsPerRight: whole(e.target.value) })}
          />
          <p className="text-xs text-muted-foreground">
            0 to {MAX_POINTS_PER_RIGHT}, on the party standings. The quiz ranks by its own speed points: 500 to 1,000 for
            each right answer.
          </p>
        </div>
      </div>

      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label asChild>
            <h3>
              Questions ({questions.length} of {MAX_QUESTIONS})
            </h3>
          </Label>
          {questions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <Button type="button" variant="ghost" size="sm" disabled={room === 0} onClick={() => setPasting((open) => !open)}>
                <ClipboardTextIcon />
                Paste questions
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => void copyAll()}>
                <CopyIcon />
                Copy as text
              </Button>
            </div>
          )}
        </div>

        {pasting && (
          <PasteBox
            room={room}
            onAdd={(added) => {
              setQuestions([...questions, ...added])
              setPasting(false)
            }}
            onClose={() => setPasting(false)}
          />
        )}

        {questions.length === 0 && !pasting && (
          <div className="grid justify-items-center gap-3 rounded-2xl border border-dashed border-input p-6 text-center">
            <p className="font-semibold">No questions yet</p>
            <p className="text-sm text-muted-foreground">
              Write your own, paste a list, or start from 8 party questions and pick their right answers.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" onClick={() => setQuestions(SAMPLE_QUESTIONS)}>
                <SparkleIcon />
                Add 8 sample questions
              </Button>
              <Button type="button" variant="secondary" onClick={() => setPasting(true)}>
                <ClipboardTextIcon />
                Paste questions
              </Button>
            </div>
          </div>
        )}

        <ol className="grid gap-3">
          {questions.map((question, i) => {
            const issues = checkQuestion(question, i + 1).problems
            return (
              <li key={i} className="grid gap-3 rounded-2xl bg-background/40 p-3 ring-1 ring-input sm:p-4">
                <div className="flex items-center gap-1">
                  <span className="grid size-7 place-items-center rounded-lg bg-secondary text-sm font-bold tabular-nums">{i + 1}</span>
                  <span className="flex-1" />
                  <Button type="button" variant="ghost" size="icon" aria-label={`Move question ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Move question ${i + 1} down`}
                    disabled={i === questions.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDownIcon />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Remove question ${i + 1}`}
                    onClick={() => setQuestions(questions.filter((_, j) => j !== i))}
                  >
                    <TrashIcon />
                  </Button>
                </div>

                <Textarea
                  value={question.text}
                  rows={2}
                  placeholder="Type the question"
                  aria-label={`Question ${i + 1}`}
                  className="min-h-12 text-base font-semibold"
                  onChange={(e) => update(i, (q) => ({ ...q, text: e.target.value }))}
                />

                <div className="grid gap-2" role="radiogroup" aria-label={`The right answer to question ${i + 1}`}>
                  {question.options.map((option, j) => (
                    <div key={j} className="flex items-center gap-2">
                      <label className="flex shrink-0 cursor-pointer items-center gap-2" title="The right answer">
                        <input
                          type="radio"
                          name={`quiz-${game.id}-q${i}-right`}
                          checked={question.correct === j}
                          onChange={() => update(i, (q) => ({ ...q, correct: j }))}
                          className="size-4 accent-primary"
                          aria-label={`${letterOf(j)} is the right answer`}
                        />
                        <LetterBadge index={j} className="size-7 rounded-lg text-sm" />
                      </label>
                      <Input
                        value={option}
                        placeholder={`Option ${letterOf(j)}`}
                        aria-label={`Question ${i + 1}, option ${letterOf(j)}`}
                        autoFocus={focus === `${i}-${j}`}
                        onFocus={() => focus !== null && setFocus(null)}
                        className={cn(question.correct === j && 'border-primary/60')}
                        onChange={(e) =>
                          update(i, (q) => ({ ...q, options: q.options.map((o, k) => (k === j ? e.target.value : o)) }))
                        }
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return
                          e.preventDefault()
                          // Enter on the last option adds the next one, up to four.
                          if (j === question.options.length - 1 && question.options.length < MAX_OPTIONS) {
                            addOption(i)
                            setFocus(`${i}-${j + 1}`)
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Remove option ${letterOf(j)} from question ${i + 1}`}
                        disabled={question.options.length <= MIN_OPTIONS}
                        onClick={() => removeOption(i, j)}
                      >
                        <XIcon />
                      </Button>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {question.options.length < MAX_OPTIONS && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => addOption(i)}>
                      <PlusIcon />
                      Add an option
                    </Button>
                  )}
                  <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
                    Seconds
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={MIN_SECONDS}
                      max={MAX_SECONDS}
                      step={1}
                      className="w-20"
                      placeholder={String(config.seconds)}
                      value={question.seconds ?? ''}
                      onChange={(e) => update(i, (q) => withSeconds(q, e.target.value === '' ? undefined : whole(e.target.value)))}
                    />
                  </label>
                </div>

                {issues.length > 0 && (
                  <ul className="grid gap-1 text-sm text-destructive">
                    {issues.map((issue) => (
                      <li key={issue} className="flex items-center gap-1.5">
                        <WarningIcon weight="fill" className="shrink-0" />
                        {issue}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ol>

        {questions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="lg"
              disabled={room === 0}
              onClick={() => setQuestions([...questions, { text: '', options: ['', ''], correct: -1 }])}
            >
              <PlusIcon />
              Add a question
            </Button>
            {room >= SAMPLE_QUESTIONS.length && (
              <Button type="button" variant="ghost" size="lg" onClick={() => setQuestions([...questions, ...SAMPLE_QUESTIONS])}>
                <SparkleIcon />
                Add 8 sample questions
              </Button>
            )}
          </div>
        )}
      </section>

      {questions.length > 0 && problems.length > 0 && (
        <div className="flex gap-3 rounded-2xl bg-destructive/10 p-4 text-sm ring-1 ring-destructive/30">
          <WarningIcon weight="fill" className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="grid gap-1">
            <p className="font-semibold">Fix {problems.length === 1 ? 'this' : `these ${problems.length}`} before you start the quiz</p>
            <ul className="grid gap-0.5 text-muted-foreground">
              {problems.slice(0, 4).map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
              {problems.length > 4 && <li>and {problems.length - 4} more</li>}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

/** Paste a list of questions in the plain text format, with a live count of what it found. */
function PasteBox({ room, onAdd, onClose }: { room: number; onAdd: (questions: QuizQuestion[]) => void; onClose: () => void }) {
  const [text, setText] = useState('')
  const { questions, problems } = parseQuestionsText(text)
  const adding = questions.slice(0, room)

  return (
    <div className="grid gap-3 rounded-2xl bg-muted/40 p-4">
      <Label htmlFor="quiz-paste">Paste questions</Label>
      <Textarea
        id="quiz-paste"
        rows={9}
        value={text}
        placeholder={PASTE_EXAMPLE}
        className="font-mono text-sm"
        onChange={(e) => setText(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        One question per block, with an empty line between blocks. The first line is the question, then 2 to 4
        options, one per line. Put * before the right one. Add [30 s] after a question for its own time.
      </p>
      {problems.length > 0 && (
        <ul className="grid gap-1 text-sm text-destructive">
          {problems.map((problem) => (
            <li key={problem} className="flex items-center gap-1.5">
              <WarningIcon weight="fill" className="shrink-0" />
              {problem}
            </li>
          ))}
        </ul>
      )}
      {questions.length > room && (
        <p className="text-sm text-muted-foreground">
          Only {room} more fit: a quiz holds up to {MAX_QUESTIONS} questions.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" disabled={adding.length === 0} onClick={() => onAdd(adding)}>
          <PlusIcon />
          Add {adding.length || ''} {adding.length === 1 ? 'question' : 'questions'}
        </Button>
      </div>
    </div>
  )
}

/** The saved questions in their full shape, whatever was stored. */
function readQuestions(raw: unknown): QuizQuestion[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    const q = (item !== null && typeof item === 'object' ? item : {}) as Partial<Record<keyof QuizQuestion, unknown>>
    return {
      text: typeof q.text === 'string' ? q.text : '',
      options: Array.isArray(q.options) ? q.options.map((o) => (typeof o === 'string' ? o : String(o ?? ''))) : ['', ''],
      correct: typeof q.correct === 'number' ? q.correct : -1,
      ...(typeof q.seconds === 'number' ? { seconds: q.seconds } : {}),
    }
  })
}

/** The question with its own time, or with the quiz's default when `seconds` is undefined. */
function withSeconds(q: QuizQuestion, seconds: number | undefined): QuizQuestion {
  const base = { text: q.text, options: q.options, correct: q.correct }
  return seconds === undefined ? base : { ...base, seconds }
}

const whole = (value: string) => Math.round(Number(value) || 0)
