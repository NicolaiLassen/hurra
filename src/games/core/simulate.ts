// A party in memory: game_load, game_commit and submit_answer with the same
// rules as the SQL (docs/engine-v2.md, 2.7 and 2.8), around the real step().
// Games are played through it in tests, and the conformance test checks it
// against the SQL (netlify/lib/engine.integration.test.ts).
//
// Every save stores the state and projections through the strict
// jsonbRoundTrip, and every hook gets deep-frozen input, so games meet
// Postgres-shaped data here and a hook that mutates its input fails at once.
import type {
  AnswerPayload,
  AnyGame,
  GameData,
  GameGuest,
  GameInfo,
  GamePlayer,
  LogEntry,
  PlayerId,
  Prompt,
  PromptSpec,
  RecapRound,
} from './Game'
import { canonicalJson, step, type CommitPayload, type EngineRequest, type Loaded, type Step } from './runtime'
import { jsonbRoundTrip, seededRandom } from './testing'

/** A request as a test writes it: the request id is made when left out. */
export type Unsent<R> = R extends unknown ? Omit<R, 'requestId'> & { requestId?: string } : never

/** How long a finished game's final screen holds the TV stage. */
const FINAL_SCREEN_MS = 180_000
/** The party night, 19:00 in Copenhagen. */
const PARTY_NIGHT = 1_795_888_800_000

/**
 * A party in memory. `seed` seeds the games' random (ctx.random); the same
 * seed and the same requests give the same party. Default 7.
 */
export function simulateParty(options: { games: AnyGame[]; players: number; start?: number; seed?: number }): FakeParty {
  return new FakeParty(options)
}

/** A refusal from the in-memory database, with the code the SQL puts in DETAIL. */
export class FakeDbError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'FakeDbError'
    this.status = status
    this.code = code
  }
}

type GameRow = {
  id: string
  game_type: string
  title: string
  status: 'pending' | 'active' | 'finished'
  archived_at: number | null
  public_state: unknown
  started_at: number | null
  finished_at: number | null
  finished_by: 'game' | 'host' | null
  winners: PlayerId[]
  wake_at: number | null
}
type StateRow = { state: unknown; version: number; round: number; config: unknown; members: PlayerId[]; saved_at: number }
type PromptRow = {
  key: string
  round: number
  spec: PromptSpec
  opened_at: number
  closes_at: number | null
  closed_at: number | null
  revealed_at: number | null
}
/** One answer (game_submissions). `answered_by` is the teammate who gave it when submit_answer wrote it for a whole team, null for an answer of one's own. */
type SubRow = { player_id: PlayerId; payload: AnswerPayload; first_at: number; at: number; changes: number; answered_by: PlayerId | null }
/** One answer as a test or the verifier reads it: game_submissions' row. */
export type FakeSubmission = Readonly<SubRow>
/** A team of the party (public.teams): its place is `position`, from 0. */
export type FakeTeam = { id: string; name: string; colour: string; position: number }
/** What submit() gives back. `written` is every player whose answer it wrote: the player alone, or each member of their team it wrote for; none when it changed nothing (`replayed`). */
export type FakeAnswerResult = { accepted: true; replayed?: true; ms: number; written: PlayerId[] }
/** A team's default colour by its place (team_colours()); its default name is Team and the colour. */
const TEAM_COLOURS = ['gold', 'pink', 'teal', 'violet', 'sky', 'lime'] as const
type LogRow = LogEntry & { gameId: string | null; causeId: number | null }
export type FakeFeedItem = {
  id: number
  game_id: string | null
  message: string
  detail: string | null
  audience: PlayerId[] | null
  sound: string | null
  icon: string | null
  tone: string | null
  interrupt: boolean
  created_at: number
}

export class FakeParty {
  now: number
  readonly hostUser = 'host-user'
  /** A paired TV: sync() sends from this user. */
  readonly screenUser = 'screen-user'
  readonly sessionId: string
  /** The guests who joined, in join order: only they play. */
  players: GamePlayer[] = []
  /** Names on the guest list nobody has taken yet (expected guests), in the order the host added them. */
  guests: GamePlayer[] = []
  /** 'room', 'stage', 'stage <prompt key>' (a tally) and 'player <id>', in the order they were sent. */
  pings: string[] = []
  spotlight: string | null = null
  spotlightAt: number | null = null
  tvScene: 'live' | 'recap' = 'live'
  sessionData: GameData = {}
  feed: FakeFeedItem[] = []
  /** Seeded, so a whole simulated party is the same every run. */
  readonly random: () => number

  private readonly logic: Map<string, AnyGame>
  private readonly games = new Map<string, GameRow>()
  private readonly settings = new Map<string, Record<string, unknown>>()
  private readonly states = new Map<string, StateRow>()
  private readonly views = new Map<string, Map<PlayerId, unknown>>()
  private readonly gameScores = new Map<string, Record<PlayerId, number>>()
  private scoreEvents: { id: number; player_id: PlayerId; game_id: string | null; points: number; at: number }[] = []
  private readonly prompts = new Map<string, Map<string, PromptRow>>()
  private readonly subs = new Map<string, Map<PlayerId, SubRow>>()
  private readonly claims = new Set<string>()
  private readonly rows: LogRow[] = []
  private readonly users = new Map<PlayerId, string>()
  private readonly codes = new Map<PlayerId, string>()
  /** When each joined player joined (players.joined_at). */
  private readonly joinedAt = new Map<PlayerId, number>()
  /** The order rows were made in (players.created_at), for game_load's guests. */
  private readonly created = new Map<PlayerId, number>()
  /** Everyone who was ever in the party, with the name they had. */
  private readonly everyone: { id: PlayerId; name: string }[] = []
  private readonly idRandom = seededRandom(4242)
  private pinged = new Set<string>()
  private seq = 0
  private ids = 0
  /** The party's teams (public.teams), by position. None: the party has no teams. */
  private teamRows: FakeTeam[] = []
  /** Each joined player's team (players.team_id). A player in no team, or a guest still expected, isn't here. */
  private teamIds = new Map<PlayerId, string>()
  /** The games played in teams (session_games.team_play). */
  private readonly teamPlay = new Set<string>()
  /** makeTeams's shuffle when it is given none: a stream of its own, so the games' random goes on untouched. */
  private readonly teamRandom = seededRandom(9001)

  constructor({ games, players, start = PARTY_NIGHT, seed = 7 }: { games: AnyGame[]; players: number; start?: number; seed?: number }) {
    this.now = start
    this.random = seededRandom(seed)
    this.logic = new Map(games.map((game) => [game.type, game]))
    this.sessionId = this.uuid()
    for (let i = 1; i <= players; i++) this.addPlayer(`Guest ${i}`, { silent: true })
  }

  /** The (fake) auth user of a player. */
  userOf(playerId: PlayerId): string {
    const user = this.users.get(playerId)
    if (!user) throw new Error(`No player ${playerId} in this party`)
    return user
  }

