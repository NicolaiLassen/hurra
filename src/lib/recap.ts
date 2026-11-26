// The recap of the night (docs/engine-v2.md, 5.7). The host's browser reads
// the raw material with session_recap() (hosts only), builds one room-safe
// document here, and publishes it to session_recaps; the TV plays it and every
// phone shows "Your night".
//
// Room-safe even when built mid-party, while rounds still run with live tasks
// and answer keys: a game's recap() hook runs only for finished rounds, a round
// still running gets a generic chapter, and no round's raw state or config
// ever goes into the doc.
//
// Pure and deterministic, with relative imports only: the rehearsal builds the
// same doc under Node.
import { ANNOUNCEMENT_ICONS, type AnnouncementIcon, type AnyGame, type Highlight, type LogEntry, type RecapRound, type Tone } from '../games/core/Game'
import type { GameData, GameStatus } from './types'

/** session_recap() output (section 2.7). Every time is epoch ms. */
export type RawRecap = {
  session: { id: string; name: string; created_at: number; archived_at: number | null }
  players: { id: string; name: string; joined_at: number; removed_at: number | null; profile: GameData }[]
  games: { id: string; title: string; game_type: string; position: number; status: GameStatus }[]
  rounds: {
    game_id: string
    round: number
    started_at: number
    finished_at: number | null
    finished_by: 'game' | 'host' | null
    config: unknown
    state: unknown
    public_state: unknown
    scores: Record<string, number>
    points: Record<string, number>
    winners: string[]
  }[]
  log: {
    id: number
    at: number
    kind: string
    game_id: string | null
    game_type: string | null
    round: number | null
    actor: LogEntry['actor']
    player_id: string | null
    about: string[]
    data: Record<string, unknown>
  }[]
  standings: { player_id: string; name: string; points: number }[]
}

export type RecapDoc = {
  version: 1
  session: { id: string; name: string }
  generatedAt: number
  numbers: { guests: number; games: number; answers: number; moves: number; awards: number }
  chapters: {
    gameId: string
    gameType: string
    title: string
    round: number
    startedAt: number
    finishedAt: number | null
    finishedBy: 'game' | 'host' | null
    winners: { id: string; name: string }[]
    highlights: Highlight[]
  }[]
  /** The race: cumulative totals of the final top 8, sampled to at most 120 points. */
  race: { at: number; totals: Record<string, number> }[]
  leadChanges: { at: number; playerId: string; name: string }[]
  podium: { playerId: string; name: string; points: number }[]
  standings: { playerId: string; name: string; points: number; rank: number }[]
  players: Record<
    string,
    {
      name: string
      rank: number
      points: number
      byGame: { gameId: string; title: string; points: number }[]
      moments: Highlight[]
    }
  >
  timeline: { at: number; text: string; detail?: string; icon?: AnnouncementIcon; gameId?: string }[]
}

const RACE_PLAYERS = 8
const RACE_POINTS = 120
const LEAD_CHANGE_QUIET_MS = 15 * 60_000
const TIMELINE_ENTRIES = 60

const ICONS: readonly string[] = ANNOUNCEMENT_ICONS
const TONES: readonly string[] = ['gold', 'pink', 'teal', 'violet', 'red']
const WEIGHTS: readonly string[] = ['headline', 'highlight', 'line']

/** "Ana", "Ana and Bo", "Ana, Bo and Cy", "Ana, Bo, Cy and 2 more". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length > 3) return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

const pointsText = (n: number) => `${n} point${n === 1 || n === -1 ? '' : 's'}`

/** Competition ranks (1, 2, 2, 4) over rows sorted by points, highest first. */
function ranked<T extends { points: number }>(rows: readonly T[]): (T & { rank: number })[] {
  let rank = 0
  return rows.map((row, i) => {
    if (i === 0 || row.points !== rows[i - 1].points) rank = i + 1
    return { ...row, rank }
  })
}

/** The players with the most points, all tied ones; none when the top is 0 or below. */
function leaders(points: Readonly<Record<string, number>>): string[] {
  let best = 0
  let top: string[] = []
  for (const [id, value] of Object.entries(points)) {
    if (value > best) {
      best = value
      top = [id]
    } else if (value === best && best > 0) {
      top.push(id)
    }
  }
  return top
}

