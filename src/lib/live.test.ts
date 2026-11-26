import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLiveSession, pingedFingerprint, type LiveState, type Screen } from './live'
import type { SessionGame, Snapshot } from './types'

const SESSION = '0b6a7c1e-5d2f-4b8a-9c3d-2e1f0a9b8c7d'
const PLAYER = '7d1e2f3a-4b5c-4d6e-8f70-81a2b3c4d5e6'
const GAME = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const START = 1_795_900_000_000

type Read = {
  args: Record<string, unknown>
  signal?: AbortSignal
  answer: (snapshot: Snapshot) => void
  fail: (message?: string) => void
}

class FakeChannel {
  handlers: ((message: { event: string; payload: unknown }) => void)[] = []
  onStatus?: (status: string) => void
  state = 'closed'
  topic: string
  options: { config?: { private?: boolean } }

  constructor(topic: string, options: { config?: { private?: boolean } }) {
    this.topic = topic
    this.options = options
  }
  on(_type: string, _filter: unknown, handler: (message: { event: string; payload: unknown }) => void) {
    this.handlers.push(handler)
    return this
  }
  subscribe(onStatus: (status: string) => void) {
    this.onStatus = onStatus
    this.state = 'joining'
    return this
  }
  // Test controls.
  join() {
    this.state = 'joined'
    this.onStatus?.('SUBSCRIBED')
  }
  fail(status = 'CHANNEL_ERROR') {
    this.state = 'errored'
    this.onStatus?.(status)
  }
  send(event: string, payload: Record<string, unknown> = {}) {
    for (const handler of this.handlers) handler({ event, payload })
  }
}

/** Just enough of a SupabaseClient for live.ts: rpc reads the test answers, and channels like realtime-js's. */
class FakeClient {
  reads: Read[] = []
  created: FakeChannel[] = []
  open = new Map<string, FakeChannel>()
  removed: FakeChannel[] = []
  socketUp = true
  realtime = { setAuth: vi.fn(async () => {}), isConnected: () => this.socketUp }

  rpc(_name: string, args: Record<string, unknown>) {
    let settle!: (result: { data: unknown; error: { message: string } | null; status: number }) => void
    const promise = new Promise<{ data: unknown; error: { message: string } | null; status: number }>((resolve) => (settle = resolve))
    const read: Read = {
      args,
      answer: (snapshot) => settle({ data: snapshot, error: null, status: 200 }),
      fail: (message = 'boom') => settle({ data: null, error: { message }, status: 500 }),
    }
    this.reads.push(read)
    return {
      abortSignal(signal: AbortSignal) {
        read.signal = signal
        signal.addEventListener('abort', () => settle({ data: null, error: { message: 'AbortError' }, status: 0 }))
        return promise
      },
    }
  }
  channel(topic: string, options: { config?: { private?: boolean } }) {
    // realtime-js hands back the existing channel for a topic asked for twice.
    const existing = this.open.get(topic)
    if (existing) return existing
    const channel = new FakeChannel(topic, options)
    this.created.push(channel)
    this.open.set(topic, channel)
    return channel
  }
  async removeChannel(channel: FakeChannel) {
    this.open.delete(channel.topic)
    this.removed.push(channel)
    channel.state = 'closed'
    return 'ok'
  }
  get asClient() {
    return this as unknown as SupabaseClient
  }
  /** The newest channel for a topic. */
  topic(name: string) {
    return [...this.created].reverse().find((c) => c.topic === name)
  }
  get pending() {
    return this.reads.filter((r) => !(r as Read & { done?: boolean }).done)
  }
}

function snapshot(patch: Partial<Snapshot> = {}): Snapshot {
  return {
    now: START,
    member: true,
    exists: true,
    session: {
      id: SESSION,
      name: 'Test party',
      join_code: 'TEST',
      status: 'open',
      data: {},
      spotlight_game_id: null,
      spotlight_at: null,
      tv_scene: 'live',
      sound_volume: 100,
      archived_at: null,
      created_at: START - 3_600_000,
    },
    games: [],
    prompts: [],
    tallies: {},
    game_points: {},
    players: [],
    standings: [],
    feed: [],
    me: null,
    states: null,
    screens: null,
    recap: null,
    ...patch,
  }
}