  /** The player's QR code. */
  codeOf(playerId: PlayerId): string {
    return this.codes.get(playerId) ?? ''
  }

  get log(): LogEntry[] {
    return this.rows.map(entryOf)
  }

  addGame(id: string, type: string, title: string, settings: Record<string, unknown> = {}): void {
    if (this.games.has(id)) throw new Error(`Game ${id} already exists`)
    this.games.set(id, {
      id,
      game_type: type,
      title,
      status: 'pending',
      archived_at: null,
      public_state: null,
      started_at: null,
      finished_at: null,
      finished_by: null,
      winners: [],
      wake_at: null,
    })
    this.settings.set(id, jsonbRoundTrip(settings))
    this.write('game.added', id, null, 'host', null, [], { title, game_type: type })
  }

  /** Changes a pending game's settings, as the host's settings editor does. */
  setSettings(gameId: string, settings: Record<string, unknown>): void {
    this.gameRow(gameId)
    this.settings.set(gameId, jsonbRoundTrip(settings))
  }

  archiveGame(gameId: string, archived = true): void {
    const game = this.gameRow(gameId)
    if (archived && game.status === 'active') throw new FakeDbError(409, 'active', 'End the game before archiving it')
    game.archived_at = archived ? this.now : null
    if (archived && this.spotlight === gameId) this.setSpotlight(null)
  }

  /** The host's "Show on the TV" and "Back to standings". */
  setSpotlight(gameId: string | null): void {
    if (gameId !== this.spotlight) {
      this.spotlight = gameId
      this.spotlightAt = this.now
      this.write('stage.changed', gameId, null, 'host', null, [], { game_id: gameId, reason: 'host' })
    }
    this.beginTx()
    this.ping('room')
  }

  /** One request through the real step(), with game_load and game_commit rules in memory. */
  send(userId: string, request: Unsent<EngineRequest>): Step & { replayed?: boolean } {
    const full = { ...request, requestId: request.requestId ?? `req-${++this.seq}` } as EngineRequest
    const loaded = this.load(full.gameId, userId, full.type === 'host-action' ? (full.close ?? []) : [], full.requestId)
    if (!loaded) return { kind: 'refuse', status: 409, code: 'not_found', message: 'Game not found' }
    // A copy of a saved tap: nothing runs (it would be refused, e.g. "Bo is already out").
    if (loaded.claimed) return { kind: 'skip', replayed: true }
    const logic = this.logic.get(loaded.game.game_type)
    if (!logic) {
      return { kind: 'refuse', status: 409, code: 'unknown_game_type', message: `This app doesn't know the game type ${loaded.game.game_type}` }
    }
    const result = step(logic, loaded, full, { userId, now: loaded.now, random: this.random, round: null })
    if (result.kind !== 'commit') return result
    try {
      const saved = this.commit(result.commit)
      return { ...result, replayed: saved.replayed }
    } catch (error) {
      if (error instanceof FakeDbError && (error.status === 409 || error.status === 404)) {
        return { kind: 'refuse', status: 409, code: error.code as 'not_running', message: error.message }
      }
      throw error
    }
  }

  /**
   * submit_answer's rules in memory. Throws a FakeDbError with .code ('closed',
   * 'already_answered', ...). For a game played in teams and a player in a
   * team, the answer goes to the whole team (submitTeam, as the SQL's
   * submit_team_answer); otherwise it is the player's own, exactly as before teams.
   */
  submit(gameId: string, key: string, playerId: PlayerId, answer: AnswerPayload, afterMs?: number): FakeAnswerResult {
    this.beginTx()
    const prompt = this.prompts.get(gameId)?.get(key)
    if (!prompt) throw new FakeDbError(409, 'closed', 'This question is not open')
    const at = afterMs === undefined ? this.now : prompt.opened_at + afterMs
    if (prompt.closed_at !== null || (prompt.closes_at !== null && prompt.closes_at <= at)) {
      throw new FakeDbError(409, 'closed', 'Too late, answers are closed')
    }
    const game = this.gameRow(gameId)
    if (game.status !== 'active' || game.archived_at !== null) throw new FakeDbError(409, 'not_running', 'This game is not running')
    if (!this.players.some((p) => p.id === playerId)) {
      throw new FakeDbError(403, 'not_player', "You're not a player in this party")
    }
    const normalised = checkAnswer(
      prompt.spec,
      answer,
      this.players.map((p) => p.id),
      playerId,
      this.guestList().map((g) => g.id),
    )
    const subs = this.subs.get(`${gameId}/${key}`) ?? new Map<PlayerId, SubRow>()
    this.subs.set(`${gameId}/${key}`, subs)
    const team = this.teamPlay.has(gameId) ? this.teamOf(playerId) : null
    if (team !== null) return this.submitTeam(gameId, prompt, subs, playerId, team, normalised, at)
    const old = subs.get(playerId)
    if (old && canonicalJson(old.payload) === canonicalJson(normalised)) {
      return { accepted: true, replayed: true, ms: old.first_at - prompt.opened_at, written: [] }
    }
    if (old && 'final' in prompt.spec && prompt.spec.final) throw new FakeDbError(409, 'already_answered', 'You already answered')
    if (old && old.changes >= 20) throw new FakeDbError(409, 'too_many_changes', "That's enough changes for this one")
    this.write('prompt.answered', gameId, prompt.round, 'player', playerId, [playerId], {
      key,
      answer: normalised,
      ms: at - prompt.opened_at,
      round: prompt.round,
    })
    if (old) {
      subs.set(playerId, { ...old, payload: normalised, at, changes: old.changes + 1 })
      return { accepted: true, ms: old.first_at - prompt.opened_at, written: [playerId] }
    }
    subs.set(playerId, { player_id: playerId, payload: normalised, first_at: at, at, changes: 0, answered_by: null })
    this.pings.push(`stage ${key}`)
    return { accepted: true, ms: at - prompt.opened_at, written: [playerId] }
  }