/** Only a highlight's own fields, checked: the doc's shape stays the documented one whatever a hook returns. */
function cleanHighlight(input: unknown): Highlight | null {
  if (input === null || typeof input !== 'object') return null
  const h = input as Record<string, unknown>
  if (typeof h.title !== 'string' || h.title.trim() === '') return null
  const out: Highlight = { title: h.title }
  if (typeof h.detail === 'string' && h.detail !== '') out.detail = h.detail
  if (Array.isArray(h.players)) out.players = h.players.filter((p): p is string => typeof p === 'string')
  if (typeof h.at === 'number' && Number.isFinite(h.at)) out.at = h.at
  if (typeof h.icon === 'string' && ICONS.includes(h.icon)) out.icon = h.icon as AnnouncementIcon
  if (typeof h.tone === 'string' && TONES.includes(h.tone)) out.tone = h.tone as Tone
  if (typeof h.weight === 'string' && WEIGHTS.includes(h.weight)) out.weight = h.weight as Highlight['weight']
  return out
}

const add = (map: Map<string, number>, key: string, value: number) => map.set(key, (map.get(key) ?? 0) + value)

function numberOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Builds the room-safe recap. `options.now` stamps generatedAt; by default it
 * is the newest log row's time, so the same raw recap always builds the same doc.
 */
