// One player's photo changes on one phone run one after another
// (docs/guest-photos.md, 6.3): the join step's save that Skip for now left
// running, and a save or a removal from the phone home's sheet.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { afterEarlierChange } from '@/components/photos/PhotoControls'

// PhotoControls imports the photo calls, which import the client.
vi.mock('@/lib/supabase', () => ({ supabase: {} }))

/** A promise and the hands that settle it. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Lets every promise callback already queued run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('afterEarlierChange', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("starts a player's second change only once the first has settled", async () => {
    const first = deferred<string>()
    const started: string[] = []
    const one = afterEarlierChange('player-1', () => {
      started.push('first')
      return first.promise
    })
    const two = afterEarlierChange('player-1', async () => {
      started.push('second')
      return 'second'
    })
    await flush()
    expect(started).toEqual(['first'])
    first.resolve('first')
    await expect(one).resolves.toBe('first')
    await expect(two).resolves.toBe('second')
    expect(started).toEqual(['first', 'second'])
  })

  it('also when the first one failed', async () => {
    const first = deferred<string>()
    const started: string[] = []
    const one = afterEarlierChange('player-2', () => {
      started.push('first')
      return first.promise
    })
    const two = afterEarlierChange('player-2', async () => {
      started.push('second')
      return 'second'
    })
    await flush()
    expect(started).toEqual(['first'])
    first.reject(new Error('lost'))
    await expect(one).rejects.toThrow('lost')
    await expect(two).resolves.toBe('second')
    expect(started).toEqual(['first', 'second'])
  })

  it("never holds back another player's change", async () => {
    const first = deferred<string>()
    const mine = afterEarlierChange('player-3', () => first.promise)
    await expect(afterEarlierChange('player-4', async () => 'theirs')).resolves.toBe('theirs')
    first.resolve('mine')
    await expect(mine).resolves.toBe('mine')
  })

  it('waits 60 s at most for a change that never settles', async () => {
    vi.useFakeTimers()
    const started: string[] = []
    void afterEarlierChange('player-5', () => new Promise<never>(() => {}))
    const two = afterEarlierChange('player-5', async () => {
      started.push('second')
      return 'second'
    })
    await vi.advanceTimersByTimeAsync(59_999)
    expect(started).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    await expect(two).resolves.toBe('second')
    expect(started).toEqual(['second'])
  })
})