  /**
   * submit_team_answer (the teams migration, section 5): after submit()'s
   * checks, one answer for the whole team. The members are the team's joined
   * players in id order. A final prompt keeps the first answer: once a member
   * of this team gave one, the whole team is locked, members who have an
   * answer keep it and nobody gets a second. Any other prompt takes the
   * latest answer, at most 20 changes for the one who answers. With
   * exclude_self the answer is checked for each member, and a member it
   * doesn't hold for is left out. A new row has the caller's time as its
   * first_at, so the whole team has the same speed.
   */
  private submitTeam(
    gameId: string,
    prompt: PromptRow,
    subs: Map<PlayerId, SubRow>,
    playerId: PlayerId,
    team: string,
    answer: AnswerPayload,
    at: number,
  ): FakeAnswerResult {
    const spec = prompt.spec
    const final = 'final' in spec && spec.final === true
    const each = 'exclude_self' in spec && spec.exclude_self === true
    const members = this.membersOf(team)
    if (!members.includes(playerId)) members.push(playerId)
    const mine = subs.get(playerId)
    // The same answer again (a teammate gave it, or a resend) counts as success.
    if (mine && canonicalJson(mine.payload) === canonicalJson(answer)) {
      return { accepted: true, replayed: true, ms: mine.first_at - prompt.opened_at, written: [] }
    }
    if (final) {
      const locked = members.some((id) => {
        const by = subs.get(id)?.answered_by ?? null
        return by !== null && members.includes(by)
      })
      if (mine || locked) throw new FakeDbError(409, 'already_answered', 'Your team already answered')
    } else if (mine && mine.changes >= 20) {
      throw new FakeDbError(409, 'too_many_changes', "That's enough changes for this one")
    }
    this.write('prompt.answered', gameId, prompt.round, 'player', playerId, [playerId], {
      key: prompt.key,
      answer,
      ms: at - prompt.opened_at,
      round: prompt.round,
      team,
      for: members,
    })
    const playerIds = this.players.map((p) => p.id)
    const guestIds = this.guestList().map((g) => g.id)
    const written: PlayerId[] = []
    let inserted = 0
    for (const member of members) {
      if (each && member !== playerId) {
        try {
          checkAnswer(spec, answer, playerIds, member, guestIds)
        } catch (error) {
          if (error instanceof FakeDbError && error.status === 400) continue
          throw error
        }
      }
      const old = subs.get(member)
      if (!final && old && canonicalJson(old.payload) !== canonicalJson(answer)) {
        subs.set(member, { ...old, payload: answer, at, changes: Math.min(old.changes + 1, 20), answered_by: playerId })
        written.push(member)
        continue
      }
      // A final prompt never overwrites a member who has an answer; nor does the same answer again.
      if (old) continue
      subs.set(member, { player_id: member, payload: answer, first_at: at, at, changes: 0, answered_by: playerId })
      written.push(member)
      inserted++
    }
    // Each teammate's phone reads its answers again; the caller has its reply. The count goes to the stage.
    for (const id of written) if (id !== playerId) this.ping(`player ${id}`)
    if (inserted > 0) this.pings.push(`stage ${prompt.key}`)
    return { accepted: true, ms: subs.get(playerId)!.first_at - prompt.opened_at, written }
  }

  tick(ms: number): void {
    this.now += ms
  }

  /** What the TV does at wake_at: a sync from the paired screen's user. */
  sync(gameId: string): Step {
    return this.send(this.screenUser, { type: 'sync', gameId })
  }

  addPlayer(name: string, { silent = false }: { silent?: boolean } = {}): GamePlayer {
    const player: GamePlayer = { id: this.uuid(), name, profile: {} }
    this.players.push(player)
    this.users.set(player.id, `user-${++this.ids}`)
    this.codes.set(player.id, this.code())
    this.created.set(player.id, this.created.size)
    this.joinedAt.set(player.id, this.now)
    this.everyone.push({ id: player.id, name })
    this.joinSmallestTeam(player.id)
    if (!silent) {
      this.write('player.joined', null, null, 'player', player.id, [player.id], { name, player_id: player.id })
      this.beginTx()
      this.ping('stage')
    }
    return player
  }

  removePlayer(playerId: PlayerId): void {
    const player = this.dropPlayer(playerId)
    this.created.delete(playerId)
    this.write('player.removed', null, null, 'host', playerId, [playerId], { name: player.name, player_id: playerId })
    this.beginTx()
    this.ping('room')
  }

  /** The host adds a name to the guest list (host_add_guests): a guest still expected, who doesn't play. */
  listGuest(name: string): GamePlayer {
    const guest: GamePlayer = { id: this.uuid(), name, profile: {} }
    this.guests.push(guest)
    this.codes.set(guest.id, this.code())
    this.created.set(guest.id, this.created.size)
    this.write('guest.added', null, null, 'host', guest.id, [guest.id], { name, player_id: guest.id })
    this.beginTx()
    this.ping('stage')
    return guest
  }

  /**
   * A phone takes a free name (claim_guest): the guest joins under the id the
   * list gave them. As in the database, join times are whole ms: a name freed
   * and taken again counts as a re-join only when the claim comes at least
   * 1 ms after the game's last save (tick() in between).
   */
  claimGuest(guestId: PlayerId): GamePlayer {
    const guest = this.guests.find((g) => g.id === guestId)
    if (!guest) throw new FakeDbError(409, 'guest_taken', 'Someone just took that name')
    this.guests = this.guests.filter((g) => g.id !== guestId)
    const player: GamePlayer = { id: guest.id, name: guest.name, profile: {} }
    this.players.push(player)
    this.users.set(player.id, `user-${++this.ids}`)
    this.joinedAt.set(player.id, this.now)
    this.everyone.push({ id: player.id, name: player.name })
    this.joinSmallestTeam(player.id)
    this.write('player.joined', null, null, 'player', player.id, [player.id], { name: player.name, player_id: player.id, listed: true })
    this.beginTx()
    this.ping('stage')
    return player
  }

  /**
   * The host frees a name someone took (host_free_guest): everything the taker
   * earned goes (points, scores, views, answers, toasts only they could read),
   * and the guest is back on the list as expected, same id, new code.
   */
  freeGuest(playerId: PlayerId): GamePlayer {
    const player = this.dropPlayer(playerId)
    // Not in the recap's players any more: the row is an expected guest again (session_recap).
    const index = this.everyone.findIndex((p) => p.id === playerId)
    if (index >= 0) this.everyone.splice(index, 1)
    const guest: GamePlayer = { id: player.id, name: player.name, profile: {} }
    this.guests.push(guest)
    this.codes.set(guest.id, this.code())
    for (const item of this.feed) {
      if (item.audience?.includes(playerId)) item.audience = item.audience.filter((id) => id !== playerId)
    }
    this.feed = this.feed.filter((item) => item.audience === null || item.audience.length > 0)
    this.write('player.freed', null, null, 'host', playerId, [playerId], { name: player.name, player_id: playerId })
    this.beginTx()
    this.ping('room')
    return guest
  }

  /** Everyone on the guest list, joined or not, as game_load gives it (by when the row was made). */
  guestList(): GameGuest[] {
    const joined = new Set(this.players.map((p) => p.id))
    return [...this.players, ...this.guests]
      .sort((a, b) => (this.created.get(a.id) ?? 0) - (this.created.get(b.id) ?? 0))
      .map((p) => ({ id: p.id, name: p.name, joined: joined.has(p.id) }))
  }