function liveGame(patch: Partial<SessionGame> = {}): SessionGame {
  return {
    id: GAME,
    game_type: 'quiz',
    title: 'Quiz',
    position: 0,
    status: 'active',
    public_state: { phase: 'question' },
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

const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms)
/**
 * Advances to `ms`, plus the 1 ms fake timers add to a 0 ms timer set during a
 * tick: a poll or a deadline asks for its read with setTimeout(0), which runs
 * at once in a browser.
 */
const until = (ms: number) => tick(ms + 1)

function open(client: FakeClient, screen: Screen, playerId: string | null = null) {
  const states: LiveState[] = []
  const live = createLiveSession(client.asClient, { sessionId: SESSION, screen, playerId }, (state) => states.push(state))
  return { live, states, last: () => states[states.length - 1] }
}

/** Answers the oldest unanswered read. */
async function answer(client: FakeClient, value: Snapshot = snapshot()) {
  const read = client.reads.find((r) => !(r as Read & { done?: boolean }).done)
  if (!read) throw new Error('No read in flight')
  ;(read as Read & { done?: boolean }).done = true
  read.answer(value)
  await tick()
}

beforeEach(() => {
  vi.useFakeTimers({ now: START })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('reads', () => {
  it('keeps one read in flight and at most one queued', async () => {
    const client = new FakeClient()
    const { live } = open(client, 'tv')
    expect(client.reads).toHaveLength(1)
    expect(client.reads[0].args).toEqual({ p_session_id: SESSION, p_screen: 'tv' })
    live.refresh()
    await tick()
    live.refresh()
    await tick()
    expect(client.reads).toHaveLength(1)
    await answer(client)
    expect(client.reads).toHaveLength(2)
    await answer(client)
    expect(client.reads).toHaveLength(2)
    live.close()
  })

  it('shows an error only while there is no snapshot, and keeps the snapshot when a read fails', async () => {
    const client = new FakeClient()
    const { live, last } = open(client, 'host')
    client.reads[0].fail('The database is down')
    ;(client.reads[0] as Read & { done?: boolean }).done = true
    await tick()
    expect(last().error?.message).toBe('The database is down')
    expect(last().snapshot).toBeUndefined()
    // Retried after 1 s.
    await tick(1000)
    expect(client.reads).toHaveLength(2)
    await answer(client)
    expect(last().snapshot).toBeDefined()
    expect(last().error).toBeUndefined()

    live.refresh()
    await tick()
    client.reads[2].fail()
    ;(client.reads[2] as Read & { done?: boolean }).done = true
    await tick()
    expect(last().snapshot).toBeDefined()
    expect(last().error).toBeUndefined()
    live.close()
  })

  it('retries failed reads after 1, 2, 5, then every 10 s', async () => {
    const client = new FakeClient()
    const { live } = open(client, 'tv')
    const failNext = async () => {
      const read = client.reads[client.reads.length - 1]
      read.fail()
      ;(read as Read & { done?: boolean }).done = true
      await tick()
    }
    const gaps: number[] = []
    let last = Date.now()
    for (let i = 0; i < 5; i++) {
      await failNext()
      const count = client.reads.length
      while (client.reads.length === count) await tick(100)
      gaps.push(Math.round((Date.now() - last) / 100) * 100)
      last = Date.now()
    }
    expect(gaps).toEqual([1000, 2000, 5000, 10_000, 10_000])
    live.close()
  })

  it('reads a malformed party id as a party that does not exist, without asking', async () => {
    const client = new FakeClient()
    const states: LiveState[] = []
    const live = createLiveSession(client.asClient, { sessionId: 'not-a-uuid', screen: 'phone' }, (s) => states.push(s))
    await tick()
    expect(client.reads).toHaveLength(0)
    expect(states[states.length - 1].snapshot).toMatchObject({ exists: false, member: false })
    live.close()
  })

  it('corrects the clock from the read with the shortest round trip', async () => {
    const client = new FakeClient()
    const { live } = open(client, 'tv')
    // Sent at START, answered 200 ms later, the server 5 s ahead.
    await tick(200)
    await answer(client, snapshot({ now: START + 100 + 5000 }))
    expect(live.serverNow() - Date.now()).toBe(5000)
    // A slow read (2 s round trip) with a skewed answer doesn't move it.
    live.refresh()
    await tick(2000)
    await answer(client, snapshot({ now: Date.now() - 1000 + 9000 }))
    expect(live.serverNow() - Date.now()).toBe(5000)
    live.close()
  })
})

describe('channels', () => {
  it('joins private room: and player: once a read says member, and leaves them when one says not', async () => {
    const client = new FakeClient()
    const { live, last } = open(client, 'phone', PLAYER)
    await tick()
    expect(client.created).toHaveLength(0)
    await answer(client)
    expect(client.created.map((c) => c.topic).sort()).toEqual([`player:${PLAYER}`, `room:${SESSION}`])
    expect(client.created.every((c) => c.options.config?.private === true)).toBe(true)
    expect(client.realtime.setAuth).toHaveBeenCalled()
    expect(last().connected).toBe(false)
    client.topic(`room:${SESSION}`)!.join()
    expect(last().connected).toBe(false)
    client.topic(`player:${PLAYER}`)!.join()
    expect(last().connected).toBe(true)

    // Removed from the party: the next read says not a member, and the channels go.
    live.refresh()
    await tick(300)
    await answer(client, snapshot({ member: false, session: null }))
    expect(last().connected).toBe(false)
    await tick(1000)
    expect(client.removed.map((c) => c.topic).sort()).toEqual([`player:${PLAYER}`, `room:${SESSION}`])
    live.close()
  })

  it('joins room: and stage: for the TV and the host page', async () => {
    const client = new FakeClient()
    const { live } = open(client, 'host')
    await answer(client)
    expect(client.created.map((c) => c.topic).sort()).toEqual([`room:${SESSION}`, `stage:${SESSION}`])
    live.close()
  })

  it('reads again when a channel joins or rejoins', async () => {
    const client = new FakeClient()
    const { live } = open(client, 'tv')
    await answer(client)
    const room = client.topic(`room:${SESSION}`)!
    room.join()
    await tick()
    expect(client.reads).toHaveLength(2)
    await answer(client)
    room.fail()
    room.join()
    await tick()
    expect(client.reads).toHaveLength(3)
    live.close()
  })

  it('shares one channel per topic between two sessions, and leaves it only when both have closed', async () => {
    const client = new FakeClient()
    const a = open(client, 'tv')
    const b = open(client, 'tv')
    await answer(client)
    await answer(client)
    expect(client.created.map((c) => c.topic).sort()).toEqual([`room:${SESSION}`, `stage:${SESSION}`])
    const room = client.topic(`room:${SESSION}`)!
    room.join()
    client.topic(`stage:${SESSION}`)!.join()
    await tick()
    await answer(client)
    await answer(client)

    a.live.close()
    await tick(5000)
    expect(client.removed).toHaveLength(0)
    const before = client.reads.length
    room.send('changed', { session: SESSION })
    await tick()
    expect(client.reads).toHaveLength(before + 1)
    await answer(client)

    b.live.close()
    await tick(999)
    expect(client.removed).toHaveLength(0)
    await tick(1)
    expect(client.removed.map((c) => c.topic).sort()).toEqual([`room:${SESSION}`, `stage:${SESSION}`])
  })

  it('reuses the channel when a session remounts at once (StrictMode)', async () => {
    const client = new FakeClient()
    const first = open(client, 'tv')
    await answer(client)
    first.live.close()
    const second = open(client, 'tv')
    await answer(client)
    await tick(2000)
    expect(client.created).toHaveLength(2)
    expect(client.removed).toHaveLength(0)
    second.live.close()
  })

  it('re-creates a dropped player: channel after a random 0 to 3 s once the socket is back', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const client = new FakeClient()
    const { live } = open(client, 'phone', PLAYER)
    await answer(client)
    const player = client.topic(`player:${PLAYER}`)!
    player.join()
    client.topic(`room:${SESSION}`)!.join()

    // The socket drops: the player channel errors and is left at once.
    client.socketUp = false
    player.fail()
    await tick()
    expect(client.removed).toContain(player)
    // Down for 5 s: nothing is re-created meanwhile.
    await tick(5000)
    expect(client.created.filter((c) => c.topic === `player:${PLAYER}`)).toHaveLength(1)
    // Back: re-created 1 to 1.5 s later (the check runs each second, then 0.5 of the 3 s spread).
    client.socketUp = true
    await tick(1000)
    expect(client.created.filter((c) => c.topic === `player:${PLAYER}`)).toHaveLength(1)
    await tick(1600)
    const again = client.created.filter((c) => c.topic === `player:${PLAYER}`)
    expect(again).toHaveLength(2)
    expect(again[1]).not.toBe(player)
    live.close()
  })

  it('a channel that keeps failing never postpones the safety poll', async () => {
    const client = new FakeClient()
    const { live } = open(client, 'tv')
    await answer(client)
    const stage = client.topic(`stage:${SESSION}`)!
    await tick(20_000)
    stage.fail()
    await tick(9000)
    stage.fail()
    await until(1000)
    expect(client.reads).toHaveLength(2)
    live.close()
  })

  it('polls every 5 s once a channel has failed to join 3 times in a row', async () => {
    const client = new FakeClient()
    const { live } = open(client, 'tv')
    await answer(client)
    const stage = client.topic(`stage:${SESSION}`)!
    client.topic(`room:${SESSION}`)!.join()
    await tick()
    await answer(client)
    stage.fail()
    stage.fail()
    stage.fail()
    const count = client.reads.length
    await until(5000)
    expect(client.reads).toHaveLength(count + 1)
    live.close()
  })
})

describe('pings', () => {
  it('phones wait a random 0 to 300 ms after a ping; a prompt opening reads at once', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const client = new FakeClient()
    const { live } = open(client, 'phone', PLAYER)
    await answer(client)
    const room = client.topic(`room:${SESSION}`)!
    room.send('changed', { session: SESSION, game: GAME })
    await tick(149)
    expect(client.reads).toHaveLength(1)
    await tick(1)
    expect(client.reads).toHaveLength(2)
    await answer(client)

    room.send('changed', { session: SESSION, game: GAME, prompt: true })
    await tick()
    expect(client.reads).toHaveLength(3)
    live.close()
  })

  it('the TV reads at once after a ping', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const client = new FakeClient()
    const { live } = open(client, 'tv')
    await answer(client)
    client.topic(`room:${SESSION}`)!.send('changed', { session: SESSION })
    await tick()
    expect(client.reads).toHaveLength(2)
    live.close()
  })

  it('moved: marks the phone moved and reads at once', async () => {
    const client = new FakeClient()
    const { live, last } = open(client, 'phone', PLAYER)
    await answer(client)
    client.topic(`player:${PLAYER}`)!.send('moved', { player: PLAYER })
    await tick()
    expect(last().moved).toBe(true)
    expect(client.reads).toHaveLength(2)
    live.close()
  })

  it('moved: a phone that slept through the ping learns it from its next read', async () => {
    const client = new FakeClient()
    const { live, last } = open(client, 'phone', PLAYER)
    await answer(client, snapshot({ member: false, session: null, moved: true }))
    expect(last().moved).toBe(true)
    live.close()
  })

  it('moved: a removed phone (moved false) is not marked moved', async () => {
    const client = new FakeClient()
    const { live, last } = open(client, 'phone', PLAYER)
    await answer(client, snapshot({ member: false, session: null, moved: false }))
    expect(last().moved).toBe(false)
    live.close()
  })

  it('freed: a phone whose name the host gave back to the guest list learns it from its next read', async () => {
    const client = new FakeClient()
    const { live, last } = open(client, 'phone', PLAYER)
    await answer(client, snapshot({ member: false, session: null, moved: false, freed: true }))
    expect(last()).toMatchObject({ freed: true, moved: false })
    live.close()
  })

  it('freed: a removed phone, and the TV, are never marked freed', async () => {
    const client = new FakeClient()
    const { live, last } = open(client, 'phone', PLAYER)
    await answer(client, snapshot({ member: false, session: null, moved: false, freed: false }))
    expect(last().freed).toBe(false)
    live.close()
    const tvClient = new FakeClient()
    const tv = open(tvClient, 'tv')
    await answer(tvClient, snapshot({ member: false, session: null, freed: true }))
    expect(tv.last().freed).toBe(false)
    tv.live.close()
  })

  it('keeps the highest pinged tally, and reads once 400 ms after the last one', async () => {
    const client = new FakeClient()
    const { live, last } = open(client, 'host')
    await answer(client, snapshot({ games: [liveGame()], tallies: { [GAME]: { q1: 1 } } }))
    const stage = client.topic(`stage:${SESSION}`)!
    stage.send('tally', { game: GAME, key: 'q1', count: 3 })
    stage.send('tally', { game: GAME, key: 'q1', count: 2 })
    expect(last().tallies[GAME].q1).toBe(3)
    await tick(399)
    stage.send('tally', { game: GAME, key: 'q1', count: 4 })
    await tick(399)
    expect(client.reads).toHaveLength(1)
    await until(1)
    expect(client.reads).toHaveLength(2)
    // A tally that arrives while that read is out is kept on top of its (older) count.
    stage.send('tally', { game: GAME, key: 'q1', count: 6 })
    await answer(client, snapshot({ games: [liveGame()], tallies: { [GAME]: { q1: 5 } } }))
    expect(last().tallies[GAME].q1).toBe(6)
    // The settle read replaces the counts.
    await until(400)
    await answer(client, snapshot({ games: [liveGame()], tallies: { [GAME]: { q1: 7 } } }))
    expect(last().tallies[GAME].q1).toBe(7)
    live.close()
  })

  it('a restarted quiz starts its counts over: a read can lower a tally', async () => {
    const client = new FakeClient()
    const { live, last } = open(client, 'tv')
    await answer(client, snapshot({ games: [liveGame()], tallies: { [GAME]: { q1: 40 } } }))
    live.refresh()
    await tick()
    await answer(client, snapshot({ games: [liveGame()], tallies: { [GAME]: { q1: 0 } } }))
    expect(last().tallies[GAME].q1).toBe(0)
    live.close()
  })
})