export function buildRecapDoc(raw: RawRecap, logic: ReadonlyMap<string, AnyGame>, options: { now?: number } = {}): RecapDoc {
  const names = new Map(raw.players.map((p) => [p.id, p.name]))
  for (const row of raw.standings) if (!names.has(row.player_id)) names.set(row.player_id, row.name)
  const nameOf = (id: string) => names.get(id) ?? 'Someone'
  const everyone = raw.players.map((p) => ({ id: p.id, name: p.name }))
  const games = new Map(raw.games.map((g) => [g.id, g]))
  const log = [...raw.log].sort((a, b) => a.id - b.id)
  const generatedAt = options.now ?? log[log.length - 1]?.at ?? raw.session.created_at

  // Chapters: one per round of a game still in the party, in start order.
  const chapters: RecapDoc['chapters'] = []
  for (const round of raw.rounds) {
    const game = games.get(round.game_id)
    if (!game) continue
    const finished = round.finished_at !== null
    // Winners are a tie, not a ranking: by name, so the line reads the same whatever order they come in.
    const winners = finished ? [...round.winners].sort((a, b) => nameOf(a).localeCompare(nameOf(b))) : []
    let highlights: Highlight[] = []
    if (finished) {
      const roundLog: LogEntry[] = log
        .filter((e) => e.game_id === round.game_id && e.round === round.round)
        .map((e) => ({ id: e.id, at: e.at, kind: e.kind, round: e.round, actor: e.actor, playerId: e.player_id, about: e.about, data: e.data }))
      const recapRound: RecapRound<unknown, unknown> = {
        gameId: round.game_id,
        title: game.title,
        round: round.round,
        finished: true,
        startedAt: round.started_at,
        finishedAt: round.finished_at,
        finishedBy: round.finished_by,
        config: round.config,
        state: round.state,
        winners,
        players: everyone,
        points: round.points,
        log: roundLog,
      }
      try {
        const fromHook = logic.get(game.game_type)?.recap?.(recapRound)
        if (Array.isArray(fromHook)) highlights = fromHook.map(cleanHighlight).filter((h): h is Highlight => h !== null)
      } catch {
        // A game's broken hook never breaks the night's recap: its chapter gets the generic line.
        highlights = []
      }
      if (highlights.length === 0) {
        highlights = [
          winners.length > 0
            ? { title: `${listNames(winners.map(nameOf))} won ${game.title}`, players: [...winners], icon: 'crown', weight: 'headline' }
            : { title: `${game.title} is over`, weight: 'headline' },
        ]
      }
    } else {
      // Still running: no game hook sees it, so no live task or answer key can leak.
      const top = leaders(round.points)
      highlights = [
        {
          title: 'Still running',
          ...(top.length > 0 ? { detail: `Leading so far: ${listNames(top.map(nameOf))} with ${round.points[top[0]]}`, players: top } : {}),
          weight: 'headline',
        },
      ]
    }
    chapters.push({
      gameId: round.game_id,
      gameType: game.game_type,
      title: game.title,
      round: round.round,
      startedAt: round.started_at,
      finishedAt: round.finished_at,
      finishedBy: finished ? round.finished_by : null,
      winners: winners.map((id) => ({ id, name: nameOf(id) })),
      highlights,
    })
  }

  // The race: replay the log's points in order.
  const top = raw.standings.slice(0, RACE_PLAYERS).map((r) => r.player_id)
  const totals = new Map<string, number>()
  const gamePoints = new Map<string, Map<string, number>>()
  const gameScores = new Map<string, Map<string, number>>()
  const forGame = (map: Map<string, Map<string, number>>, gameId: string) => {
    let inner = map.get(gameId)
    if (!inner) map.set(gameId, (inner = new Map()))
    return inner
  }
  const steps: { at: number; totals: Map<string, number> }[] = []
  const leadChanges: RecapDoc['leadChanges'] = []
  let leader: string | null = null
  const firstStart = Math.min(...raw.rounds.map((r) => r.started_at))
  let anchor: number | null = Number.isFinite(firstStart) ? firstStart : null

  for (const e of log) {
    let scored = false
    const award = (playerId: unknown, points: unknown, gameId: string | null) => {
      const value = numberOf(points)
      if (typeof playerId !== 'string' || value === 0) return
      add(totals, playerId, value)
      if (gameId) add(forGame(gamePoints, gameId), playerId, value)
      scored = true
    }
    if (e.kind === 'game.effects' && e.game_id) {
      const scores = e.data.scores
      if (scores && typeof scores === 'object') {
        for (const [playerId, delta] of Object.entries(scores as Record<string, unknown>)) {
          award(playerId, delta, e.game_id)
          if (numberOf(delta) !== 0) add(forGame(gameScores, e.game_id), playerId, numberOf(delta))
        }
      }
      if (Array.isArray(e.data.points)) {
        for (const p of e.data.points as { player_id?: unknown; points?: unknown }[]) award(p?.player_id, p?.points, e.game_id)
      }
    } else if (e.kind === 'points.awarded' || e.kind === 'points.undone') {
      const sign = e.kind === 'points.awarded' ? 1 : -1
      const gameId = typeof e.data.game_id === 'string' ? e.data.game_id : null
      award(e.data.player_id ?? e.player_id, sign * numberOf(e.data.points), gameId)
    } else if (e.kind === 'game.deleted' && e.game_id) {
      // The game's scores went with it; its awards and bonuses stay on the scoreboard.
      for (const [playerId, value] of gameScores.get(e.game_id) ?? []) add(totals, playerId, -value)
      gameScores.delete(e.game_id)
      gamePoints.delete(e.game_id)
      scored = true
    } else if (e.kind === 'player.removed' && e.player_id) {
      // Their points leave the scoreboard with them.
      if (totals.delete(e.player_id)) scored = true
    } else if (e.kind === 'player.freed' && e.player_id) {
      // The host gave the name back to the guest list (docs/guest-list.md): the
      // points the taker earned go, and whoever takes the name next starts at 0.
      for (const byGame of [...gameScores.values(), ...gamePoints.values()]) byGame.delete(e.player_id)
      if (totals.delete(e.player_id)) scored = true
    }
    if (!scored) continue
    anchor = anchor === null ? e.at : Math.min(anchor, e.at)
    steps.push({ at: e.at, totals: new Map(top.map((id) => [id, totals.get(id) ?? 0])) })
    const now = leaders(Object.fromEntries(totals))
    if (now.length === 1 && now[0] !== leader) {
      if (e.at >= anchor + LEAD_CHANGE_QUIET_MS) leadChanges.push({ at: e.at, playerId: now[0], name: nameOf(now[0]) })
      leader = now[0]
    }
  }

  const race = raceSamples(steps, top, anchor, generatedAt, raw.standings)

  // Standings, podium and each player's night.
  const standings = ranked(raw.standings.map((r) => ({ playerId: r.player_id, name: r.name, points: r.points })))
  const podium = standings.filter((r) => r.points > 0).slice(0, 3).map(({ playerId, name, points }) => ({ playerId, name, points }))
  const players: RecapDoc['players'] = {}
  for (const row of standings) {
    const byGame = raw.games
      .map((g) => ({ gameId: g.id, title: g.title, points: gamePoints.get(g.id)?.get(row.playerId) ?? 0 }))
      .filter((g) => g.points !== 0)
      .sort((a, b) => b.points - a.points)
    const moments = chapters.flatMap((c) => c.highlights.filter((h) => h.players?.includes(row.playerId)))
    const best = byGame[0]
    if (best && best.points > 0) {
      moments.push({ title: `Your best game: ${best.title}`, detail: pointsText(best.points), icon: 'star', weight: 'highlight' })
    }
    players[row.playerId] = { name: row.name, rank: row.rank, points: row.points, byGame, moments }
  }

  return {
    version: 1,
    session: { id: raw.session.id, name: raw.session.name },
    generatedAt,
    numbers: {
      guests: raw.players.length,
      games: chapters.length,
      answers: log.filter((e) => e.kind === 'prompt.answered').length,
      moves: log.filter((e) => e.kind === 'game.action').length,
      awards: log.filter((e) => e.kind === 'points.awarded').length,
    },
    chapters,
    race,
    leadChanges,
    podium,
    standings,
    players,
    timeline: timelineOf(chapters, leadChanges, nameOf),
  }
}