  /** What deleting a player's row takes with it through the foreign keys. */
  private dropPlayer(playerId: PlayerId): GamePlayer {
    const player = this.players.find((p) => p.id === playerId)
    if (!player) throw new Error(`No player ${playerId} in this party`)
    this.players = this.players.filter((p) => p.id !== playerId)
    this.users.delete(playerId)
    this.joinedAt.delete(playerId)
    // The row goes, and its team with it: a freed name comes back in no team.
    this.teamIds.delete(playerId)
    for (const views of this.views.values()) views.delete(playerId)
    for (const [gameId, scores] of this.gameScores) {
      const rest = { ...scores }
      delete rest[playerId]
      this.gameScores.set(gameId, rest)
    }
    this.scoreEvents = this.scoreEvents.filter((e) => e.player_id !== playerId)
    for (const subs of this.subs.values()) subs.delete(playerId)
    return player
  }

  // Teams (docs/user-flows.md, Teams; the teams migration) ---------------------------

  /** The party's teams, by position. None: the party has no teams. */
  get teams(): FakeTeam[] {
    return this.teamRows.map((t) => ({ ...t }))
  }

  /** A player's team, or null: in no team (a guest still expected is in none). */
  teamOf(playerId: PlayerId): string | null {
    return this.teamIds.get(playerId) ?? null
  }

  /** A team's joined members in id order, as submit_answer reads them. */
  membersOf(teamId: string): PlayerId[] {
    return this.players
      .map((p) => p.id)
      .filter((id) => this.teamIds.get(id) === teamId)
      .sort(byteOrder)
  }

  /** Whether a game is played in teams (session_games.team_play). */
  teamPlayOf(gameId: string): boolean {
    this.gameRow(gameId)
    return this.teamPlay.has(gameId)
  }

  /**
   * host_make_teams: `count` teams (2 to 6), and the guests who are here
   * shuffled and dealt round the teams in order, so sizes differ by one at
   * most. Made again, teams up to the new count keep their names and colours,
   * the rest go, new ones take the first colour no team has, and everyone is
   * dealt again. Guests still expected stay out of every team until they join.
   * `random` is the shuffle (the database's random()); one of the party's own
   * when left out. Refused while a game played in teams is live.
   */
  makeTeams(count: number, random: () => number = this.teamRandom): FakeTeam[] {
    if (!Number.isInteger(count) || count < 2 || count > 6) throw new FakeDbError(400, 'bad_count', 'Make 2 to 6 teams')
    this.refuseWhileTeamGameLive('make new')
    this.teamRows = this.teamRows.slice(0, count).map((t, i) => ({ ...t, position: i }))
    const kept = new Set(this.teamRows.map((t) => t.id))
    for (const [id, team] of [...this.teamIds]) if (!kept.has(team)) this.teamIds.delete(id)
    while (this.teamRows.length < count) {
      const colour = TEAM_COLOURS.find((c) => !this.teamRows.some((t) => t.colour === c))!
      const name = `Team ${colour[0].toUpperCase()}${colour.slice(1)}`
      this.teamRows.push({ id: this.uuid(), name, colour, position: this.teamRows.length })
    }
    const here = this.players.map((p) => p.id)
    for (let i = here.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[here[i], here[j]] = [here[j], here[i]]
    }
    here.forEach((id, n) => this.teamIds.set(id, this.teamRows[n % count].id))
    this.write('teams.made', null, null, 'host', null, [], {
      count,
      teams: this.teamRows.map((t) => ({ id: t.id, name: t.name, colour: t.colour, members: this.membersOf(t.id) })),
    })
    this.beginTx()
    this.ping('room')
    return this.teams
  }

  /**
   * host_move_to_team: a guest who is here into a team of the party, or into
   * none (null). Allowed while a game is live: from their next answer on, they
   * answer with their new team. True when it changed anything.
   */
  setTeam(playerId: PlayerId, teamId: string | null): boolean {
    const player = this.players.find((p) => p.id === playerId)
    if (!player) {
      const guest = this.guests.find((g) => g.id === playerId)
      if (guest) throw new FakeDbError(409, 'not_joined', `${guest.name} hasn't joined yet. They go into a team when they join.`)
      throw new FakeDbError(404, 'not_found', "That guest isn't in the party any more")
    }
    const team = teamId === null ? null : this.teamRows.find((t) => t.id === teamId)
    if (team === undefined) throw new FakeDbError(404, 'team_not_found', 'That team is gone')
    const from = this.teamOf(playerId)
    if (from === teamId) return false
    if (teamId === null) this.teamIds.delete(playerId)
    else this.teamIds.set(playerId, teamId)
    this.write('team.joined', null, null, 'host', playerId, [playerId], {
      player_id: playerId,
      name: player.name,
      team_id: teamId,
      team: team?.name ?? null,
      from,
    })
    this.beginTx()
    this.ping('room')
    return true
  }

  /** host_clear_teams: every team goes and everyone is in none; games keep team play and play alone until there are teams again. */
  clearTeams(): number {
    this.refuseWhileTeamGameLive('clear the')
    const count = this.teamRows.length
    this.teamRows = []
    this.teamIds.clear()
    if (count > 0) {
      this.write('teams.cleared', null, null, 'host', null, [], { count })
      this.beginTx()
      this.ping('room')
    }
    return count
  }

  /** host_set_team_play: whether a game is played in teams, changed only while it isn't live. True when it changed. */
  setTeamPlay(gameId: string, on: boolean): boolean {
    const game = this.gameRow(gameId)
    if (game.status === 'active') throw new FakeDbError(409, 'active', `Team play can't change while ${game.title} is live`)
    if (this.teamPlay.has(gameId) === on) return false
    if (on) this.teamPlay.add(gameId)
    else this.teamPlay.delete(gameId)
    this.write('game.team_play', gameId, null, 'host', null, [], { title: game.title, team_play: on })
    this.beginTx()
    this.ping('room')
    return true
  }

  /** Making or clearing teams while a game played in teams is live would change who answers for whom in the middle of it. */
  private refuseWhileTeamGameLive(what: string) {
    const live = [...this.games.values()].find((g) => g.status === 'active' && g.archived_at === null && this.teamPlay.has(g.id))
    if (live) throw new FakeDbError(409, 'team_game_live', `End ${live.title} before you ${what} teams`)
  }

  /**
   * join_smallest_team: while the party has teams, a guest who joins goes into
   * the team with the fewest joined members; a tie goes to the lowest position.
   */
  private joinSmallestTeam(playerId: PlayerId) {
    if (this.teamRows.length === 0 || this.teamIds.has(playerId)) return
    let smallest = this.teamRows[0]
    let fewest = Infinity
    for (const team of this.teamRows) {
      const size = this.players.filter((p) => p.id !== playerId && this.teamIds.get(p.id) === team.id).length
      if (size < fewest) {
        smallest = team
        fewest = size
      }
    }
    this.teamIds.set(playerId, smallest.id)
  }

