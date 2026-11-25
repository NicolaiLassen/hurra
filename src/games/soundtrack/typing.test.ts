// Lydspor's save rules for typed answers (spec 4.7.1): when a field saves,
// what it sends, what its label says, how a refusal reads, and one save at a
// time per prompt with the last text winning.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  dbTrim,
  decideSave,
  draftSlot,
  fieldState,
  preLockDelay,
  readDraft,
  refusalWords,
  SAVE_BEFORE_LOCK_MS,
  serialSaves,
  writeDraft,
} from './typing'

describe('dbTrim', () => {
  it('trims spaces, tabs and line breaks at both ends, as the database does', () => {
    expect(dbTrim('  Coldwave \t\n')).toBe('Coldwave')
    expect(dbTrim('\r\nMira  Holm ')).toBe('Mira  Holm')
  })

  it('keeps what the database keeps: inner spaces and a no-break space', () => {
    expect(dbTrim(' Natlys')).toBe(' Natlys')
  })
})

describe('decideSave', () => {
  it('sends a new answer as it is typed, never corrected', () => {
    expect(decideSave('papir lanterner ', null)).toEqual({ kind: 'send', text: 'papir lanterner ' })
    expect(decideSave('Mira Holm', 'Mira Hol')).toEqual({ kind: 'send', text: 'Mira Holm' })
  })

  it('sends nothing when the database has it already, so no change is spent', () => {
    expect(decideSave('Coldwave', 'Coldwave')).toEqual({ kind: 'same' })
    expect(decideSave('  Coldwave\n', 'Coldwave')).toEqual({ kind: 'same' })
  })

  it('but a change of capitals is a change: what is stored is what was typed', () => {
    expect(decideSave('coldwave', 'Coldwave')).toEqual({ kind: 'send', text: 'coldwave' })
  })

  it('never empties: an emptied field gets the saved answer back', () => {
    expect(decideSave('', 'Coldwave')).toEqual({ kind: 'restore', text: 'Coldwave' })
    expect(decideSave(' \t ', 'Coldwave')).toEqual({ kind: 'restore', text: 'Coldwave' })
  })

  it('does nothing for an empty field with nothing saved', () => {
    expect(decideSave('', null)).toEqual({ kind: 'none' })
    expect(decideSave('   ', null)).toEqual({ kind: 'none' })
  })
})

describe('fieldState', () => {
  const base = { focused: false, field: 'Coldwave', saved: 'Coldwave', saving: false }

  it('says Saved once the database has exactly what the field shows', () => {
    expect(fieldState(base)).toBe('saved')
    expect(fieldState({ ...base, field: ' Coldwave ' })).toBe('saved')
  })

  it('says Saving while a save is on its way, focused or not', () => {
    expect(fieldState({ ...base, saving: true })).toBe('saving')
    expect(fieldState({ ...base, focused: true, saving: true })).toBe('saving')
  })

  it('says nothing while the guest types, so no word flickers per letter', () => {
    expect(fieldState({ ...base, focused: true })).toBeNull()
    expect(fieldState({ ...base, focused: true, field: 'Coldw' })).toBeNull()
  })

  it('says Not sent for text the database does not have once the field is left', () => {
    expect(fieldState({ ...base, field: 'Coldwav' })).toBe('unsent')
    expect(fieldState({ ...base, field: 'Coldwave', saved: null })).toBe('unsent')
  })

  it('says nothing for an empty field', () => {
    expect(fieldState({ ...base, field: '', saved: null })).toBeNull()
  })
})

