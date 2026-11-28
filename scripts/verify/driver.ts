// One simulated party for one game (docs/developing.md, "The game mechanic
// verifier"): the party plays the game through simulateParty and the real
// step(), its guests played by the game's bot and the verifier's own moves,
// its host by the bot's steps and random ones, while guests join, leave, have
// their names freed and taken again, the host restarts the round, the TV's
// timer syncs come on time, late or early, and every table is reloaded from
// JSON now and then. After every engine call the game's oracle compares. In
// teams, the host makes teams before the start and switches team play on, and
// moves a guest to another team or out of every team now and then; guests
// pick their own team before the start and between rounds, and a guest who
// tries to switch mid round is refused.
import { createHash } from 'node:crypto'
import type { GameBot } from '../../src/games/core/bot'
import type { AnswerPayload, AnyGame, GamePlayer, PlayerId } from '../../src/games/core/Game'
import { canonicalJson, type Step } from '../../src/games/core/runtime'
import { FakeDbError, simulateParty, type FakeParty, type FakeSubmission } from '../../src/games/core/simulate'
import {
  Rng,
  type Adapter,
  type Call,
  type Invariant,
  type Membership,
  type Oracle,
  type Run,
  type Snapshot,
} from './core'

export const GAME_ID = 'verify'

/** Invented names, some with Danish letters and accents, so name matching is exercised. Never a real guest's. */
const NAMES = [
  'Ana', 'Bo', 'Cy', 'Dag', 'Eli', 'Fay', 'Gry', 'Hal', 'Ivo', 'Jo', 'Kåre', 'Løv', 'Mæja', 'Noé', 'Ørn', 'Pia',
  'Quin', 'Rut', 'Søs', 'Tor', 'Uma', 'Vic', 'Wes', 'Xia', 'Yrsa', 'Zoë', 'Åse', 'Æbbe', 'Ana Maria', 'Bo Erik',
]
/** Names the guest list holds for guests who haven't come yet. */
const EXPECTED = ['Ulla Vent', 'Otto Senere', 'Ines Snart', 'Arne Sen', 'Bente Måske', 'Carl Kommer', 'Dina Venter', 'Egon Nok']

export type RunOptions = {
  /** Compare with the oracle after every call (off for the second run of a determinism pair). */
  checks: boolean
  /** Reload every table from JSON now and then, from a random of its own. */
  reloads: boolean
  /**
   * Play in teams: 2 to 4 teams made before the start (and now and then again
   * between rounds), team play on, a guest moved now and then; every choice
   * of it from a random of its own. Left out: alone, as always.
   */
  teams?: boolean
}

export type RunResult = {
  game: string
  size: number
  seed: number
  failures: Map<Invariant, { message: string; trace: string[] }>
  hash: string
  /** How the run's rounds finished. */
  endings: ('game' | 'host')[]
  calls: number
  ms: number
  /** What happened, for the coverage lines. */
  counts: Map<string, number>
}

const MAX_TICKS = 900
const TRACE_LINES = 14

