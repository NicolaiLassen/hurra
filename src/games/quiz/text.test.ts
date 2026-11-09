import { describe, expect, it } from 'vitest'
import { QuizGame } from './logic'
import { readPublic, readView } from './read'
import { SAMPLE_QUESTIONS } from './samples'
import { parseQuestionsText, questionsToText } from './text'

describe('pasting questions', () => {
  it('reads one question per block, with * before the right option and an own time in brackets', () => {
    const text = [
      'Which country invented LEGO? [15 s]',
      'Sweden',
      '*Denmark',
      'Germany',
      '',
      '',
      '  True or false: honey keeps for ever?  ',
      '* True',
      'False',
    ].join('\r\n')
    expect(parseQuestionsText(text)).toEqual({
      questions: [
        { text: 'Which country invented LEGO?', options: ['Sweden', 'Denmark', 'Germany'], correct: 1, seconds: 15 },
        { text: 'True or false: honey keeps for ever?', options: ['True', 'False'], correct: 0 },
      ],
      problems: [],
    })
  })

  it('drops bullets and A) B) C) labels, but keeps a letter that belongs to the answer', () => {
    expect(parseQuestionsText('Who?\n- A) Ana\n- *B) Bo\n- C) Cy').questions).toEqual([
      { text: 'Who?', options: ['Ana', 'Bo', 'Cy'], correct: 1 },
    ])
    expect(parseQuestionsText('Who wrote it?\n*A. A. Milne\nRoald Dahl').questions[0].options).toEqual(['A. A. Milne', 'Roald Dahl'])
    expect(parseQuestionsText('How cold?\n*-5 degrees\n5 degrees').questions[0].options).toEqual(['-5 degrees', '5 degrees'])
  })

  it('says which blocks it left out, and why', () => {
    const { questions, problems } = parseQuestionsText(
      ['Only one?\n*Yes', 'Five?\n*1\n2\n3\n4\n5', 'Which?\nA\nB', 'Two right?\n*A\n*B', 'Fine?\n*Yes\nNo'].join('\n\n'),
    )
    expect(questions).toEqual([{ text: 'Fine?', options: ['Yes', 'No'], correct: 0 }])
    expect(problems).toEqual([
      'Block 1 needs 2 to 4 options under the question',
      'Block 2 needs 2 to 4 options under the question',
      'Block 3: put * before the right option',
      'Block 4 marks more than one right option',
    ])
  })

  it('copies questions out in the same format, so they paste back as they were', () => {
    const text = questionsToText(SAMPLE_QUESTIONS)
    expect(text.split('\n\n')).toHaveLength(8)
    expect(text).toContain('True or false: honey can keep for thousands of years. [10 s]\n*True\nFalse')
    expect(parseQuestionsText(text)).toEqual({ questions: SAMPLE_QUESTIONS, problems: [] })
  })
})

describe('the sample questions', () => {
  it('are eight that the quiz accepts, with the right answer in different places', () => {
    const quiz = new QuizGame()
    expect(SAMPLE_QUESTIONS).toHaveLength(8)
    expect(quiz.parseConfig!({ ...quiz.defaultConfig, questions: SAMPLE_QUESTIONS })).toEqual({
      questions: SAMPLE_QUESTIONS,
      seconds: 20,
      pointsPerRight: 1,
    })
    expect(new Set(SAMPLE_QUESTIONS.map((q) => q.correct)).size).toBe(4)
    // No dashes in copy, and no emoji.
    for (const q of SAMPLE_QUESTIONS) expect(JSON.stringify(q)).not.toMatch(/[–—]|\p{Extended_Pictographic}/u)
  })
})

describe('reading projections on screens', () => {
  it('fills in what a fixture or an older save leaves out, and refuses what is not a quiz', () => {
    expect(readPublic(null)).toBeNull()
    expect(readPublic({ phase: 'warmup' })).toBeNull()
    expect(readPublic({ phase: 'question', index: 2, question: { text: 'Q?', options: ['a', 1], endsAt: 5 } })).toEqual({
      phase: 'question',
      index: 2,
      total: 3,
      question: { key: 'q3', text: 'Q?', options: ['a', '1'], endsAt: 5 },
      reveal: null,
      leaderboard: [],
    })
    expect(
      readPublic({
        phase: 'leaderboard',
        index: 0,
        total: 1,
        reveal: { correct: 1, counts: [1, 3] },
        leaderboard: [{ playerId: 'a', points: 900 }, { playerId: 'b', points: 900 }, { playerId: 'c', points: 500 }, { points: 1 }],
      }),
    ).toMatchObject({
      reveal: { correct: 1, counts: [1, 3], answered: 4, rightCount: 0, fastest: [] },
      leaderboard: [
        { playerId: 'a', points: 900, gained: 0, rank: 1 },
        { playerId: 'b', points: 900, gained: 0, rank: 1 },
        { playerId: 'c', points: 500, gained: 0, rank: 3 },
      ],
    })
    expect(readView(undefined)).toBeNull()
    expect(readView({ quizPoints: 850, rank: 0, last: { index: 0, choice: 2, correct: 1, points: 0 } })).toEqual({
      quizPoints: 850,
      rank: null,
      right: 0,
      last: { index: 0, choice: 2, correct: 1, points: 0 },
    })
  })
})
