// The screens' live data (docs/engine-v2.md, 5.4). Every committed change sends
// one tiny Broadcast ping per audience, on private topics:
//
// - room:<session>    every screen of the party: something everyone sees changed
// - stage:<session>   the TV and the host page: joins, awards, answer tallies, host-only state
// - player:<player>   one phone: its own view changed, or its player moved to another phone
//
// A ping carries nothing worth trusting except a tally; on a ping the screen
// reads one snapshot (session_snapshot), and row level security decides what
// each screen gets. A lost ping heals at the next read: on (re)join, when the
// tab becomes visible, when the device comes back online, and at the safety
// polls. Ping health notices changes that no ping announced.
//
// Relative imports and npm packages only, and no DOM, Vite or import.meta: the
// rehearsal runs one of these per bot under Node. Browser events come in
// through `environment` (useLive.tsx passes them).
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import type { Snapshot, Tallies } from './types'

export type Screen = 'phone' | 'tv' | 'host'

export type LiveState = {
  snapshot?: Snapshot
  /** Only while there is no snapshot yet. */
  error?: Error
  /** Highest count seen per game and prompt, settled by reads. */
  tallies: Tallies
  /** Every channel joined. */
  connected: boolean
  /** 'unhealthy' when changes arrive that no ping announced. */
  pings: 'ok' | 'unhealthy'
  /** This phone's player moved to another phone. */
  moved: boolean
}

/** Browser-only events, passed in by useLive.tsx; the rehearsal's bots pass none. */
export type LiveEnvironment = {
  onVisible?: (listener: () => void) => () => void
  onOnline?: (listener: () => void) => () => void
}

/** A read with no answer by then is given up and retried. */
const READ_TIMEOUT_MS = 10_000
/** After a failed read: 1 s, 2 s, 5 s, then every 10 s. */
const READ_BACKOFF_MS = [1000, 2000, 5000, 10_000]
/** Phones spread their read after a ping, so 45 reads don't land in the same millisecond. */
const PHONE_JITTER_MS = 300
/** Pinged tallies undercount when answers arrive together: read the exact counts once they settle. */
const TALLY_SETTLE_MS = 400
const POLL_MS: Record<Screen, number> = { phone: 60_000, tv: 30_000, host: 30_000 }
/** Phones, while a live game has an open prompt or a timer. */
const PHONE_LIVE_POLL_MS = 10_000
/** While a channel keeps failing to join, or pings are unhealthy. */
const FAST_POLL_MS = 5000
const FAILED_JOINS = 3
/** Phones read once this long after each wake_at and closes_at they know of, plus a jitter. */
const DEADLINE_DELAY_MS = 2000
const DEADLINE_JITTER_MS = 1000
/** A ping may trail the change it announces: wait this long before calling pings unhealthy. */
const PING_GRACE_MS = 3000
/** After the socket comes back, a phone re-creates its player: channel within this spread. */
const PLAYER_REJOIN_SPREAD_MS = 3000
/** A channel nobody listens to any more is left after this, so a quick remount (StrictMode) reuses it. */
const CHANNEL_RELEASE_MS = 1000
/** While a re-created channel waits for the socket to come back. */
const SOCKET_CHECK_MS = 1000
/** Extra wait before re-creating a channel the server refused again (on top of the spread). */
const REJOIN_BACKOFF_MS = [0, 1000, 4000, 9000]
/** The server clock: the steadiest of the last few reads (the shortest round trip). */
const CLOCK_SAMPLES = 8
const CLOCK_SAMPLE_MAX_AGE_MS = 10 * 60_000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Timer = ReturnType<typeof setTimeout>

// Channels, shared per client and topic -----------------------------------------
//
// realtime-js returns the existing channel when a topic is asked for twice, so
// StrictMode's double mount, or the award page's provider beside another one,
// would share a channel and tear it down under each other. So there is one
// channel per client and topic, with a reference count: every event goes to
// every listener, and the channel is left only when the last one closes.

type TopicStatus = 'joining' | 'joined' | 'failed'

type TopicListener = {
  onEvent(event: string, payload: Record<string, unknown>): void
  onStatus(status: TopicStatus): void
}

type TopicEntry = {
  client: SupabaseClient
  topic: string
  /** Above 0: when the channel drops, re-create it after a random wait up to this, once the socket is back. */
  spreadMs: number
  listeners: Set<TopicListener>
  channel: RealtimeChannel | null
  status: TopicStatus
  /** Failed joins in a row. */
  failures: number
  /** Bumped by every (re)connect and the teardown, so stale callbacks do nothing. */
  generation: number
  retryTimer?: Timer
  releaseTimer?: Timer
}