  /** A host award (score_events with this game's id), as the award page gives it. */
  award(playerId: PlayerId, points: number, gameId: string | null = null, reason: string | null = null): void {
    if (!this.players.some((p) => p.id === playerId)) throw new Error(`No player ${playerId} in this party`)
    if (!Number.isInteger(points) || points === 0) throw new Error('Points must be a whole number other than 0')
    const id = this.scoreEvents.length + 1
    this.scoreEvents.push({ id, player_id: playerId, game_id: gameId, points, at: this.now })
    this.write('points.awarded', gameId, null, 'host', playerId, [playerId], {
      player_id: playerId,
      points,
      reason,
      game_id: gameId,
      score_event_id: id,
    })
    this.beginTx()
    this.ping('stage')
    this.ping(`player ${playerId}`)
  }

  game(id: string): {
    status: string
    finishedBy: string | null
    winners: PlayerId[]
    publicState: unknown
    views: Record<PlayerId, unknown>
    scores: Record<PlayerId, number>
    wakeAt: number | null
    round: number
  } {
    const game = this.gameRow(id)
    return {
      status: game.status,
      finishedBy: game.finished_by,
      winners: [...game.winners],
      publicState: game.public_state,
      views: Object.fromEntries(this.views.get(id) ?? []),
      scores: { ...this.gameScores.get(id) },
      wakeAt: game.wake_at,
      round: this.states.get(id)?.round ?? 0,
    }
  }

  /** The full state and frozen settings of a game's round, as the host page sees them. */
  stateOf(gameId: string): { state: unknown; config: unknown; round: number; members: PlayerId[] } | null {
    const st = this.states.get(gameId)
    return st ? { state: st.state, config: st.config, round: st.round, members: [...st.members] } : null
  }

  /** This round's prompts, as screens see them. */
  promptsOf(gameId: string): Prompt[] {
    const round = this.states.get(gameId)?.round
    return [...(this.prompts.get(gameId)?.values() ?? [])]
      .filter((p) => p.round === round)
      .map((p) => ({
        key: p.key,
        spec: p.spec,
        openedAt: p.opened_at,
        closesAt: p.closes_at,
        closedAt: p.closed_at,
        revealedAt: p.revealed_at,
      }))
  }

  /** A player's own answers this round, by prompt key. */
  answersOf(gameId: string, playerId: PlayerId): Record<string, AnswerPayload> {
    const out: Record<string, AnswerPayload> = {}
    for (const prompt of this.promptsOf(gameId)) {
      const sub = this.subs.get(`${gameId}/${prompt.key}`)?.get(playerId)
      if (sub) out[prompt.key] = sub.payload
    }
    return out
  }

  /** Every answer to one of the game's prompts, as game_submissions holds them, in player id order. */
  submissionsOf(gameId: string, key: string): FakeSubmission[] {
    return [...(this.subs.get(`${gameId}/${key}`)?.values() ?? [])]
      .sort((a, b) => byteOrder(a.player_id, b.player_id))
      .map((row) => ({ ...row }))
  }

  /** Answer counts of the game's unrevealed prompts. */
  talliesOf(gameId: string): Record<string, number> {
    const out: Record<string, number> = {}
    for (const prompt of this.promptsOf(gameId)) {
      if (prompt.revealedAt === null) out[prompt.key] = this.subs.get(`${gameId}/${prompt.key}`)?.size ?? 0
    }
    return out
  }

  /** What the round's hooks see as info right now (the conformance and contract checks use it). */
  infoOf(gameId: string): GameInfo<unknown> | null {
    const st = this.states.get(gameId)
    if (!st) return null
    const loaded = this.peek(gameId)
    return {
      gameId,
      round: st.round,
      session: { id: this.sessionId, name: 'Party', data: loaded.session.data },
      players: loaded.players.map((p) => ({ id: p.id, name: p.name, profile: p.profile })),
      guests: loaded.guests ?? [],
      scoreboard: loaded.scoreboard,
      config: st.config,
      now: this.now,
      prompts: Object.fromEntries(this.promptsOf(gameId).map((p) => [p.key, p])),
      answers: {},
    }
  }

  /** Each round of the game, as the recap builder hands them to recap(). */
  recapRounds(gameId: string): RecapRound<unknown, unknown>[] {
    const game = this.gameRow(gameId)
    return this.rows
      .filter((row) => row.gameId === gameId && row.kind === 'game.started')
      .map((started) => {
        const finished = this.rows.find(
          (row) => row.gameId === gameId && row.kind === 'game.finished' && row.round === started.round,
        )
        const st = this.states.get(gameId)
        const live = !finished && st?.round === started.round
        return {
          gameId,
          title: game.title,
          round: started.round ?? 0,
          finished: finished !== undefined,
          startedAt: started.at,
          finishedAt: finished?.at ?? null,
          finishedBy: (finished?.data.by as 'game' | 'host' | undefined) ?? null,
          config: started.data.config,
          state: finished ? finished.data.state : live ? st!.state : null,
          winners: finished ? [...((finished.data.winners as PlayerId[]) ?? [])] : [],
          players: this.everyone.map((p) => ({ ...p })),
          points: finished
            ? { ...(finished.data.points as Record<PlayerId, number>) }
            : this.roundPoints(gameId, started.at),
          log: this.rows.filter((row) => row.gameId === gameId && row.round === started.round).map(entryOf),
        }
      })
  }

  /**
   * Every table back from JSON text, as a server that restarted would read
   * them: fresh objects in jsonb key order, nothing shared with what the
   * hooks saw before. A game that keeps anything outside its saved state, or
   * that relies on an object it handed back being the one it gets, shows it
   * here. The games' random stream goes on where it was.
   */
  reload(): void {
    const back = <T>(value: T): T => deepFreeze(jsonbRoundTrip(JSON.parse(JSON.stringify(value)) as T))
    for (const [id, row] of this.games) this.games.set(id, { ...row, public_state: back(row.public_state), winners: [...row.winners] })
    for (const [id, settings] of this.settings) this.settings.set(id, jsonbRoundTrip(JSON.parse(JSON.stringify(settings))))
    for (const [id, st] of this.states) this.states.set(id, back(st))
    for (const [id, views] of this.views) this.views.set(id, new Map([...views].map(([player, view]) => [player, back(view)])))
    for (const [id, prompts] of this.prompts) {
      this.prompts.set(id, new Map([...prompts].map(([key, row]) => [key, { ...row, spec: back(row.spec) }])))
    }
    for (const [id, subs] of this.subs) this.subs.set(id, new Map([...subs].map(([player, row]) => [player, back(row)])))
    this.players = this.players.map((p) => ({ ...p, profile: jsonbRoundTrip(JSON.parse(JSON.stringify(p.profile))) }))
    this.sessionData = jsonbRoundTrip(JSON.parse(JSON.stringify(this.sessionData)))
    // The teams and who is in which, read back as they were.
    this.teamRows = JSON.parse(JSON.stringify(this.teamRows)) as FakeTeam[]
    this.teamIds = new Map(JSON.parse(JSON.stringify([...this.teamIds])) as [PlayerId, string][])
  }

