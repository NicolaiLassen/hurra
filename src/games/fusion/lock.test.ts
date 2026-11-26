// Locking in a guess on a phone: shown at once, locked in once the database
// has it, rolled back with the server's words when it refuses, read back
// after a reload, and time's up without a lock. As the quiz's answer.test.ts.
import { describe, expect, it, vi } from 'vitest'
import { isLockedIn, lockedPick, NO_LOCK, refusalOf, sendLock, type LockState } from '@/games/fusion/lock'
import { askingCase } from '@/games/fusion/phoneLines'
import { voteSpec } from '@/games/fusion/shapes'
import type { SubmitResult } from '@/lib/types'

const accepted = (choice: [string, string]): SubmitResult => ({ accepted: true, answer: { choice }, at: 1, ms: 1 })

describe('Lock in', () => {
  it('shows the lock at once, before the database has answered', () => {
    const shown: LockState[] = []
    // A database that never answers: the lock must show all the same.
    const submit = vi.fn(() => new Promise<SubmitResult>(() => {}))
    void sendLock('p4', ['bo', 'maja'], submit, (state) => shown.push(state))
    // Synchronously, in the tap's own task: nothing awaited yet.
    expect(shown).toEqual([{ kind: 'sending', pick: ['bo', 'maja'] }])
    expect(lockedPick(undefined, shown[0])).toEqual(['bo', 'maja'])
    expect(isLockedIn(undefined, shown[0])).toBe(false)
    expect(submit).toHaveBeenCalledWith('p4', { choice: ['bo', 'maja'] })
  })

  it('locks in once the database has it, with the two the database kept', async () => {
    const shown: LockState[] = []
    await sendLock('p4', ['maja', 'bo'], async () => accepted(['bo', 'maja']), (state) => shown.push(state))
    expect(shown).toEqual([
      { kind: 'sending', pick: ['maja', 'bo'] },
      { kind: 'locked', pick: ['bo', 'maja'] },
    ])
    expect(isLockedIn(undefined, shown[1])).toBe(true)
  })

  it('rolls back with the reason when the database refuses', async () => {
    const shown: LockState[] = []
    await sendLock('p4', ['bo', 'maja'], () => Promise.reject(new Error('Too late, answers are closed')), (state) => shown.push(state))
    expect(shown).toEqual([
      { kind: 'sending', pick: ['bo', 'maja'] },
      { kind: 'refused', message: 'Too late, answers are closed.', retry: false, closed: true },
    ])
    // Rolled back: nothing shown as locked.
    expect(lockedPick(undefined, shown[1])).toBeNull()
    expect(isLockedIn(undefined, shown[1])).toBe(false)
  })

  it('says a refusal in the server’s words, with "Try again." only when another lock can work', () => {
    expect(refusalOf(new Error('Too late, answers are closed'))).toEqual({ message: 'Too late, answers are closed.', retry: false, closed: true })
    expect(refusalOf(new Error('This question is not open'))).toMatchObject({ retry: false, closed: true })
    expect(refusalOf(new Error('You already answered'))).toEqual({ message: 'You already answered.', retry: false, closed: false })
    // The phone's calls carry the database's DETAIL code too.
    expect(refusalOf(Object.assign(new Error('Some words'), { code: 'already_answered' }))).toMatchObject({ retry: false, closed: false })
    expect(refusalOf(Object.assign(new Error('Some words'), { code: 'closed' }))).toMatchObject({ retry: false, closed: true })
    // A pick the database won't take (a guest who just left), or a lost connection: try again.
    expect(refusalOf(new Error('That is not one of the options'))).toEqual({
      message: 'That is not one of the options. Try again.',
      retry: true,
      closed: false,
    })
    expect(refusalOf(new Error("Couldn't reach the game. Check your connection and try again."))).toEqual({
      message: "Couldn't reach the game. Check your connection and try again.",
      retry: true,
      closed: false,
    })
    expect(refusalOf(undefined)).toEqual({ message: "That didn't go through. Try again.", retry: true, closed: false })
  })

  it('shows the lock the database read back after a reload, locked', () => {
    expect(lockedPick({ choice: ['bo', 'maja'] }, NO_LOCK)).toEqual(['bo', 'maja'])
    expect(isLockedIn({ choice: ['bo', 'maja'] }, NO_LOCK)).toBe(true)
    // A refusal after a lock this phone already has (another tab): the lock still shows.
    expect(isLockedIn({ choice: ['bo', 'maja'] }, { kind: 'refused', message: 'You already answered.', retry: false, closed: false })).toBe(true)
    expect(lockedPick(undefined, NO_LOCK)).toBeNull()
    expect(lockedPick({ choice: ['bo'] }, NO_LOCK)).toBeNull()
  })

  it('takes the first lock only: fusion opens each picture as a final prompt of two names', () => {
    expect(voteSpec(['Bo', 'Maja', 'Sofie'])).toMatchObject({ kind: 'choice', options: ['Bo', 'Maja', 'Sofie'], min: 2, max: 2, final: true })
  })
})

describe('which screen a phone shows while a picture is asked', () => {
  const base = { lockedIn: false, sending: false, over: false }

  it('the picker for a voter, a late joiner included (no view reads as not in it)', () => {
    expect(askingCase(base)).toBe('picking')
  })

  it('locked in, also after time is up', () => {
    expect(askingCase({ ...base, lockedIn: true })).toBe('locked')
    expect(askingCase({ ...base, lockedIn: true, over: true })).toBe('locked')
  })

  it("time's up without a lock; a lock on its way at the last moment keeps showing", () => {
    expect(askingCase({ ...base, over: true })).toBe('timeUp')
    expect(askingCase({ ...base, over: true, sending: true })).toBe('picking')
  })

})