describe('safety polls', () => {
  it('phones poll every 10 s in the lobby and while a live game has a timer or an open prompt with a deadline, else every 60 s', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const client = new FakeClient()
    const { live } = open(client, 'phone', PLAYER)
    // The lobby: a party still on with no live game. Joins and host awards ping the stage only, so every 10 s.
    await answer(client)
    await tick(9999)
    expect(client.reads).toHaveLength(1)
    await until(1)
    expect(client.reads).toHaveLength(2)
    await answer(client)
    const room = client.topic(`room:${SESSION}`)!
    /** A change announced by its ping: the read it causes lands, and the poll clock restarts from there. */
    const announce = async (next: Snapshot) => {
      room.send('changed', { session: SESSION, game: GAME })
      await until(0)
      await answer(client, next)
      return client.reads.length
    }
    /** The next safety poll comes `ms` after the last read, and not a moment before. */
    const pollsAfter = async (ms: number, current: Snapshot) => {
      const reads = client.reads.length
      await tick(ms - 1)
      expect(client.reads, `no poll before ${ms} ms`).toHaveLength(reads)
      await until(1)
      expect(client.reads, `a poll at ${ms} ms`).toHaveLength(reads + 1)
      await answer(client, current)
    }

    // A live game with no prompt and no timer: every 60 s.
    const quiet = snapshot({ games: [liveGame()] })
    await announce(quiet)
    await pollsAfter(60_000, quiet)

    // An open prompt with a deadline (a quiz question; this one's deadline read falls outside the test): every 10 s.
    const prompt = { game_id: GAME, key: 'q1', spec: { kind: 'choice' as const, options: ['0', '1'] }, opened_at: START, closes_at: START + 3_600_000, closed_at: null, revealed_at: null }
    const withPrompt = snapshot({ games: [liveGame()], prompts: [prompt] })
    await announce(withPrompt)
    await pollsAfter(10_000, withPrompt)

    // An open prompt with no deadline (a vote left open for the evening) keeps the 60 s poll.
    const votes = snapshot({ games: [liveGame()], prompts: [{ ...prompt, key: 'p1', closes_at: null }] })
    await announce(votes)
    await pollsAfter(60_000, votes)

    // A timer: every 10 s.
    const timer = snapshot({ games: [liveGame({ wake_at: START + 3_600_000 })] })
    await announce(timer)
    await pollsAfter(10_000, timer)

    // The game is over and nothing else is live: the lobby again, every 10 s.
    const between = snapshot({ games: [liveGame({ status: 'finished', finished_at: START })] })
    await announce(between)
    await pollsAfter(10_000, between)

    // The party is archived: every 60 s.
    const archived = snapshot({ session: { ...snapshot().session!, archived_at: START }, games: [liveGame({ status: 'finished', finished_at: START })] })
    await announce(archived)
    await pollsAfter(60_000, archived)
    live.close()
  })

  it('the TV and the host page poll every 30 s', async () => {
    const client = new FakeClient()
    const { live } = open(client, 'host')
    await answer(client)
    await tick(29_999)
    expect(client.reads).toHaveLength(1)
    await until(1)
    expect(client.reads).toHaveLength(2)
    live.close()
  })

  it('while a live game holds the stage, phones poll every 10 s and the TV and the host page every 5 s', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    // Last one standing in the background, with no prompt and no timer: on its own it changes nothing.
    const background = liveGame({ id: 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f', game_type: 'elimination', public_state: {} })
    const stage = (game: SessionGame) => snapshot({ session: { ...snapshot().session!, spotlight_game_id: GAME }, games: [game, background] })
    for (const screen of ['phone', 'tv', 'host'] as const) {
      const client = new FakeClient()
      const { live } = open(client, screen, screen === 'phone' ? PLAYER : null)
      const fast = screen === 'phone' ? 10_000 : 5000
      // The quiz's leaderboard between two questions: the next one opens with a single ping.
      const leaderboard = stage(liveGame({ public_state: { phase: 'leaderboard' } }))
      await answer(client, leaderboard)
      await tick(fast - 1)
      expect(client.reads, screen).toHaveLength(1)
      await until(1)
      expect(client.reads, screen).toHaveLength(2)
      await answer(client, leaderboard)
      // Finished, as its ping says: its final screen holds the stage, but nothing opens on it any more.
      client.topic(`room:${SESSION}`)!.send('changed', { session: SESSION, game: GAME })
      await until(0)
      await answer(client, stage(liveGame({ status: 'finished', finished_at: START })))
      const reads = client.reads.length
      await until(fast)
      expect(client.reads, screen).toHaveLength(reads)
      live.close()
    }
  })

  it('phones read once 2 s after each wake_at and closes_at they know of (plus up to 1 s)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const client = new FakeClient()
    const { live } = open(client, 'phone', PLAYER)
    const prompt = { game_id: GAME, key: 'q1', spec: { kind: 'choice' as const, options: ['0', '1'] }, opened_at: START, closes_at: START + 4000, closed_at: null, revealed_at: null }
    await answer(client, snapshot({ games: [liveGame({ wake_at: START + 5000 })], prompts: [prompt] }))
    await tick(5999)
    expect(client.reads).toHaveLength(1)
    await until(1)
    expect(client.reads).toHaveLength(2)
    await answer(client, snapshot({ games: [liveGame({ wake_at: START + 5000 })], prompts: [prompt] }))
    await until(999)
    expect(client.reads).toHaveLength(3)
    // Each deadline is read once, even when a later snapshot still shows it.
    await answer(client, snapshot({ games: [liveGame({ wake_at: START + 5000 })], prompts: [prompt] }))
    await tick(5000)
    expect(client.reads).toHaveLength(3)
    live.close()
  })
})