export function runParty(adapter: Adapter, logic: AnyGame, bot: GameBot, size: number, seed: number, options: RunOptions): RunResult {
  const started = performance.now()
  const rng = new Rng(seed * 2654435761)
  const reloadRng = new Rng(seed * 40503 + 17)
  const teamRng = new Rng(seed * 69069 + 7)
  const teams = options.teams === true
  // The games' ctx.random: Park-Miller wants 1 to 2^31 - 2.
  const party = simulateParty({ games: [logic], players: 0, seed: 1 + ((seed * 7919) % 2147483000) })
  const failures = new Map<Invariant, { message: string; trace: string[] }>()
  const traceLines: string[] = []
  const hash = createHash('sha1')
  const endings: ('game' | 'host')[] = []
  const counts = new Map<string, number>()
  const count = (what: string, n = 1) => counts.set(what, (counts.get(what) ?? 0) + n)
  let calls = 0

  // Who is who: an id's occupant number goes up when the id leaves, so a freed name's next guest is someone new.
  const epochs = new Map<PlayerId, number>()
  /** Freed names that may be taken again. */
  const freed: PlayerId[] = []
  /** Ids in the last committed save; what the engine compares the party with. */
  let members = new Set<PlayerId>()
  /** Ids freed and taken again since the last committed save (the engine sees them leave and join). */
  const rejoined = new Set<PlayerId>()
  /** Someone joined or left since the last committed save. */
  let dirty = false
  /** The host's awards per present guest: the day's ledger, which a removal or a free deletes. */
  const ledger = new Map<PlayerId, number>()
  /** In teams: each guest in a team at the round's start who hasn't left, been freed or moved since, with that team. */
  const steady = new Map<PlayerId, string>()

  for (let i = 0; i < size; i++) party.addPlayer(NAMES[i] ?? `Guest ${i + 1}`, { silent: true })
  const listed = Math.min(EXPECTED.length, 1 + rng.int(3) + Math.floor(size / 8))
  for (const name of EXPECTED.slice(0, listed)) party.listGuest(name)
  let joinedCount = size

  const run: Run = {
    game: adapter.type,
    size,
    seed,
    rng,
    party,
    gameId: GAME_ID,
    logic,
    bot,
    teams,
    round: 0,
    fail(invariant, message) {
      if (!options.checks && invariant !== 'no-exception') return
      if (!failures.has(invariant)) failures.set(invariant, { message, trace: traceLines.slice(-TRACE_LINES) })
    },
    trace,
    present: () => party.players,
    expected: () => party.guests,
    config: <T>() => party.stateOf(GAME_ID)?.config as T,
    state: <T>() => party.stateOf(GAME_ID)?.state as T,
    publicState: <T>() => party.game(GAME_ID).publicState as T,
    views: () => party.game(GAME_ID).views,
    scores: () => party.game(GAME_ID).scores,
    prompts: () => party.promptsOf(GAME_ID),
    answers: (id) => party.answersOf(GAME_ID, id),
    nameOf: (id) => party.players.find((p) => p.id === id)?.name ?? party.guests.find((g) => g.id === id)?.name ?? id.slice(0, 6),
    epoch: (id) => epochs.get(id) ?? 0,
    fresh: () => !dirty,
    count,
  }

  function trace(line: string) {
    traceLines.push(`+${((party.now - t0) / 1000).toFixed(1)}s ${line}`)
    if (traceLines.length > 200) traceLines.splice(0, 100)
  }
  const t0 = party.now

  let oracle: Oracle | null = null
  const settings = adapter.settings(run)
  party.addGame(GAME_ID, adapter.type, 'Verify round', settings)
  trace(`${size} guests, ${listed} more on the guest list`)
  if (teams) {
    party.setTeamPlay(GAME_ID, true)
    makeTeams('the host makes')
    guestsPick('before the start')
  }

  // ---------------------------------------------------------------------------

  function snapshot(): Snapshot {
    const game = party.game(GAME_ID)
    return {
      now: party.now,
      state: party.stateOf(GAME_ID)?.state ?? null,
      publicState: game.publicState,
      present: party.players.map((p) => p.id),
      prompts: party.promptsOf(GAME_ID),
    }
  }

  /** What the save that commits now picks up: leaves (with ids freed and taken again), then joins. */
  function membershipNow(): Membership {
    const present = party.players.map((p) => p.id)
    const here = new Set(present)
    const again = [...rejoined].filter((id) => members.has(id) && here.has(id))
    return {
      left: [...[...members].filter((id) => !here.has(id)), ...again],
      joined: present.filter((id) => !members.has(id) || again.includes(id)),
    }
  }

  /** One engine call, checked. */
  function call(what: Call, label: string, send: () => Step & { replayed?: boolean }): Step & { replayed?: boolean } {
    calls++
    const before = snapshot()
    const pending = membershipNow()
    const statusBefore = party.game(GAME_ID).status
    let result: Step & { replayed?: boolean }
    try {
      result = send()
    } catch (error) {
      run.fail('no-exception', `${label} threw: ${describe(error)}`)
      trace(`${label} → THREW ${describe(error)}`)
      return { kind: 'refuse', status: 409, code: 'internal', message: describe(error) }
    }
    const committed = result.kind === 'commit' && !result.replayed
    trace(`${label} → ${result.kind}${result.kind === 'refuse' ? ` ${result.code} "${result.message}"` : ''}${result.replayed ? ' (replayed)' : ''}`)
    if (result.kind === 'refuse') count('refusals')
    if (result.kind === 'refuse') {
      const fine = ['rule', 'not_running', 'bad_request', 'already_running'].includes(result.code)
      if (!fine) run.fail('no-exception', `${label} was refused with ${result.status} ${result.code}: ${result.message}`)
    }
    if (committed) {
      members = new Set(party.players.map((p) => p.id))
      rejoined.clear()
      dirty = false
    }
    const game = party.game(GAME_ID)
    if (oracle) {
      try {
        oracle.after(what, result, pending, before)
        if (statusBefore === 'active' && game.status === 'finished') {
          endings.push(game.finishedBy === 'game' ? 'game' : 'host')
          oracle.finished(game.finishedBy === 'game' ? 'game' : 'host')
          if (teams) for (const id of steady.keys()) if (oracle.apart?.(id)) count('teammates scored apart by the rules')
        }
        if (options.checks) {
          oracle.check()
          genericChecks(what, result)
          if (teams) teamChecks()
        }
      } catch (error) {
        run.fail('no-exception', `the oracle failed after ${label}: ${describe(error)}`)
      }
    }
    hash.update(
      canonicalJson({
        label,
        kind: result.kind,
        code: result.kind === 'refuse' ? result.code : null,
        status: game.status,
        round: game.round,
        winners: game.winners,
        wakeAt: game.wakeAt,
        publicState: game.publicState,
        views: game.views,
        scores: game.scores,
        feed: party.feed.length,
        last: party.feed.at(-1) ?? null,
      }),
    )
    return result
  }

  function genericChecks(what: Call, result: Step) {
    const game = party.game(GAME_ID)
    const present = new Set(party.players.map((p) => p.id))
    for (const [id, points] of Object.entries(game.scores)) {
      if (!present.has(id)) run.fail('scores-match-oracle', `game_scores holds ${id.slice(0, 6)}, who isn't in the party`)
      if (!Number.isInteger(points)) run.fail('payouts-within-limits', `a score isn't a whole number: ${points}`)
    }
    // The day's scoreboard is the ledger plus this game's scores (the party plays only this game).
    const board = party.infoOf(GAME_ID)?.scoreboard ?? {}
    for (const p of party.players) {
      const want = (ledger.get(p.id) ?? 0) + (game.scores[p.id] ?? 0)
      if ((board[p.id] ?? 0) !== want) {
        run.fail('payouts-within-limits', `${p.name} has ${board[p.id] ?? 0} on the day's scoreboard, the ledger and the game give ${want}`)
      }
    }
    if (game.status === 'active') {
      if (result.kind === 'commit') {
        for (const p of party.players) if (!(p.id in game.views)) run.fail('no-exception', `${p.name} has no view after a save`)
      }
      if (what.kind === 'sync' && result.kind === 'commit' && game.wakeAt !== null && game.wakeAt <= party.now) {
        run.fail('finishes-cleanly', `after a sync the timer is still due (wakeAt ${game.wakeAt - party.now} ms from now)`)
      }
    }
  }

  /**
   * In teams: every steady member of a team has the team's answer to every
   * prompt, with the same first time, and the same points in the game, but
   * where the game's own rules tell them apart (oracle.apart).
   */
  function teamChecks() {
    if (!oracle) return
    const byTeam = new Map<string, PlayerId[]>()
    for (const [id, team] of steady) byTeam.set(team, [...(byTeam.get(team) ?? []), id])
    const rows = party.promptsOf(GAME_ID).map((prompt) => ({
      key: prompt.key,
      rows: new Map(party.submissionsOf(GAME_ID, prompt.key).map((row) => [row.player_id, row])),
    }))
    const shown = (row: FakeSubmission | undefined) => (row ? `${canonicalJson(row.payload)} at +${row.first_at - t0} ms` : 'nothing')
    const scores = party.game(GAME_ID).scores
    for (const ids of byTeam.values()) {
      const [first, ...rest] = ids
      for (const prompt of rows) {
        const want = prompt.rows.get(first)
        for (const id of rest) {
          const got = prompt.rows.get(id)
          if (canonicalJson(got?.payload ?? null) !== canonicalJson(want?.payload ?? null) || got?.first_at !== want?.first_at) {
            run.fail('team-members-equal', `${run.nameOf(first)} and ${run.nameOf(id)}, teammates all round, have ${prompt.key} as ${shown(want)} and ${shown(got)}`)
          }
        }
      }
      const alike = ids.filter((id) => !oracle!.apart?.(id))
      if (new Set(alike.map((id) => scores[id] ?? 0)).size > 1) {
        run.fail('team-members-equal', `teammates all round end with different points: ${alike.map((id) => `${run.nameOf(id)} ${scores[id] ?? 0}`).join(', ')}`)
      }
    }
  }

  // Engine calls --------------------------------------------------------------

  function start(): boolean {
    // A new round has a new oracle: the last one's rules end with its round.
    oracle = null
    const result = call({ kind: 'start' }, 'host start', () => party.send(party.hostUser, { type: 'start', gameId: GAME_ID }))
    if (result.kind === 'refuse') return false
    run.round = party.game(GAME_ID).round
    members = new Set(party.players.map((p) => p.id))
    rejoined.clear()
    dirty = false
    steady.clear()
    if (teams) {
      for (const p of party.players) {
        const team = party.teamOf(p.id)
        if (team !== null) steady.set(p.id, team)
      }
    }
    oracle = adapter.begin(run)
    if (options.checks) oracle.check()
    return true
  }

  function end() {
    call({ kind: 'end' }, 'host end', () => party.send(party.hostUser, { type: 'end', gameId: GAME_ID }))
  }

  function sync(label = 'tv sync') {
    call({ kind: 'sync' }, label, () => party.sync(GAME_ID))
  }

  function hostStep() {
    const step = oracle?.host()
    if (!step) return
    const requestId = `host-${calls}-${rng.int(1e9)}`
    const label = `host ${JSON.stringify(step.action)}${step.close?.length ? ` close ${step.close.join(',')}` : ''}${step.note ? ` (${step.note})` : ''}`
    const send = () =>
      party.send(party.hostUser, { type: 'host-action', gameId: GAME_ID, action: step.action, close: step.close, requestId })
    const first = call({ kind: 'host', action: step.action, close: step.close ?? [] }, label, send)
    // A double tap: the same request again is a copy of a saved one and changes nothing.
    if (rng.chance(0.04) && party.game(GAME_ID).status === 'active') {
      const copy = call({ kind: 'host', action: step.action, close: step.close ?? [] }, `${label} again (double tap)`, send)
      if (first.kind === 'commit' && !(copy.kind === 'skip' && copy.replayed)) {
        run.fail('no-exception', `a double tap of ${label} was not a replay of the saved one (${copy.kind})`)
      }
    }
  }

  function guestMoves() {
    for (const player of rng.shuffle(party.players)) {
      if (party.game(GAME_ID).status !== 'active' || !oracle) return
      if (!party.players.some((p) => p.id === player.id)) continue
      const move = oracle.guest(player.id)
      if (!move) continue
      if (move.kind === 'action') {
        call({ kind: 'action', playerId: player.id, action: move.action }, `${player.name} ${JSON.stringify(move.action)}${move.note ? ` (${move.note})` : ''}`, () =>
          party.send(party.userOf(player.id), { type: 'action', gameId: GAME_ID, action: move.action }),
        )
      } else {
        submit(player, move.key, move.answer, move.note)
      }
    }
  }

  function submit(player: GamePlayer, key: string, answer: AnswerPayload, note?: string) {
    try {
      const result = party.submit(GAME_ID, key, player.id, answer)
      count('answers taken')
      // Everyone the database wrote it for: the player alone, or their team; nobody for a replay.
      for (const id of result.written) oracle?.answered(id, key, answer, player.id)
      const others = result.written.filter((id) => id !== player.id).length
      if (teams) {
        if (others > 0) count('answers written for teammates', others)
        hash.update(`=${result.written.join(',')}`)
      }
      trace(`${player.name} answers ${key} ${JSON.stringify(answer)}${note ? ` (${note})` : ''}${others > 0 ? ` for ${others} teammates too` : ''}`)
    } catch (error) {
      if (!(error instanceof FakeDbError)) {
        run.fail('no-exception', `submit ${key} threw: ${describe(error)}`)
        return
      }
      count('answers refused')
      trace(`${player.name} answers ${key} → ${error.code}`)
    }
    hash.update(`${key}:${player.id}:${canonicalJson(answer)}`)
  }

  // Membership ----------------------------------------------------------------

  function leave(how: 'removed' | 'freed') {
    if (party.players.length === 0) return
    const player = rng.pick(party.players)
    count(how === 'removed' ? 'removals' : 'names freed')
    if (how === 'removed') party.removePlayer(player.id)
    else {
      party.freeGuest(player.id)
      freed.push(player.id)
    }
    dirty = true
    epochs.set(player.id, run.epoch(player.id) + 1)
    rejoined.delete(player.id)
    ledger.delete(player.id)
    steady.delete(player.id)
    oracle?.dropped(player.id)
    trace(`${player.name} ${how === 'removed' ? 'is removed by the host' : 'has their name freed by the host'}`)
    // The host page syncs every live game right after; now and then that sync doesn't land.
    if (oracle && party.game(GAME_ID).status === 'active') {
      if (rng.chance(0.8)) sync('host page sync after it')
      else count('syncs after a removal lost')
    }
  }

  function join(how: 'new' | 'listed' | 'retake') {
    dirty = true
    if (how === 'new') {
      joinedCount++
      const player = party.addPlayer(NAMES[joinedCount - 1] ?? `Guest ${joinedCount}`)
      count('joins')
      trace(`${player.name} joins`)
      return
    }
    // A name taken from the list joins at least 1 ms after the last save, as any real tap does.
    party.tick(1 + rng.int(5))
    if (how === 'retake') {
      const id = freed.splice(rng.int(freed.length), 1)[0]
      if (!party.guests.some((g) => g.id === id)) return
      const player = party.claimGuest(id)
      count('freed names taken again')
      if (members.has(id)) rejoined.add(id)
      trace(`someone new takes the freed name ${player.name}`)
      return
    }
    const waiting = party.guests.filter((g) => !freed.includes(g.id))
    if (waiting.length === 0) return
    const player = party.claimGuest(rng.pick(waiting).id)
    count('names taken from the list')
    trace(`${player.name} arrives and takes their name from the list`)
  }

  // Teams ---------------------------------------------------------------------

  /** The host makes 2 to 4 teams of everyone here (allowed only while the round isn't live). */
  function makeTeams(how: string) {
    const n = teamRng.between(2, 4)
    party.makeTeams(n, teamRng.fn())
    count('teams made')
    trace(`${how} ${n} teams: ${party.teams.map((t) => `${t.name} ${party.membersOf(t.id).map(run.nameOf).join('/')}`).join(', ')}`)
  }

  /** The host moves a guest into another team, or out of every team, mid-round. */
  function moveSomeone() {
    const player = teamRng.pick(party.players)
    const from = party.teamOf(player.id)
    const others = party.teams.filter((t) => t.id !== from)
    const to = from !== null && (others.length === 0 || teamRng.chance(0.2)) ? null : (teamRng.pick(others)?.id ?? null)
    if (!party.setTeam(player.id, to)) return
    steady.delete(player.id)
    count(to === null ? 'guests moved out of every team' : 'guests moved to another team')
    trace(`the host moves ${player.name} ${to === null ? 'out of every team' : `to ${party.teams.find((t) => t.id === to)!.name}`}`)
  }

  /** Between rounds, a few guests pick another team on their phone (choose_team). */
  function guestsPick(when: string) {
    const n = teamRng.int(Math.min(4, party.players.length) + 1)
    for (let i = 0; i < n; i++) {
      const player = teamRng.pick(party.players)
      const others = party.teams.filter((t) => t.id !== party.teamOf(player.id))
      if (others.length === 0) continue
      const to = teamRng.pick(others)
      if (!party.chooseTeam(player.id, to.id)) continue
      steady.delete(player.id)
      count('guests who picked another team')
      trace(`${when}, ${player.name} picks ${to.name}`)
    }
  }

  /** Mid round, a guest tries to switch team: refused while the round, played in teams, is live. */
  function triesToSwitch() {
    const player = teamRng.pick(party.players)
    const other = teamRng.pick(party.teams.filter((t) => t.id !== party.teamOf(player.id)))
    if (!other) return
    try {
      party.chooseTeam(player.id, other.id)
      run.fail('team-members-equal', `${player.name} switched to ${other.name} while the round, played in teams, was live`)
    } catch (error) {
      if (!(error instanceof FakeDbError) || error.code !== 'team_game_live') throw error
      count('switches refused mid round')
    }
  }

  function chaos() {
    if (teams && party.players.length > 0 && teamRng.chance(0.008)) moveSomeone()
    if (teams && party.players.length > 0 && teamRng.chance(0.004)) triesToSwitch()
    const r = rng.next() / (adapter.churn ?? 1)
    const big = party.players.length > 30
    if (r < 0.012) join('new')
    else if (r < 0.022) join('listed')
    else if (r < 0.032 && party.players.length > 1) leave('removed')
    else if (r < 0.044 && party.players.length > 1) leave('freed')
    else if (r < 0.064 && freed.length > 0) join('retake')
    else if (r < 0.072 && party.players.length > 0) {
      // A host award on the day's ledger; with the in-person round's id for that round.
      const player = rng.pick(party.players)
      const points = rng.chance(0.85) ? rng.between(1, 5) : -rng.between(1, 3)
      const gameId = adapter.type === 'in-person' ? GAME_ID : null
      party.award(player.id, points, gameId)
      ledger.set(player.id, (ledger.get(player.id) ?? 0) + points)
      count('host awards')
      oracle?.awarded?.(player.id, points, gameId)
      trace(`the host gives ${player.name} ${points} points${gameId ? ' in this round' : ''}`)
    } else if (r < 0.085) sync('tv sync (early or extra)')
    if (big && rng.chance(0.5)) return
  }

  // The night -------------------------------------------------------------------

  const minPlayers = adapter.minPlayers ?? 1
  let attempts = 0
  while (!start()) {
    attempts++
    if (attempts > 3 || party.players.length >= minPlayers + 2) {
      run.fail('no-exception', `the start was refused with ${party.players.length} guests`)
      break
    }
    // Too few to start (Last one standing needs two): one more guest comes.
    join('new')
  }

  const restartAt = rng.chance(0.35) ? rng.between(20, 220) : -1
  let restarted = false
  for (let tick = 0; tick < MAX_TICKS && oracle; tick++) {
    const game = party.game(GAME_ID)
    if (game.status !== 'active') {
      if (restartAt >= 0 && !restarted) {
        restarted = true
        party.tick(5000)
        count('restarts')
        trace('the host starts the round again after it finished')
        if (teams && teamRng.chance(0.5)) makeTeams('between rounds the host makes')
        if (teams) guestsPick('between rounds')
        if (!start()) break
        continue
      }
      break
    }
    if (tick === restartAt && !restarted) {
      restarted = true
      count('restarts')
      trace('the host restarts the round')
      end()
      party.tick(1000)
      if (teams && teamRng.chance(0.5) && party.game(GAME_ID).status !== 'active') makeTeams('between rounds the host makes')
      if (teams && party.game(GAME_ID).status !== 'active') guestsPick('between rounds')
      if (!start()) break
      continue
    }
    chaos()
    // The host's End can come at any moment of a round.
    if (rng.chance(adapter.endChance ?? 0.0015)) {
      count('End mid-round')
      end()
      continue
    }
    if (options.reloads && reloadRng.chance(0.04)) {
      party.reload()
      count('reloads')
      trace('every table reloaded from JSON')
    }
    guestMoves()
    if (party.game(GAME_ID).status === 'active' && rng.chance(0.75)) hostStep()
    const roll = rng.next()
    party.tick(roll < 0.8 ? 1000 : roll < 0.95 ? rng.between(200, 3000) : rng.between(10_000, 90_000))
    const wake = party.game(GAME_ID).wakeAt
    if (party.game(GAME_ID).status === 'active' && wake !== null && wake <= party.now) {
      if (rng.chance(0.85)) {
        count('timer syncs')
        sync()
      } else count('timer syncs late')
    }
  }

  // A round still going ends with the host's End, as the host would.
  if (oracle && party.game(GAME_ID).status === 'active') end()
  if (oracle && options.checks) afterTheEnd()

  function afterTheEnd() {
    const game = party.game(GAME_ID)
    if (game.status !== 'finished') {
      run.fail('finishes-cleanly', `the round is ${game.status} after End`)
      return
    }
    if (party.log.some((row) => row.kind === 'game.wake_stuck')) run.fail('finishes-cleanly', 'a timer got stuck (game.wake_stuck in the log)')
    const someone = party.players[0]
    if (someone) {
      const late = party.send(party.userOf(someone.id), { type: 'action', gameId: GAME_ID, action: {} })
      if (!(late.kind === 'refuse' && late.status === 409 && late.code === 'not_running')) {
        run.fail('finishes-cleanly', `a move after the finish was answered ${late.kind}${late.kind === 'refuse' ? ` ${late.code}` : ''}`)
      }
    }
    const host = party.send(party.hostUser, { type: 'host-action', gameId: GAME_ID, action: { type: 'finish' } })
    if (!(host.kind === 'refuse' && (host.code === 'not_running' || host.code === 'bad_request'))) {
      run.fail('finishes-cleanly', `a host step after the finish was answered ${host.kind}`)
    }
    if (party.sync(GAME_ID).kind !== 'skip') run.fail('finishes-cleanly', 'a sync after the finish did something')
    oracle?.check()
    if (teams) teamChecks()
  }

  return { game: adapter.type, size, seed, failures, hash: hash.digest('hex'), endings, calls, ms: performance.now() - started, counts }
}

export function describe(error: unknown): string {
  if (error instanceof Error) return `${error.message}${error.stack ? ` @ ${error.stack.split('\n')[1]?.trim() ?? ''}` : ''}`
  return String(error)
}

export type { FakeParty }