  // game_load ------------------------------------------------------------------

  private load(gameId: string, userId: string, close: string[], requestId: string): Loaded | null {
    if (!this.games.has(gameId)) return null
    this.beginTx()
    let closed = 0
    for (const prompt of this.prompts.get(gameId)?.values() ?? []) {
      if (prompt.closed_at !== null) continue
      // Only a host's close counts. Each close is logged here, as game_load does.
      let by: 'host' | 'timer' | null = null
      if (userId === this.hostUser && close.includes(prompt.key)) {
        prompt.closed_at = this.now
        by = 'host'
      } else if (prompt.closes_at !== null && prompt.closes_at <= this.now) {
        prompt.closed_at = prompt.closes_at
        by = 'timer'
      }
      if (by === null) continue
      closed++
      this.write('prompt.closed', gameId, prompt.round, by, null, [], { key: prompt.key, round: prompt.round, closed_at: prompt.closed_at })
    }
    if (closed > 0) this.ping('room')
    const loaded = this.peek(gameId)
    return deepFreeze({
      ...loaded,
      claimed: this.claims.has(`${userId}/${requestId}`),
      caller: {
        player_id: [...this.users].find(([, user]) => user === userId)?.[0] ?? null,
        is_host: userId === this.hostUser,
        is_screen: userId === this.screenUser,
      },
    })
  }