const topicsByClient = new WeakMap<SupabaseClient, Map<string, TopicEntry>>()
/** Channels being left: a new channel for the same topic waits, or client.channel() would hand back the leaving one. */
const leavingByClient = new WeakMap<SupabaseClient, Map<string, Promise<unknown>>>()

function listenTopic(client: SupabaseClient, topic: string, listener: TopicListener, spreadMs: number): () => void {
  let topics = topicsByClient.get(client)
  if (!topics) topicsByClient.set(client, (topics = new Map()))
  let entry = topics.get(topic)
  if (!entry) {
    entry = { client, topic, spreadMs, listeners: new Set(), channel: null, status: 'joining', failures: 0, generation: 0 }
    topics.set(topic, entry)
    void connectTopic(entry)
  }
  const shared = entry
  clearTimeout(shared.releaseTimer)
  shared.releaseTimer = undefined
  shared.listeners.add(listener)
  listener.onStatus(shared.status)
  let released = false
  return () => {
    if (released) return
    released = true
    shared.listeners.delete(listener)
    if (shared.listeners.size === 0) {
      clearTimeout(shared.releaseTimer)
      shared.releaseTimer = setTimeout(() => teardownTopic(shared), CHANNEL_RELEASE_MS)
    }
  }
}

function setTopicStatus(entry: TopicEntry, status: TopicStatus) {
  entry.status = status
  for (const listener of [...entry.listeners]) listener.onStatus(status)
}

async function connectTopic(entry: TopicEntry) {
  const generation = ++entry.generation
  const leaving = leavingByClient.get(entry.client)?.get(entry.topic)
  if (leaving) await leaving
  if (generation !== entry.generation) return
  // Join with the signed-in user's token, not the API key's: the private
  // topic's policy runs as whoever joins.
  try {
    await entry.client.realtime.setAuth()
  } catch {
    // The join then fails, and is retried like any other failed join.
  }
  if (generation !== entry.generation) return
  const channel = entry.client.channel(entry.topic, { config: { private: true } })
  entry.channel = channel
  setTopicStatus(entry, 'joining')
  channel.on('broadcast', { event: '*' }, (message) => {
    if (entry.channel !== channel) return
    const payload = message.payload
    const data = payload !== null && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    for (const listener of [...entry.listeners]) listener.onEvent(String(message.event), data)
  })
  channel.subscribe((status) => {
    if (entry.channel !== channel) return
    if (status === 'SUBSCRIBED') {
      entry.failures = 0
      setTopicStatus(entry, 'joined')
      return
    }
    entry.failures++
    setTopicStatus(entry, 'failed')
    // Realtime rejoins an errored channel by itself: at once when the socket
    // reopens, with its own backoff after a refused join. Two cases are ours: a
    // channel that closed (Realtime never rejoins those), and the player topic,
    // which phones re-create after a random 0 to 3 s, so 45 phones coming back
    // from a Wi-Fi blip stay well under the Free plan's 100 joins a second.
    if (status === 'CLOSED' || entry.spreadMs > 0) {
      dropChannel(entry, channel)
      scheduleRejoin(entry)
    }
  })
  // A channel someone else on this client had already joined: subscribe() then
  // reports nothing, but its events still arrive.
  if (String(channel.state) === 'joined' && entry.channel === channel) setTopicStatus(entry, 'joined')
}

function dropChannel(entry: TopicEntry, channel: RealtimeChannel) {
  if (entry.channel === channel) entry.channel = null
  let leaving = leavingByClient.get(entry.client)
  if (!leaving) leavingByClient.set(entry.client, (leaving = new Map()))
  const left: Promise<unknown> = Promise.resolve()
    .then(() => entry.client.removeChannel(channel))
    .catch(() => undefined)
    .finally(() => {
      if (leaving.get(entry.topic) === left) leaving.delete(entry.topic)
    })
  leaving.set(entry.topic, left)
}

function socketOpen(client: SupabaseClient): boolean {
  try {
    return client.realtime.isConnected()
  } catch {
    return true
  }
}

