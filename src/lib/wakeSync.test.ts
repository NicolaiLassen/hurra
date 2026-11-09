import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GameCallError, type EngineResponse } from './gameApi'
import type { SessionGame } from './types'
import { createWakeScheduler, type WakeFailure } from './wakeSync'

// wakeSync.ts also holds the hook, which reaches the app's client through
// queries.ts; the scheduler itself never uses it.
vi.mock('@/lib/supabase', () => ({ supabase: {} }))

const START = 1_795_900_000_000
const GAME = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const OTHER = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e'

function game(patch: Partial<SessionGame> = {}): SessionGame {
  return {
    id: GAME,
    game_type: 'quiz',
    title: 'Quiz',
    position: 0,
    status: 'active',
    public_state: null,
    started_at: START - 60_000,
    finished_at: null,
    finished_by: null,
    winners: [],
    wake_at: null,
    archived_at: null,
    created_at: START - 120_000,
    ...patch,
  }
}

type Pending = { gameId: string; at: number; resolve: (r: EngineResponse) => void; reject: (e: unknown) => void }

function setup(delayMs = 250) {
  const calls: Pending[] = []
  const failing: WakeFailure[][] = []
  const onSynced = vi.fn()
  const scheduler = createWakeScheduler({
    delayMs,
    now: () => Date.now(),
    call: (gameId) => new Promise<EngineResponse>((resolve, reject) => calls.push({ gameId, at: Date.now() - START, resolve, reject })),
    onSynced,
    onFailing: (list) => failing.push(list),
  })
  return { scheduler, calls, failing, onSynced }
}

const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms)