  /** What game_load reads, without closing anything. */
  private peek(gameId: string): Loaded {
    const game = this.gameRow(gameId)
    const st = this.states.get(gameId)
    const promptRows = [...(this.prompts.get(gameId)?.values() ?? [])].filter((p) => p.round === st?.round)
    return deepFreeze({
      now: this.now,
      claimed: false,
      game: {
        id: game.id,
        session_id: this.sessionId,
        game_type: game.game_type,
        title: game.title,
        status: game.status,
        archived_at: game.archived_at,
        wake_at: game.wake_at,
      },
      settings: structuredClone(this.settings.get(gameId) ?? {}),
      current: st
        ? { state: st.state, version: st.version, round: st.round, config: st.config, members: [...st.members], saved_at: st.saved_at }
        : null,
      session: { id: this.sessionId, name: 'Party', data: structuredClone(this.sessionData), spotlight_game_id: this.spotlight },
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        profile: structuredClone(p.profile),
        joined_at: this.joinedAt.get(p.id) ?? this.now,
      })),
      guests: this.guestList(),
      caller: { player_id: null, is_host: false, is_screen: false },
      scoreboard: this.scoreboard(),
      awards: this.awards(gameId, game.started_at),
      prompts: Object.fromEntries(
        promptRows.map((p) => [
          p.key,
          {
            spec: p.spec,
            opened_at: p.opened_at,
            closes_at: p.closes_at,
            closed_at: p.closed_at,
            revealed_at: p.revealed_at,
            submissions:
              p.closed_at !== null && p.revealed_at === null
                ? [...(this.subs.get(`${gameId}/${p.key}`)?.values() ?? [])]
                    .sort((a, b) => a.first_at - b.first_at || (a.player_id < b.player_id ? -1 : 1))
                    .map((s) => ({
                      player_id: s.player_id,
                      answer: s.payload,
                      first_at: s.first_at,
                      at: s.at,
                      ms: s.first_at - p.opened_at,
                      changes: s.changes,
                    }))
                : null,
          },
        ]),
      ),
    })
  }

  // game_commit ----------------------------------------------------------------

  private commit(p: CommitPayload): { replayed: boolean } {
    this.beginTx()
    const game = this.games.get(p.game_id)
    if (!game) throw new FakeDbError(404, 'not_found', 'Game not found')
    const st = this.states.get(game.id)
    const starting = p.request.type === 'start'
    const finishing = p.status === 'finished'
    const wakeBefore = game.wake_at
    const claim = `${p.request.user_id}/${p.request.id}`
    if (this.claims.has(claim)) return { replayed: true }
    if (starting && game.archived_at !== null) throw new FakeDbError(409, 'archived', 'Unarchive this game before starting it')
    if (starting && game.status === 'active') throw new FakeDbError(409, 'already_running', 'This game is already running')
    if (!starting && (game.status !== 'active' || !st)) throw new FakeDbError(409, 'not_running', 'This game is not running')
    if (!starting && p.expected_round !== null && st!.round !== p.expected_round) {
      throw new FakeDbError(409, 'restarted', 'The game was restarted')
    }
    if (!starting && st!.version !== p.expected_version) throw new FakeDbError(409, 'stale', 'Game state changed concurrently')

    // Everything is stored as Postgres would give it back (this throws on what jsonb refuses).
    const state = deepFreeze(jsonbRoundTrip(p.state))
    const publicState = 'public_state' in p ? deepFreeze(jsonbRoundTrip(p.public_state)) : game.public_state
    const views = p.player_views ? jsonbRoundTrip(p.player_views) : undefined
    const config = starting ? deepFreeze(jsonbRoundTrip(p.config ?? {})) : st!.config

    this.claims.add(claim)
    const round = starting ? (st?.round ?? 0) + 1 : st!.round
    const present = new Set(this.players.map((pl) => pl.id))
    let room = false
    const touched = new Set<PlayerId>()
    const cause = this.write(
      { start: 'game.start', end: 'game.end', action: 'game.action', 'host-action': 'game.host_action', sync: 'game.sync' }[
        p.request.type
      ],
      game.id,
      round,
      p.request.actor,
      p.request.player_id,
      p.request.player_id ? [p.request.player_id] : [],
      p.request.type === 'start'
        ? { stage: p.stage }
        : p.request.type === 'action'
          ? { action: p.request.action }
          : p.request.type === 'host-action'
            ? { action: p.request.action, close: p.request.close ?? [] }
            : p.request.type === 'sync'
              ? { woke: p.log.woke }
              : {},
    )

    // State.
    if (starting) {
      this.states.set(game.id, { state, version: (st?.version ?? 0) + 1, round, config, members: [...p.members], saved_at: this.now })
      this.prompts.set(game.id, new Map())
      for (const key of [...this.subs.keys()]) if (key.startsWith(`${game.id}/`)) this.subs.delete(key)
    } else {
      this.states.set(game.id, { ...st!, state, version: st!.version + 1, members: [...p.members], saved_at: this.now })
    }

    // Projections, for players still in the party.
    if (views) {
      const stored = this.views.get(game.id) ?? new Map<PlayerId, unknown>()
      for (const [id, view] of Object.entries(views)) {
        if (!present.has(id)) continue
        if (!stored.has(id) || canonicalJson(stored.get(id)) !== canonicalJson(view)) {
          stored.set(id, deepFreeze(view))
          touched.add(id)
        }
      }
      this.views.set(game.id, stored)
    }
    const scoreChanges: Record<PlayerId, number> = {}
    if (p.scores) {
      const before = this.gameScores.get(game.id) ?? {}
      const after: Record<PlayerId, number> = {}
      for (const [id, points] of Object.entries(p.scores)) if (present.has(id)) after[id] = points
      for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
        const delta = (after[id] ?? 0) - (before[id] ?? 0)
        if (delta !== 0) scoreChanges[id] = delta
      }
      this.gameScores.set(game.id, after)
      if (Object.keys(scoreChanges).length > 0) room = true
    }

    // Effects.
    const points = p.effects.points.filter((e) => present.has(e.player_id) && e.points !== 0)
    for (const e of points) {
      this.scoreEvents.push({ id: this.scoreEvents.length + 1, player_id: e.player_id, game_id: game.id, points: e.points, at: this.now })
    }
    if (points.length > 0) room = true
    const profiles: Record<PlayerId, Record<string, unknown>> = {}
    for (const [id, patch] of Object.entries(p.effects.profiles)) {
      const player = this.players.find((pl) => pl.id === id)
      if (!player) continue
      const before = player.profile[game.game_type]
      const after = jsonbRoundTrip({ ...before, ...patch })
      if (canonicalJson(before) !== canonicalJson(after)) {
        player.profile = { ...player.profile, [game.game_type]: after }
        profiles[id] = patch
        room = true
      }
    }
    let sessionData: Record<string, unknown> | undefined
    if (p.effects.session_data) {
      const before = this.sessionData[game.game_type]
      const after = jsonbRoundTrip({ ...before, ...p.effects.session_data })
      if (canonicalJson(before) !== canonicalJson(after)) {
        this.sessionData = { ...this.sessionData, [game.game_type]: after }
        sessionData = p.effects.session_data
        room = true
      }
    }
    const announcements: unknown[] = []
    for (const a of p.effects.announcements) {
      if (!a.message) continue
      const audience = a.to ? a.to.filter((id) => present.has(id)) : null
      if (audience && audience.length === 0) continue
      const item: FakeFeedItem = {
        id: this.feed.length + 1,
        game_id: game.id,
        message: a.message,
        detail: a.detail ?? null,
        audience,
        sound: a.sound ?? null,
        icon: a.icon ?? null,
        tone: a.tone ?? null,
        interrupt: a.interrupt === true,
        created_at: this.now,
      }
      this.feed.push(item)
      announcements.push(jsonbRoundTrip({ ...a, ...(audience ? { to: audience } : {}) }))
      if (audience) audience.forEach((id) => touched.add(id))
      else room = true
    }
    for (const r of p.effects.records) {
      this.write('game.record', game.id, round, 'game', null, [...r.about], jsonbRoundTrip({ type: r.type, ...r.data }), cause)
    }

    // Prompts.
    const prompts = this.prompts.get(game.id)!
    const opened: string[] = []
    const closed: string[] = []
    const revealed: string[] = []
    for (const o of p.effects.prompts.open) {
      if (prompts.has(o.key)) throw new Error(`duplicate key value violates game_prompts_pkey (${o.key})`)
      prompts.set(o.key, {
        key: o.key,
        round,
        spec: deepFreeze(jsonbRoundTrip(o.spec)),
        opened_at: this.now,
        closes_at: o.closes_at ?? null,
        closed_at: null,
        revealed_at: null,
      })
      opened.push(o.key)
    }
    for (const prompt of prompts.values()) {
      if (prompt.closed_at !== null) continue
      if (finishing || p.effects.prompts.close.includes(prompt.key) || p.effects.prompts.reveal.includes(prompt.key)) {
        prompt.closed_at = this.now
        closed.push(prompt.key)
      }
    }
    for (const key of p.effects.prompts.reveal) {
      const prompt = prompts.get(key)
      if (prompt && prompt.revealed_at === null) {
        prompt.revealed_at = this.now
        revealed.push(key)
      }
    }
    if (opened.length + closed.length + revealed.length > 0) room = true

    // The game row, only when a value changes.
    const wake = finishing ? null : p.wake_at
    const winners = finishing ? [...(p.winners ?? [])] : starting ? [] : game.winners
    if (
      p.status !== null ||
      canonicalJson(publicState) !== canonicalJson(game.public_state) ||
      wake !== game.wake_at ||
      canonicalJson(winners) !== canonicalJson(game.winners)
    ) {
      game.public_state = publicState
      if (p.status) game.status = p.status
      if (starting) {
        game.started_at = this.now
        game.finished_at = null
        game.finished_by = null
      }
      if (finishing) {
        game.finished_at = this.now
        game.finished_by = p.finished_by ?? 'host'
      }
      game.winners = winners
      game.wake_at = wake
      room = true
    }

    // Log rows.
    const effects = stripEmpty({
      announcements,
      points,
      profiles,
      session_data: sessionData,
      scores: scoreChanges,
      prompts: stripEmpty({ opened, closed, revealed }),
      members: stripEmpty({ joined: p.log.joined, left: p.log.left }),
      woke: p.log.woke || undefined,
    })
    if (Object.keys(effects).length > 0) {
      this.write('game.effects', game.id, round, 'game', null, [...new Set([...touched, ...Object.keys(scoreChanges)])], effects, cause)
    }
    if (starting) {
      this.write('game.started', game.id, round, 'game', null, [...p.members], {
        title: game.title,
        game_type: game.game_type,
        config,
        state,
        public_state: publicState,
        members: [...p.members],
      }, cause)
    }
    if (finishing) {
      this.write('game.finished', game.id, round, p.finished_by === 'game' ? 'game' : 'host', null, [...winners], {
        title: game.title,
        game_type: game.game_type,
        by: p.finished_by ?? 'host',
        winners,
        state,
        public_state: publicState,
        scores: { ...this.gameScores.get(game.id) },
        points: this.roundPoints(game.id, game.started_at ?? this.now),
      }, cause)
    }
    if (p.log.wake_stuck) this.write('game.wake_stuck', game.id, round, 'game', null, [], { wake_at: wakeBefore }, cause)

    // The TV stage.
    if (starting && p.stage === 'take') {
      if (this.spotlight !== game.id || this.tvScene !== 'live') room = true
      if (this.spotlight !== game.id) {
        this.spotlight = game.id
        this.spotlightAt = this.now
        this.write('stage.changed', game.id, round, 'host', null, [], { game_id: game.id, title: game.title, reason: 'start' }, cause)
      }
      if (this.tvScene !== 'live') this.write('session.tv_scene', null, null, 'host', null, [], { tv_scene: 'live', reason: 'start' }, cause)
      this.tvScene = 'live'
    } else if (starting && p.stage === 'keep' && this.spotlight === game.id) {
      this.spotlight = null
      this.spotlightAt = this.now
      this.write('stage.changed', null, null, 'host', null, [], { game_id: null, title: null, reason: 'start' }, cause)
      room = true
    } else if (finishing && this.spotlight !== game.id && this.stageIsFree()) {
      this.spotlight = game.id
      this.spotlightAt = this.now
      this.write('stage.changed', game.id, round, 'game', null, [], { game_id: game.id, title: game.title, reason: 'finish' }, cause)
      room = true
    }

    // One ping.
    if (room) this.ping('room')
    else if (touched.size > 10) this.ping('room')
    else {
      for (const id of touched) this.ping(`player ${id}`)
      this.ping('stage')
    }
    return { replayed: false }
  }

  // Helpers ----------------------------------------------------------------------

  private stageIsFree(): boolean {
    if (this.spotlight === null) return true
    const spot = this.games.get(this.spotlight)
    if (!spot || spot.archived_at !== null) return true
    if (spot.status === 'active') return false
    if (spot.status === 'finished') {
      return this.now > Math.max(spot.finished_at ?? 0, this.spotlightAt ?? 0) + FINAL_SCREEN_MS
    }
    return true
  }

  private scoreboard(): Record<PlayerId, number> {
    const totals: Record<PlayerId, number> = {}
    for (const player of this.players) totals[player.id] = 0
    for (const e of this.scoreEvents) if (e.player_id in totals) totals[e.player_id] += e.points
    for (const scores of this.gameScores.values()) {
      for (const [id, points] of Object.entries(scores)) if (id in totals) totals[id] += points
    }
    return totals
  }

  private awards(gameId: string, startedAt: number | null): Record<PlayerId, number> {
    const out: Record<PlayerId, number> = {}
    if (startedAt === null) return out
    for (const e of this.scoreEvents) {
      if (e.game_id === gameId && e.at >= startedAt) out[e.player_id] = (out[e.player_id] ?? 0) + e.points
    }
    return out
  }

  private roundPoints(gameId: string, startedAt: number): Record<PlayerId, number> {
    const out: Record<PlayerId, number> = { ...this.gameScores.get(gameId) }
    for (const [id, points] of Object.entries(this.awards(gameId, startedAt))) out[id] = (out[id] ?? 0) + points
    return out
  }

  private gameRow(id: string): GameRow {
    const game = this.games.get(id)
    if (!game) throw new Error(`No game ${id} in this party`)
    return game
  }

  private write(
    kind: string,
    gameId: string | null,
    round: number | null,
    actor: LogEntry['actor'],
    playerId: PlayerId | null,
    about: PlayerId[],
    data: Record<string, unknown>,
    causeId: number | null = null,
  ): number {
    const id = this.rows.length + 1
    this.rows.push({
      id,
      at: this.now,
      kind,
      round,
      actor,
      playerId,
      about,
      data: deepFreeze(jsonbRoundTrip(data)),
      gameId,
      causeId,
    })
    return id
  }

  private beginTx() {
    this.pinged = new Set()
  }

  /** At most one 'changed' per topic per transaction; a stage or player ping after a room ping is skipped. */
  private ping(topic: string) {
    if (this.pinged.has(topic)) return
    if ((topic === 'stage' || topic.startsWith('player ')) && this.pinged.has('room')) return
    this.pinged.add(topic)
    this.pings.push(topic)
  }

  private uuid(): string {
    const hex = Array.from({ length: 32 }, () => Math.floor(this.idRandom() * 16).toString(16)).join('')
    const variant = '89ab'[Math.floor(this.idRandom() * 4)]
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  }

  private code(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    return Array.from({ length: 5 }, () => alphabet[Math.floor(this.idRandom() * alphabet.length)]).join('')
  }
}