function scheduleRejoin(entry: TopicEntry) {
  clearTimeout(entry.retryTimer)
  const generation = entry.generation
  const backoff = REJOIN_BACKOFF_MS[Math.min(entry.failures, REJOIN_BACKOFF_MS.length) - 1] ?? 0
  const attempt = (waited: boolean) => {
    if (generation !== entry.generation) return
    if (!socketOpen(entry.client)) {
      entry.retryTimer = setTimeout(() => attempt(true), SOCKET_CHECK_MS)
      return
    }
    if (waited && entry.spreadMs > 0) {
      // The socket just came back: spread the rejoin from here.
      entry.retryTimer = setTimeout(() => {
        if (generation === entry.generation) void connectTopic(entry)
      }, Math.random() * entry.spreadMs)
      return
    }
    void connectTopic(entry)
  }
  const wait = entry.spreadMs > 0 ? Math.random() * entry.spreadMs + backoff : READ_BACKOFF_MS[Math.min(entry.failures, READ_BACKOFF_MS.length) - 1]
  entry.retryTimer = setTimeout(() => attempt(false), wait)
}

function teardownTopic(entry: TopicEntry) {
  if (entry.listeners.size > 0) return
  entry.generation++
  clearTimeout(entry.retryTimer)
  entry.releaseTimer = undefined
  const topics = topicsByClient.get(entry.client)
  if (topics?.get(entry.topic) === entry) topics.delete(entry.topic)
  if (entry.channel) dropChannel(entry, entry.channel)
}

// Snapshots ---------------------------------------------------------------------

/** What a party that doesn't exist reads as (a malformed id is never sent). */
function missingSnapshot(now: number): Snapshot {
  return {
    now,
    member: false,
    exists: false,
    session: null,
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
  }
}

function isSnapshot(value: unknown): value is Snapshot {
  if (value === null || typeof value !== 'object') return false
  const s = value as Partial<Snapshot>
  return (
    typeof s.now === 'number' &&
    typeof s.member === 'boolean' &&
    typeof s.exists === 'boolean' &&
    Array.isArray(s.games) &&
    Array.isArray(s.prompts) &&
    Array.isArray(s.players) &&
    Array.isArray(s.standings) &&
    Array.isArray(s.feed)
  )
}

const liveIds = (s: Snapshot) => new Set(s.games.filter((g) => g.status === 'active' && g.archived_at === null).map((g) => g.id))

/** Whether a live game has an open prompt or a timer: phones then poll every 10 s. */
function hasLiveDeadline(s: Snapshot | undefined): boolean {
  if (!s) return false
  const live = liveIds(s)
  return s.games.some((g) => live.has(g.id) && g.wake_at !== null) || s.prompts.some((p) => live.has(p.game_id) && p.closed_at === null)
}

/** Whether a pinged tally still counts: not for a game that is over, nor a prompt already revealed. */
function tallyApplies(s: Snapshot | undefined, game: string, key: string): boolean {
  if (!s) return true
  const g = s.games.find((x) => x.id === game)
  if (g && g.status !== 'active') return false
  const p = s.prompts.find((x) => x.game_id === game && x.key === key)
  return !(p && p.revealed_at !== null)
}

function withTally(tallies: Tallies, game: string, key: string, count: number): Tallies {
  if ((tallies[game]?.[key] ?? -1) >= count) return tallies
  return { ...tallies, [game]: { ...tallies[game], [key]: count } }
}

/**
 * The parts of a snapshot that change only with a ping this screen hears (ping
 * health). Phones hear room: and their own player:; the TV and the host page
 * hear room: and stage:. Nothing that leaves the snapshot by time alone (the
 * 60-minute window of shown games) is in it.
 */
export function pingedFingerprint(screen: Screen, s: Snapshot): string {
  const live = liveIds(s)
  const session = s.session && [
    s.session.name,
    s.session.status,
    s.session.spotlight_game_id,
    s.session.spotlight_at,
    s.session.tv_scene,
    s.session.archived_at,
  ]
  const phone = screen === 'phone'
  // A game's archived_at is left out for phones: unarchiving pings the stage only.
  const games = s.games
    .filter((g) => g.status !== 'pending')
    .map((g) => [g.id, g.status, g.finished_at, g.wake_at, g.status === 'active' ? g.public_state : null, phone ? null : g.archived_at])
  const prompts = s.prompts.map((p) => [p.game_id, p.key, p.closed_at, p.revealed_at])
  const feed = s.feed.reduce<number | null>((newest, item) => (newest === null || item.id > newest ? item.id : newest), null)
  const views = s.me ? s.games.filter((g) => live.has(g.id)).map((g) => [g.id, s.me!.views[g.id] ?? null]) : null
  const recap = s.recap?.published_at ?? null
  if (phone) return JSON.stringify([session, games, prompts, feed, views, recap])
  return JSON.stringify([
    session,
    games,
    prompts,
    feed,
    views,
    recap,
    // Every game change pings the stage or the room, pending games included.
    s.games.map((g) => [g.id, g.status, g.title, g.position, g.archived_at]),
    s.players.map((p) => [p.id, p.name, p.code, p.profile]),
    s.standings.map((r) => [r.player_id, r.name, r.points]),
    // Live games only: a finished game's points leave the snapshot by time alone.
    s.games.filter((g) => live.has(g.id)).map((g) => [g.id, s.game_points[g.id] ?? null]),
    s.tallies,
    s.states,
    s.screens,
  ])
}