beforeEach(() => {
  vi.useFakeTimers({ now: START })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('createWakeScheduler', () => {
  it('syncs a live game delayMs after its wake_at, by the given clock', async () => {
    const { scheduler, calls } = setup(250)
    scheduler.update([game({ wake_at: START + 5000 })])
    await tick(5249)
    expect(calls).toHaveLength(0)
    await tick(1)
    expect(calls.map((c) => [c.gameId, c.at])).toEqual([[GAME, 5250]])
    scheduler.stop()
  })

  it('ignores games that are not live, archived or without a wake_at', async () => {
    const { scheduler, calls } = setup()
    scheduler.update([
      game({ status: 'finished', finished_at: START, wake_at: START }),
      game({ id: OTHER, wake_at: null }),
      game({ id: 'c', status: 'pending', wake_at: START }),
    ])
    await tick(60_000)
    expect(calls).toHaveLength(0)
  })

  it('keeps one sync in flight per game', async () => {
    const { scheduler, calls } = setup()
    scheduler.update([game({ wake_at: START })])
    await tick(250)
    expect(calls).toHaveLength(1)
    // Snapshots keep arriving while the sync hangs: no second one.
    for (let i = 0; i < 10; i++) {
      scheduler.update([game({ wake_at: START })])
      await tick(5000)
    }
    expect(calls).toHaveLength(1)
    scheduler.stop()
  })

  it('never syncs one game twice within 2 s, and refreshes after a successful sync', async () => {
    const { scheduler, calls, onSynced } = setup(0)
    scheduler.update([game({ wake_at: START })])
    await tick()
    calls[0].resolve({})
    await tick()
    expect(onSynced).toHaveBeenCalledTimes(1)
    // The game asks again at once (a new wake_at already due): it waits out the 2 s.
    scheduler.update([game({ wake_at: START + 100 })])
    await tick(1999)
    expect(calls).toHaveLength(1)
    await tick(1)
    expect(calls.map((c) => c.at)).toEqual([0, 2000])
    scheduler.stop()
  })

  it('sends one wake_at once: a success is final until wake_at changes', async () => {
    const { scheduler, calls } = setup(0)
    scheduler.update([game({ wake_at: START })])
    await tick()
    calls[0].resolve({})
    await tick()
    scheduler.update([game({ wake_at: START })])
    await tick(60_000)
    expect(calls).toHaveLength(1)
    scheduler.stop()
  })

  it('retries a skipped sync once, 2 s later, while wake_at is unchanged', async () => {
    const { scheduler, calls, onSynced } = setup(250)
    scheduler.update([game({ wake_at: START })])
    await tick(250)
    calls[0].resolve({ skipped: true })
    await tick(1999)
    expect(calls).toHaveLength(1)
    await tick(1)
    expect(calls).toHaveLength(2)
    calls[1].resolve({ skipped: true })
    await tick(60_000)
    expect(calls).toHaveLength(2)
    expect(onSynced).toHaveBeenCalledTimes(2)
    scheduler.stop()
  })

  it('backs off 2, 5, 10, then every 30 s after failures, and resets on success', async () => {
    const { scheduler, calls, failing } = setup(0)
    scheduler.update([game({ wake_at: START })])
    await tick()
    const fail = async (error: unknown = new GameCallError("Couldn't reach the game.", 0, 'unavailable')) => {
      calls[calls.length - 1].reject(error)
      await tick()
    }
    const gaps: number[] = []
    for (let i = 0; i < 5; i++) {
      const before = calls.length
      const from = Date.now()
      await fail(i === 1 ? new GameCallError('The game is busy. Try again.', 409, 'busy') : i === 2 ? new GameCallError('Bad gateway', 502, '') : undefined)
      while (calls.length === before) await tick(500)
      gaps.push(Date.now() - from)
    }
    expect(gaps).toEqual([2000, 5000, 10_000, 30_000, 30_000])
    // Reported from the third failure in a row.
    expect(failing[0]).toEqual([{ gameId: GAME, failures: 3, message: 'Bad gateway' }])
    calls[calls.length - 1].resolve({})
    await tick()
    expect(failing[failing.length - 1]).toEqual([])
    scheduler.stop()
  })

  it('stops on a refusal (404, not_running, 403) until wake_at changes', async () => {
    for (const error of [
      new GameCallError('Game not found', 404, 'not_found'),
      new GameCallError('This game is not running', 409, 'not_running'),
      new GameCallError("You're not a player in this party", 403, 'not_player'),
    ]) {
      const { scheduler, calls, failing } = setup(0)
      scheduler.update([game({ wake_at: START })])
      await tick()
      calls[0].reject(error)
      await tick(120_000)
      expect(calls).toHaveLength(1)
      expect(failing).toEqual([])
      scheduler.update([game({ wake_at: Date.now() + 1000 })])
      await tick(1000)
      expect(calls).toHaveLength(2)
      scheduler.stop()
    }
  })

  it('replaces the old timer when a new wake_at arrives', async () => {
    const { scheduler, calls } = setup(250)
    scheduler.update([game({ wake_at: START + 10_000 })])
    await tick(3000)
    scheduler.update([game({ wake_at: START + 4000 })])
    await tick(1250)
    expect(calls.map((c) => c.at)).toEqual([4250])
    calls[0].resolve({})
    await tick(20_000)
    expect(calls).toHaveLength(1)
    scheduler.stop()
  })

  it('runs every game on its own clock', async () => {
    const { scheduler, calls } = setup(0)
    scheduler.update([game({ wake_at: START + 1000 }), game({ id: OTHER, wake_at: START + 1500 })])
    await tick(1500)
    expect(calls.map((c) => [c.gameId, c.at])).toEqual([
      [GAME, 1000],
      [OTHER, 1500],
    ])
    scheduler.stop()
  })

  it('forgets a game that is no longer live, and plans again after stop (StrictMode remount)', async () => {
    const { scheduler, calls } = setup(0)
    scheduler.update([game({ wake_at: START + 1000 })])
    scheduler.update([game({ status: 'finished', finished_at: START, wake_at: null })])
    await tick(5000)
    expect(calls).toHaveLength(0)
    scheduler.stop()
    scheduler.update([game({ wake_at: START + 6000 })])
    await tick(1000)
    expect(calls.map((c) => c.at)).toEqual([6000])
  })
})