/**
 * check_answer() in TypeScript: validates and normalises an answer against a
 * prompt spec, with the same rules and messages (docs/engine-v2.md, 2.7).
 * Throws a FakeDbError with code 'answer_invalid'.
 */
export function checkAnswer(
  spec: PromptSpec,
  payload: unknown,
  playerIds: readonly PlayerId[],
  playerId: PlayerId,
  /** Everyone on the guest list, joined or not, for options 'guests'. The players when left out. */
  guestIds: readonly PlayerId[] = playerIds,
): AnswerPayload {
  const invalid = (message: string) => new FakeDbError(400, 'answer_invalid', message)
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload) || JSON.stringify(payload).length > 2048) {
    throw invalid('That answer is not valid')
  }
  const input = payload as Record<string, unknown>
  if (spec.kind === 'choice') {
    const choice = typeof input.choice === 'string' ? [input.choice] : Array.isArray(input.choice) ? input.choice : null
    if (!choice || choice.length === 0) throw invalid('Pick an option')
    const options =
      spec.options === 'players' || spec.options === 'guests'
        ? (spec.options === 'players' ? playerIds : guestIds).filter((id) => !(spec.exclude_self && id === playerId))
        : spec.options
    if (choice.some((c) => typeof c !== 'string' || !options.includes(c))) throw invalid('That is not one of the options')
    if (new Set(choice).size !== choice.length) throw invalid('Pick each option only once')
    const min = spec.min ?? 1
    const max = spec.max ?? 1
    if (choice.length < min || choice.length > max) throw invalid(min === max ? `Pick ${min}` : `Pick ${min} to ${max}`)
    return { choice: [...(choice as string[])].sort(byteOrder) }
  }
  if (spec.kind === 'number') {
    if (typeof input.value !== 'number' || !Number.isFinite(input.value)) throw invalid('Enter a number')
    const value = input.value
    if (value < spec.min || value > spec.max || (spec.integer && !Number.isInteger(value))) {
      throw invalid('That number is out of range')
    }
    return { value }
  }
  if (spec.kind === 'text') {
    const max = spec.max_length ?? 80
    if (typeof input.text !== 'string') throw invalid(`Answers are 1 to ${max} characters`)
    const text = input.text.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')
    if (text === '' || Array.from(text).length > max) throw invalid(`Answers are 1 to ${max} characters`)
    return { text }
  }
  throw invalid('This question takes no answers')
}

/** A log row as recap() sees it, without the in-memory bookkeeping. */
function entryOf(row: LogRow): LogEntry {
  return {
    id: row.id,
    at: row.at,
    kind: row.kind,
    round: row.round,
    actor: row.actor,
    playerId: row.playerId,
    about: row.about,
    data: row.data,
  }
}

/** Postgres's collate "C": bytewise. */
function byteOrder(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0
}

function stripEmpty(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => {
      if (value === undefined || value === null) return false
      if (Array.isArray(value)) return value.length > 0
      if (typeof value === 'object') return Object.keys(value as object).length > 0
      return true
    }),
  )
}

/** Freezes a value and everything in it, so a hook that mutates its input throws. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item)
  }
  return value
}