// The live session ----------------------------------------------------------------

export function createLiveSession(
  client: SupabaseClient,
  options: { sessionId: string; screen: Screen; playerId?: string | null; environment?: LiveEnvironment },
  onChange: (state: LiveState) => void,
): { refresh(): void; serverNow(): number; close(): void } {
  const { sessionId, screen, environment = {} } = options
  const phone = screen === 'phone'
  let state: LiveState = { tallies: {}, connected: false, pings: 'ok', moved: false }
  let closed = false

  const emit = (patch: Partial<LiveState>) => {
    state = { ...state, ...patch }
    if (!closed) onChange(state)
  }

  // The server clock: offset = snapshot.now - (sentAt + receivedAt) / 2, from
  // the read with the shortest round trip among the last few.
  const clockSamples: { offset: number; rtt: number; at: number }[] = []
  let offset = 0
  const serverNow = () => Date.now() + offset
  function noteClock(serverTime: number, sentAt: number, receivedAt: number) {
    clockSamples.push({ offset: serverTime - (sentAt + receivedAt) / 2, rtt: Math.max(0, receivedAt - sentAt), at: receivedAt })
    while (
      clockSamples.length > CLOCK_SAMPLES ||
      (clockSamples.length > 1 && receivedAt - clockSamples[0].at > CLOCK_SAMPLE_MAX_AGE_MS)
    ) {
      clockSamples.shift()
    }
    offset = clockSamples.reduce((best, sample) => (sample.rtt < best.rtt ? sample : best)).offset
  }

  // Reads: one in flight and at most one queued, so an older answer never lands over a newer one.
  let inFlight: AbortController | null = null
  let queued = false
  let queuedPoll = false
  let readFailures = 0
  let readTimer: Timer | undefined
  let readDueAt = Infinity
  let readPoll = false
  /** The last read that landed: what the next safety poll compares with. */
  let previous: { fingerprint: string; sentAt: number } | null = null
  let lastPingAt = -Infinity

  /** Asks for a read in `delayMs`; requests close together share one. `poll` marks a safety poll (ping health). */
  function schedule(delayMs: number, poll = false) {
    if (closed) return
    readPoll ||= poll
    const due = Date.now() + delayMs
    if (readTimer !== undefined && readDueAt <= due) return
    clearTimeout(readTimer)
    readDueAt = due
    readTimer = setTimeout(
      () => {
        readTimer = undefined
        readDueAt = Infinity
        const asPoll = readPoll
        readPoll = false
        read(asPoll)
      },
      Math.max(0, delayMs),
    )
  }

  function read(poll: boolean) {
    if (closed) return
    if (inFlight) {
      queued = true
      queuedPoll ||= poll
      return
    }
    void run(poll)
  }

  async function run(poll: boolean) {
    const controller = new AbortController()
    inFlight = controller
    const timeout = setTimeout(() => controller.abort(), READ_TIMEOUT_MS)
    const sentAt = Date.now()
    const tallySeqAtSend = tallySeq
    try {
      if (!UUID.test(sessionId)) {
        land(missingSnapshot(sentAt), sentAt, sentAt, tallySeqAtSend, poll)
        return
      }
      const { data, error, status } = await client
        .rpc('session_snapshot', { p_session_id: sessionId, p_screen: screen })
        .abortSignal(controller.signal)
      if (closed) return
      if (error) throw new Error(status === 0 ? "Couldn't reach the party. Check your connection." : error.message)
      if (!isSnapshot(data)) throw new Error('The party sent something this app can’t read. Reload the page.')
      land(data, sentAt, Date.now(), tallySeqAtSend, poll)
    } catch (error) {
      if (!closed) fail(error)
    } finally {
      clearTimeout(timeout)
      inFlight = null
      if (!closed) {
        planPoll(true)
        if (queued) {
          const asPoll = queuedPoll
          queued = false
          queuedPoll = false
          void run(asPoll)
        }
      }
    }
  }

  function fail(error: unknown) {
    // Keep what is on screen; show the error only while there is nothing yet.
    if (!state.snapshot) emit({ error: error instanceof Error ? error : new Error(String(error)) })
    schedule(READ_BACKOFF_MS[Math.min(readFailures, READ_BACKOFF_MS.length - 1)])
    readFailures++
  }

  function land(snapshot: Snapshot, sentAt: number, receivedAt: number, tallySeqAtSend: number, poll: boolean) {
    readFailures = 0
    noteClock(snapshot.now, sentAt, receivedAt)
    const fingerprint = pingedFingerprint(screen, snapshot)
    // Ping health: a safety poll found a change, and no ping arrived since the read before it.
    if (poll && previous && fingerprint !== previous.fingerprint && lastPingAt < previous.sentAt) suspectPings()
    previous = { fingerprint, sentAt }
    emit({ snapshot, error: undefined, tallies: settleTallies(snapshot, tallySeqAtSend) })
    syncTopics(snapshot)
    planDeadlines(snapshot)
  }

  // Tallies: the highest pinged count per game and prompt, settled by reads. A
  // read replaces the counts, then the pings that arrived after it was sent
  // are applied again on top (it may not have seen them).
  let tallySeq = 0
  let pingedTallies: { seq: number; game: string; key: string; count: number }[] = []
  let settleTimer: Timer | undefined

  function settleTallies(snapshot: Snapshot, seqAtSend: number): Tallies {
    pingedTallies = pingedTallies.filter((t) => t.seq > seqAtSend)
    let tallies = snapshot.tallies
    for (const t of pingedTallies) if (tallyApplies(snapshot, t.game, t.key)) tallies = withTally(tallies, t.game, t.key, t.count)
    return tallies
  }

  function onTally(payload: Record<string, unknown>) {
    const game = typeof payload.game === 'string' ? payload.game : ''
    const key = typeof payload.key === 'string' ? payload.key : ''
    const count = typeof payload.count === 'number' ? payload.count : NaN
    if (game && key && Number.isFinite(count)) {
      pingedTallies.push({ seq: ++tallySeq, game, key, count })
      if (pingedTallies.length > 1000) pingedTallies.splice(0, pingedTallies.length - 1000)
      if (tallyApplies(state.snapshot, game, key)) {
        const tallies = withTally(state.tallies, game, key, count)
        if (tallies !== state.tallies) emit({ tallies })
      }
    }
    clearTimeout(settleTimer)
    settleTimer = setTimeout(() => schedule(0), TALLY_SETTLE_MS)
  }

  // Ping health.
  let suspectTimer: Timer | undefined
  function suspectPings() {
    if (state.pings === 'unhealthy' || suspectTimer !== undefined) return
    const since = Date.now()
    suspectTimer = setTimeout(() => {
      suspectTimer = undefined
      if (closed || lastPingAt >= since) return
      emit({ pings: 'unhealthy' })
      planPoll()
    }, PING_GRACE_MS)
  }

  function onPing(event: string, payload: Record<string, unknown>) {
    if (closed) return
    lastPingAt = Date.now()
    clearTimeout(suspectTimer)
    suspectTimer = undefined
    if (state.pings === 'unhealthy') {
      emit({ pings: 'ok' })
      planPoll()
    }
    if (event === 'tally') return onTally(payload)
    if (event === 'moved') {
      if (!state.moved) emit({ moved: true })
      return schedule(0)
    }
    if (event === 'changed') {
      // A prompt just opened: every phone reads at once, so the countdowns start together.
      schedule(phone && payload.prompt !== true ? Math.random() * PHONE_JITTER_MS : 0)
    }
  }

  // Channels: joined once a read says member (so they carry the signed-in
  // user's rights), left when a read says not.
  type Joined = { release: () => void; status: TopicStatus; failures: number }
  const topics = new Map<string, Joined>()

  function wantedTopics(snapshot: Snapshot): string[] {
    if (!snapshot.member || !snapshot.exists) return []
    const room = `room:${sessionId}`
    if (!phone) return [room, `stage:${sessionId}`]
    const playerId = options.playerId ?? snapshot.me?.player_id ?? null
    return playerId ? [room, `player:${playerId}`] : [room]
  }

  function syncTopics(snapshot: Snapshot) {
    const want = new Set(wantedTopics(snapshot))
    for (const [topic, joined] of topics) {
      if (want.has(topic)) continue
      topics.delete(topic)
      joined.release()
    }
    for (const topic of want) {
      if (topics.has(topic)) continue
      const joined: Joined = { release: () => {}, status: 'joining', failures: 0 }
      topics.set(topic, joined)
      joined.release = listenTopic(
        client,
        topic,
        { onEvent: onPing, onStatus: (status) => onTopicStatus(topic, joined, status) },
        topic.startsWith('player:') ? PLAYER_REJOIN_SPREAD_MS : 0,
      )
    }
    updateConnected()
  }

  function onTopicStatus(topic: string, joined: Joined, status: TopicStatus) {
    if (closed || topics.get(topic) !== joined) return
    const was = joined.status
    joined.status = status
    if (status === 'joined') {
      joined.failures = 0
      // Joined, or rejoined after a drop: read once, for anything missed meanwhile.
      if (was !== 'joined') schedule(phone ? Math.random() * PHONE_JITTER_MS : 0)
    } else if (status === 'failed') {
      joined.failures++
    }
    updateConnected()
    planPoll()
  }

  function updateConnected() {
    const connected = topics.size > 0 && [...topics.values()].every((t) => t.status === 'joined')
    if (connected !== state.connected) emit({ connected })
  }

  // Safety polls: `interval` after the last read, whatever caused it. A change
  // of interval (a live prompt, failing joins, unhealthy pings) replans from
  // that read, so status changes never postpone a poll.
  let pollTimer: Timer | undefined
  let plannedInterval = 0
  let lastReadAt = Date.now()
  function pollInterval(): number {
    if (state.pings === 'unhealthy' || [...topics.values()].some((t) => t.failures >= FAILED_JOINS)) return FAST_POLL_MS
    if (!phone) return POLL_MS[screen]
    return hasLiveDeadline(state.snapshot) ? PHONE_LIVE_POLL_MS : POLL_MS.phone
  }
  function planPoll(afterRead = false) {
    if (closed) return
    if (afterRead) lastReadAt = Date.now()
    const interval = pollInterval()
    if (!afterRead && pollTimer !== undefined && interval === plannedInterval) return
    clearTimeout(pollTimer)
    plannedInterval = interval
    pollTimer = setTimeout(
      () => {
        pollTimer = undefined
        schedule(0, true)
      },
      Math.max(0, lastReadAt + interval - Date.now()),
    )
  }

  // Phones read once 2 s after each wake_at and closes_at they know of (plus up
  // to 1 s), by the server clock: the moments a lost ping would hurt most.
  const deadlineTimers = new Map<number, Timer>()
  const deadlinesDone = new Set<number>()
  function planDeadlines(snapshot: Snapshot) {
    if (!phone) return
    const now = serverNow()
    const live = liveIds(snapshot)
    const wanted = new Set<number>()
    for (const g of snapshot.games) if (live.has(g.id) && g.wake_at !== null) wanted.add(g.wake_at)
    for (const p of snapshot.prompts) if (live.has(p.game_id) && p.closed_at === null && p.closes_at !== null) wanted.add(p.closes_at)
    for (const [at, timer] of deadlineTimers) {
      if (wanted.has(at)) continue
      clearTimeout(timer)
      deadlineTimers.delete(at)
    }
    for (const at of wanted) {
      if (deadlineTimers.has(at) || deadlinesDone.has(at)) continue
      const delay = at + DEADLINE_DELAY_MS - now
      if (delay < 0) continue
      deadlineTimers.set(
        at,
        setTimeout(() => {
          deadlineTimers.delete(at)
          deadlinesDone.add(at)
          schedule(0, true)
        }, delay + Math.random() * DEADLINE_JITTER_MS),
      )
    }
    for (const at of deadlinesDone) if (at < now - CLOCK_SAMPLE_MAX_AGE_MS) deadlinesDone.delete(at)
  }

  const offVisible = environment.onVisible?.(() => schedule(0))
  const offOnline = environment.onOnline?.(() => schedule(0))
  read(false)

  return {
    refresh: () => schedule(0),
    serverNow,
    close() {
      if (closed) return
      closed = true
      inFlight?.abort()
      for (const timer of [readTimer, settleTimer, suspectTimer, pollTimer, ...deadlineTimers.values()]) clearTimeout(timer)
      deadlineTimers.clear()
      for (const joined of topics.values()) joined.release()
      topics.clear()
      offVisible?.()
      offOnline?.()
    },
  }
}