describe('refusalWords', () => {
  const error = (message: string, code: string) => Object.assign(new Error(message), { code })

  it('names the song and part for the change cap', () => {
    expect(refusalWords(error("That's enough changes for this one", 'too_many_changes'), 3, 'title')).toBe(
      "That's enough changes for song 3's title.",
    )
    expect(refusalWords(new Error("That's enough changes for this one"), 3, 'event')).toBe("That's enough changes for song 3's event.")
  })

  it('says the answers are closed after the lock', () => {
    expect(refusalWords(error('Too late, answers are closed', 'closed'), 5, 'singer')).toBe('Too late, answers are closed.')
    expect(refusalWords(error('This question is not open', 'closed'), 5, 'singer')).toBe('Too late, answers are closed.')
  })

  it('without a connection, says how to try again with the key the field has', () => {
    const offline = error("Couldn't reach the game. Check your connection and try again.", 'unavailable')
    expect(refusalWords(offline, 2, 'title')).toBe('Not sent. Tap Next to try again.')
    expect(refusalWords(offline, 2, 'singer')).toBe('Not sent. Tap Done to try again.')
    expect(refusalWords(offline, 2, 'event')).toBe('Not sent. Tap again.')
  })

  it("otherwise gives the database's own words, ending in a full stop", () => {
    expect(refusalWords(new Error('Answers are 1 to 60 characters'), 1, 'title')).toBe('Answers are 1 to 60 characters.')
    expect(refusalWords('Something else', 1, 'title')).toBe('Something else.')
    expect(refusalWords(null, 1, 'title')).toBe('Not sent. Try again.')
  })
})

describe('preLockDelay', () => {
  it('saves a field still being typed in once, 3 seconds before the lock', () => {
    expect(SAVE_BEFORE_LOCK_MS).toBe(3000)
    expect(preLockDelay(100_000, 40_000)).toBe(57_000)
  })

  it('saves at once inside the last 3 seconds, and never with no lock or after it', () => {
    expect(preLockDelay(100_000, 98_500)).toBe(0)
    expect(preLockDelay(100_000, 100_000)).toBeNull()
    expect(preLockDelay(null, 40_000)).toBeNull()
  })
})

describe('serialSaves', () => {
  /** A send whose saves resolve when told to, recording each one. */
  function harness() {
    const sent: [string, string][] = []
    const waiting: (() => void)[] = []
    const run = (key: string, value: string) =>
      new Promise<void>((resolve) => {
        sent.push([key, value])
        waiting.push(resolve)
      })
    const finish = async () => {
      waiting.shift()?.()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    return { sent, finish, save: serialSaves(run) }
  }

  it('sends one save at a time per key, and only the last text asked for meanwhile', async () => {
    const { sent, finish, save } = harness()
    const done = save('s1.title', 'Col')
    void save('s1.title', 'Cold')
    void save('s1.title', 'Coldwave')
    expect(sent).toEqual([['s1.title', 'Col']])
    await finish()
    expect(sent).toEqual([
      ['s1.title', 'Col'],
      ['s1.title', 'Coldwave'],
    ])
    await finish()
    await done
    expect(sent).toHaveLength(2)
  })

  it('keeps keys apart: another prompt never waits', () => {
    const { sent, save } = harness()
    void save('s1.title', 'Natlys')
    void save('s1.singer', 'Rosa')
    expect(sent).toEqual([
      ['s1.title', 'Natlys'],
      ['s1.singer', 'Rosa'],
    ])
  })

  it('goes on after a save fails, and starts afresh once a key is idle', async () => {
    const sent: string[] = []
    const save = serialSaves(async (_key: string, value: string) => {
      sent.push(value)
      if (value === 'bad') throw new Error('refused')
    })
    const first = save('s2.title', 'bad')
    void save('s2.title', 'good')
    await first
    expect(sent).toEqual(['bad', 'good'])
    await save('s2.title', 'again')
    expect(sent).toEqual(['bad', 'good', 'again'])
  })
})

describe('drafts', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('are kept per round and prompt key, and forgotten once saved', () => {
    expect(draftSlot('game:1', 's5.title')).toBe('hurra:lydspor:draft:game:1:s5.title')
    const memory = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
      removeItem: (key: string) => void memory.delete(key),
    })
    writeDraft('game:1', 's5.title', 'Coldw')
    expect(readDraft('game:1', 's5.title')).toBe('Coldw')
    expect(readDraft('game:2', 's5.title')).toBeNull()
    writeDraft('game:1', 's5.title', null)
    expect(readDraft('game:1', 's5.title')).toBeNull()
  })

  it('fail quietly without storage (private mode, full storage)', () => {
    const broken = () => {
      throw new Error('SecurityError')
    }
    vi.stubGlobal('sessionStorage', { getItem: broken, setItem: broken, removeItem: broken })
    expect(() => writeDraft('game:1', 's5.title', 'Coldw')).not.toThrow()
    expect(readDraft('game:1', 's5.title')).toBeNull()
  })
})