/**
 * The race for the TV's bar race and the host's chart: a zero start, then the
 * totals after each scoring moment. More than 120 moments are resampled at
 * even times across the night. The last point is always the final standings.
 */
function raceSamples(
  steps: { at: number; totals: Map<string, number> }[],
  top: string[],
  anchor: number | null,
  end: number,
  standings: RawRecap['standings'],
): RecapDoc['race'] {
  if (top.length === 0 || anchor === null) return []
  const zero = new Map(top.map((id) => [id, 0]))
  // The zero start comes before the first scoring moment, even when they share the anchor.
  const moments: { at: number; totals: Map<string, number> }[] = [{ at: Math.min(anchor, (steps[0]?.at ?? anchor) - 1), totals: zero }]
  for (const step of steps) {
    // Moments at the same time keep their last totals.
    if (moments.length > 1 && moments[moments.length - 1].at === step.at) moments[moments.length - 1] = step
    else moments.push(step)
  }
  const final = new Map(standings.slice(0, top.length).map((r) => [r.player_id, r.points]))
  const last = moments[moments.length - 1]
  if (top.some((id) => (last.totals.get(id) ?? 0) !== (final.get(id) ?? 0))) {
    moments.push({ at: Math.max(end, last.at), totals: final })
  }
  let picked = moments
  if (moments.length > RACE_POINTS) {
    const from = moments[0].at
    const to = moments[moments.length - 1].at
    picked = []
    let j = 0
    for (let i = 0; i < RACE_POINTS; i++) {
      const at = i === RACE_POINTS - 1 ? to : Math.round(from + ((to - from) * i) / (RACE_POINTS - 1))
      while (j + 1 < moments.length && moments[j + 1].at <= at) j++
      if (picked.length > 0 && picked[picked.length - 1].at === at) continue
      picked.push({ at, totals: moments[j].totals })
    }
  }
  return picked.map((m) => ({ at: m.at, totals: Object.fromEntries(top.map((id) => [id, m.totals.get(id) ?? 0])) }))
}

/** Starts and finishes with their winners, lead changes and the highlights that have a time: at most 60, in time order. */
function timelineOf(
  chapters: RecapDoc['chapters'],
  leadChanges: RecapDoc['leadChanges'],
  nameOf: (id: string) => string,
): RecapDoc['timeline'] {
  // Lower priority numbers survive the cut first: finishes, starts, lead changes, then highlights by weight.
  const entries: { item: RecapDoc['timeline'][number]; priority: number; order: number }[] = []
  const push = (item: RecapDoc['timeline'][number], priority: number) => entries.push({ item, priority, order: entries.length })
  for (const c of chapters) {
    push({ at: c.startedAt, text: c.round > 1 ? `${c.title} started again` : `${c.title} started`, icon: 'megaphone', gameId: c.gameId }, 1)
    if (c.finishedAt === null) continue
    const text = c.winners.length > 0 ? `${listNames(c.winners.map((w) => w.name))} won ${c.title}` : `${c.title} is over`
    push({ at: c.finishedAt, text, icon: c.winners.length > 0 ? 'crown' : 'trophy', gameId: c.gameId }, 0)
    for (const h of c.highlights) {
      if (h.at === undefined) continue
      const item: RecapDoc['timeline'][number] = { at: h.at, text: h.title, gameId: c.gameId }
      if (h.detail) item.detail = h.detail
      if (h.icon) item.icon = h.icon
      push(item, h.weight === 'headline' ? 3 : h.weight === 'line' ? 5 : 4)
    }
  }
  for (const change of leadChanges) push({ at: change.at, text: `${nameOf(change.playerId)} took the lead`, icon: 'star' }, 2)
  return entries
    .sort((a, b) => a.priority - b.priority || a.item.at - b.item.at || a.order - b.order)
    .slice(0, TIMELINE_ENTRIES)
    .sort((a, b) => a.item.at - b.item.at || a.priority - b.priority || a.order - b.order)
    .map((entry) => entry.item)
}