describe('ping health', () => {
  const renamed = (name: string) => snapshot({ session: { ...snapshot().session!, name } })

  it('turns unhealthy when a poll finds a change no ping announced, and a ping heals it', async () => {
    const client = new FakeClient()
    const { live, last } = open(client, 'tv')
    await answer(client)
    client.topic(`room:${SESSION}`)!.join()
    client.topic(`stage:${SESSION}`)!.join()
    await tick()
    await answer(client)
    // The 30 s poll finds the party renamed, and no ping came.
    await until(30_000)
    await answer(client, renamed('Renamed'))
    expect(last().pings).toBe('ok')
    await tick(2999)
    expect(last().pings).toBe('ok')
    await tick(1)
    expect(last().pings).toBe('unhealthy')
    // Unhealthy: polls every 5 s.
    const count = client.reads.length
    await until(5000)
    expect(client.reads).toHaveLength(count + 1)
    await answer(client, renamed('Renamed'))
    client.topic(`room:${SESSION}`)!.send('changed', { session: SESSION })
    await tick()
    expect(last().pings).toBe('ok')
    live.close()
  })

  it('stays healthy when the ping trails the change by less than 3 s', async () => {
    const client = new FakeClient()
    const { live, last } = open(client, 'tv')
    await answer(client)
    await until(30_000)
    await answer(client, renamed('Renamed'))
    await tick(2000)
    client.topic(`room:${SESSION}`)!.send('changed', { session: SESSION })
    await tick(5000)
    expect(last().pings).toBe('ok')
    live.close()
  })

  it('stays healthy when a ping announced the change, and not when the next ping is lost', async () => {
    const client = new FakeClient()
    const { live, last } = open(client, 'tv')
    await answer(client)
    client.topic(`room:${SESSION}`)!.send('changed', { session: SESSION })
    await until(0)
    await answer(client, renamed('Renamed'))
    // The poll sees what the ping announced.
    await until(30_000)
    await answer(client, renamed('Renamed'))
    await tick(3000)
    expect(last().pings).toBe('ok')
    // The next change's ping is lost: the following poll finds it.
    await until(30_000)
    await answer(client, renamed('Renamed again'))
    await tick(3000)
    expect(last().pings).toBe('unhealthy')
    live.close()
  })

  it('a phone’s fingerprint ignores everything that changes with stage-only pings or by time alone', () => {
    const base = snapshot({
      games: [liveGame(), liveGame({ id: 'pending', status: 'pending', public_state: null, started_at: null })],
      me: { player_id: PLAYER, views: { [GAME]: { n: 1 } }, answers: {} },
    })
    const stageOnly: Partial<Snapshot>[] = [
      { players: [{ id: 'p', name: 'New guest', code: 'ABCDE', profile: {}, created_at: START }] },
      { standings: [{ player_id: 'p', name: 'P', code: 'ABCDE', points: 3, profile: {} }] },
      { game_points: { [GAME]: { p: 3 } } },
      { tallies: { [GAME]: { q1: 9 } } },
      { states: { [GAME]: { state: { secret: 1 }, config: {}, round: 1, members: [] } } },
      { screens: 2 },
      // The host's guest list changes with stage pings only (docs/guest-list.md).
      { guests: [{ id: 'z', name: 'Zelda', joined_at: null, created_at: START }] },
      { games: [liveGame(), liveGame({ id: 'pending', status: 'pending', title: 'Renamed', position: 4, public_state: null, started_at: null })] },
      // Unarchiving a finished game pings the stage only.
      { games: [liveGame(), liveGame({ id: 'old', status: 'finished', finished_at: START - 1, archived_at: null })] },
      { me: { player_id: PLAYER, views: { [GAME]: { n: 1 } }, answers: { [GAME]: { q1: { choice: ['1'] } } } } },
    ]
    const archivedOld = snapshot({ ...base, games: [liveGame(), liveGame({ id: 'old', status: 'finished', finished_at: START - 1, archived_at: START })] })
    const unarchived = stageOnly[8]
    expect(pingedFingerprint('phone', { ...archivedOld, ...unarchived })).toBe(pingedFingerprint('phone', archivedOld))
    for (const patch of stageOnly.slice(0, 8)) {
      expect(pingedFingerprint('phone', { ...base, ...patch })).toBe(pingedFingerprint('phone', base))
      expect(pingedFingerprint('tv', { ...base, ...patch })).not.toBe(pingedFingerprint('tv', base))
    }
    expect(pingedFingerprint('phone', { ...base, ...stageOnly[9] })).toBe(pingedFingerprint('phone', base))
    // A finished game's points and views leave the snapshot after 60 minutes: no screen counts that as a change.
    const finished = liveGame({ id: 'done', status: 'finished', finished_at: START - 1, public_state: { a: 1 } })
    const shown = snapshot({ games: [finished], game_points: { done: { p: 3 } }, me: { player_id: PLAYER, views: { done: { v: 1 } }, answers: {} } })
    const aged = snapshot({ games: [{ ...finished, public_state: null }], game_points: {}, me: { player_id: PLAYER, views: {}, answers: {} } })
    for (const screen of ['phone', 'tv', 'host'] as const) expect(pingedFingerprint(screen, aged)).toBe(pingedFingerprint(screen, shown))
  })

  it('a phone’s fingerprint changes with what its pings announce', () => {
    const base = snapshot({ games: [liveGame()], me: { player_id: PLAYER, views: { [GAME]: { n: 1 } }, answers: {} } })
    const announced: Partial<Snapshot>[] = [
      { games: [liveGame({ public_state: { phase: 'reveal' } })] },
      { games: [liveGame({ wake_at: START + 1000 })] },
      { games: [liveGame({ status: 'finished', finished_at: START })] },
      { me: { player_id: PLAYER, views: { [GAME]: { n: 2 } }, answers: {} } },
      { feed: [{ id: 9, game_id: GAME, message: 'Hi', detail: null, audience: null, sound: null, icon: null, tone: null, interrupt: false, created_at: START }] },
      { recap: { published_at: START } },
      { session: { ...base.session!, spotlight_game_id: GAME, spotlight_at: START } },
      // The TV's sound volume pings the room like every other change to the party.
      { session: { ...base.session!, sound_volume: 25 } },
      { prompts: [{ game_id: GAME, key: 'q1', spec: { kind: 'choice', options: ['0'] }, opened_at: START, closes_at: null, closed_at: START, revealed_at: null }] },
    ]
    for (const patch of announced) expect(pingedFingerprint('phone', { ...base, ...patch })).not.toBe(pingedFingerprint('phone', base))
  })
})

