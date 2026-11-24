// A tap on the quiz controller: shown at once, locked in once the database
// has it, rolled back with the reason when it refuses; and the words for how
// answering works, which follow the quiz's own rule.
import { createElement } from 'react'
import { prerender } from 'react-dom/static'
import { describe, expect, it, vi } from 'vitest'
import { isLocked, NO_PICK, refusalText, ruleLine, sendPick, shownChoice, tileName, type PickState } from '@/games/quiz/answer'
import { simulateParty } from '@/games/core/simulate'
import { QuizGame } from '@/games/quiz/logic'
import { AnswerTile } from '@/games/quiz/phoneParts'
import type { SubmitResult } from '@/lib/types'

const accepted = (choice: number): SubmitResult => ({ accepted: true, answer: { choice: [String(choice)] }, at: 1, ms: 1 })

describe('a tap on an answer', () => {
  it('shows the pick at once, before the database has answered', () => {
    const shown: PickState[] = []
    // A database that never answers: the tile must show all the same.
    const submit = vi.fn(() => new Promise<SubmitResult>(() => {}))
    void sendPick('q3', 2, submit, (state) => shown.push(state))
    // Synchronously, in the tap's own task: nothing awaited yet.
    expect(shown).toEqual([{ kind: 'sending', choice: 2 }])
    expect(shownChoice(undefined, shown[0])).toBe(2)
    expect(isLocked(undefined, shown[0])).toBe(false)
    expect(submit).toHaveBeenCalledWith('q3', { choice: ['2'] })
  })

  it('locks in once the database has it, with the answer the database kept', async () => {
    const shown: PickState[] = []
    await sendPick('q3', 2, async () => accepted(2), (state) => shown.push(state))
    expect(shown).toEqual([
      { kind: 'sending', choice: 2 },
      { kind: 'locked', choice: 2 },
    ])
    // A resend after a reload: the database's own answer wins over this tap.
    const replayed: PickState[] = []
    await sendPick('q3', 1, async () => accepted(3), (state) => replayed.push(state))
    expect(replayed.at(-1)).toEqual({ kind: 'locked', choice: 3 })
    expect(isLocked(undefined, replayed.at(-1)!)).toBe(true)
  })

  it('rolls back with the reason when the database refuses', async () => {
    const shown: PickState[] = []
    await sendPick('q3', 1, () => Promise.reject(new Error('Too late, answers are closed')), (state) => shown.push(state))
    expect(shown).toEqual([
      { kind: 'sending', choice: 1 },
      { kind: 'refused', message: 'Too late, answers are closed.' },
    ])
    // Rolled back: no tile picked, nothing locked.
    expect(shownChoice(undefined, shown[1])).toBeNull()
    expect(isLocked(undefined, shown[1])).toBe(false)
  })

  it('says a refusal in one short sentence, whatever comes back', () => {
    expect(refusalText(new Error('You already answered'))).toBe('You already answered.')
    expect(refusalText(new Error('Too late!'))).toBe('Too late.')
    expect(refusalText(undefined)).toBe("That didn't go through. Tap again.")
    expect(refusalText(new Error('  '))).toBe("That didn't go through. Tap again.")
  })

  it('shows what the database read back after a reload, locked', () => {
    expect(shownChoice({ choice: ['1'] }, NO_PICK)).toBe(1)
    expect(isLocked({ choice: ['1'] }, NO_PICK)).toBe(true)
    expect(shownChoice(undefined, NO_PICK)).toBeNull()
  })
})

describe('the words for answering', () => {
  it('match the quiz: its prompts take the first answer only, and the phone says so', () => {
    // The rule the copy rests on: the quiz opens each question as a final prompt (submit_answer refuses a second answer).
    const party = simulateParty({ games: [new QuizGame()], players: 2 })
    party.addGame('quiz', 'quiz', 'Quiz', { questions: [{ text: 'Q', options: ['a', 'b'], correct: 0 }], seconds: 10, pointsPerRight: 1 })
    expect(party.send(party.hostUser, { type: 'start', gameId: 'quiz' }).kind).toBe('commit')
    expect(party.send(party.hostUser, { type: 'host-action', gameId: 'quiz', action: { type: 'next', from: -1 } }).kind).toBe('commit')
    expect(party.promptsOf('quiz').map((p) => p.spec)).toEqual([{ kind: 'choice', options: ['0', '1'], final: true }])
    expect(ruleLine(true, true)).toBe('Tap the letter of your answer. Your first tap counts.')
    expect(ruleLine(true, false)).toBe('Tap your answer. Your first tap counts.')
    expect(ruleLine(false, true)).toBe('Tap the letter of your answer. You can change it until the time is up.')
  })

  it('name each tile by its letter, and by its answer when the phone shows the answers', async () => {
    expect(tileName(0, null)).toBe('A')
    expect(tileName(2, 'Copenhagen')).toBe('C: Copenhagen')
    const html = async (option: string | null, state: 'open' | 'sending' | 'locked' | 'faded') => {
      const { prelude } = await prerender(createElement(AnswerTile, { index: 2, option, state, onPick: () => {} }))
      return (await new Response(prelude).text()).replaceAll('<!-- -->', '')
    }
    expect(await html(null, 'open')).toMatch(/aria-label="C" aria-pressed="false"/)
    expect(await html('Copenhagen', 'open')).toMatch(/aria-label="C: Copenhagen" aria-pressed="false"/)
    // The pick shows on the tile itself: pressed, on paper, with where it is.
    const sending = await html(null, 'sending')
    expect(sending).toMatch(/aria-pressed="true"/)
    expect(sending).toContain('bg-paper')
    expect(sending).toContain('>Sending<')
    expect(await html(null, 'locked')).toContain('Locked in')
    // A faded tile can't be tapped.
    expect(await html(null, 'faded')).toMatch(/disabled=""/)
  })
})