describe('environment', () => {
  it('reads when the tab becomes visible or the device comes back online, and stops listening on close', async () => {
    const listeners: Record<string, () => void> = {}
    const offs = { visible: vi.fn(), online: vi.fn() }
    const client = new FakeClient()
    const live = createLiveSession(
      client.asClient,
      {
        sessionId: SESSION,
        screen: 'phone',
        playerId: PLAYER,
        environment: {
          onVisible: (listener) => ((listeners.visible = listener), offs.visible),
          onOnline: (listener) => ((listeners.online = listener), offs.online),
        },
      },
      () => {},
    )
    await answer(client)
    listeners.visible()
    await tick()
    expect(client.reads).toHaveLength(2)
    await answer(client)
    listeners.online()
    await tick()
    expect(client.reads).toHaveLength(3)
    live.close()
    expect(offs.visible).toHaveBeenCalled()
    expect(offs.online).toHaveBeenCalled()
  })

  it('stops reading and reporting once closed', async () => {
    const client = new FakeClient()
    const { live, states } = open(client, 'tv')
    live.close()
    const count = states.length
    client.reads[0].answer(snapshot())
    await tick(120_000)
    expect(states).toHaveLength(count)
    expect(client.reads).toHaveLength(1)
    expect(client.reads[0].signal?.aborted).toBe(true)
  })
})
