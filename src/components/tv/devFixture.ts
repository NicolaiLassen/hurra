// Dev builds only (docs/engine-v2.md, 5.11): the TV page's ?fixture=<scene>,
// built on DATA's fixtures (src/lib/fixtures.ts), plus what the TV's checks
// need: a few scenes of its own, any party size, a title card, and news that
// arrives a moment after the page opens. The game data here is sample JSON
// for screens only, like the fixtures it builds on; nothing outside dev reads it.
//
// ?fixture=<scene>   a FixtureScene, or recap, standings, between, pong, pong-final, pong-over, empty, hunt, hunt-ended,
//                    quiz-lobby (before the first question), quiz-final (the quiz's podium),
//                    fusion-final (Who is fused?'s podium)
// &players=8|24|45   the party's size (trimmed, or padded with more guests)
// &fresh=1           the stage game took the stage just now: its title card shows
// &later=<seconds>   the clock moved on (a final screen's 3 minutes run out)
// &news=banner|ticker|interrupt|stage|points   arrives 1.5 s after the page opens
// &then=<scene>      the party 1.5 s after the page opens is in that fixture scene instead, its games' start times kept, so a
//                    game on the stage moves on from one phase to the next (a transition to look at)
// &host=1            a host's own browser: "Host preview"
// &band=2            a round of darts runs underneath too, so the band has a second line (the stage's least room)
// &name=<text>       the party's name (a long one checks the bug's ellipsis)
// &question=<text>   the quiz's question, and &options=A|B|C|D its options (long ones check the fit)
// &slide=<n>         the recap opens on slide n (from 0)
// On the pairing screen (fixture=removed), the code TV2026 pairs; any other is refused.
import { FIXTURE_NOW, fixtureRecapDoc, fixtureSnapshot, isFixtureScene, type FixtureScene } from '@/lib/fixtures'
import type { RecapDoc } from '@/lib/recap'
import type { FeedItem, Player, ScoreRow, SessionGame, Snapshot } from '@/lib/types'

export const TV_SCENES = [
  'recap',
  'standings',
  'between',
  'pong',
  'pong-final',
  'pong-over',
  'empty',
  'hunt',
  'hunt-ended',
  'quiz-lobby',
  'quiz-final',
  'fusion-final',
] as const
export type TvOnlyScene = (typeof TV_SCENES)[number]
export const NEWS = ['banner', 'ticker', 'interrupt', 'stage', 'points'] as const
type News = (typeof NEWS)[number]

export type DevTv = {
  snapshot: Snapshot
  /** The snapshot a moment later, with the news in it. */
  later?: Snapshot
  /** What the TV shows once the pairing screen's sample code (TV2026) is typed. */
  paired: Snapshot
  partyName: string
  recap?: RecapDoc
  hostPreview: boolean
}

const MIN = 60_000
const uid = (n: number) => `f1c7a000-0000-4000-8000-${String(9000 + n).padStart(12, '0')}`
const PONG = uid(500)
const DARTS = uid(501)

const EXTRA_NAMES = [
  'Asta', 'Alma', 'Agnes', 'Anton', 'August', 'Bertram', 'Carl', 'Christoffer Bjørnskov', 'Dagmar', 'Ella', 'Esther',
  'Felix', 'Frida', 'Frederik', 'Gustav', 'Hannah', 'Ingrid', 'Johan', 'Josefine', 'Karla', 'Konrad', 'Liva', 'Laura',
  'Lucas', 'Luna', 'Magnus', 'Malthe', 'Marie-Louise Christensen', 'Mathilde', 'Nora', 'Olivia', 'Otto', 'Silje',
  'Storm', 'Theo', 'Valdemar', 'Victor', 'Vigga', 'William', 'Viggo',
]

/** The sample TV for these search params; null when ?fixture names no scene. */
export function devTv(search: URLSearchParams): DevTv | null {
  const scene = search.get('fixture')
  if (!isFixtureScene(scene) && !TV_SCENES.includes(scene as TvOnlyScene)) return null
  const sizeParam = search.get('players')
  const size = sizeParam === null ? null : Number(sizeParam)
  const news = search.get('news') as News | null
  let snapshot = build(scene as FixtureScene | TvOnlyScene)
  if (size !== null && Number.isInteger(size) && size >= 0 && scene !== 'empty') snapshot = resize(snapshot, size)
  if (scene === 'final' || scene === 'pong-final') snapshot = withPodiumGains(snapshot)
  if (search.get('fresh') === '1' && snapshot.session) {
    snapshot = { ...snapshot, session: { ...snapshot.session, spotlight_at: snapshot.now - 500 } }
  }
  const name = search.get('name')
  if (name && snapshot.session) snapshot = { ...snapshot, session: { ...snapshot.session, name } }
  snapshot = withQuestion(snapshot, search.get('question'), search.get('options'))
  const twoLines = search.get('band') === '2'
  if (twoLines) snapshot = withSecondLine(snapshot)
  const later = Number(search.get('later'))
  if (Number.isFinite(later) && later > 0) snapshot = { ...snapshot, now: snapshot.now + later * 1000 }
  const then = search.get('then')
  let next: Snapshot | undefined
  if (news && NEWS.includes(news)) next = withNews(snapshot, news)
  else if (isFixtureScene(then) || TV_SCENES.includes(then as TvOnlyScene)) {
    let moved = build(then as FixtureScene | TvOnlyScene)
    if (size !== null && Number.isInteger(size) && size >= 0 && then !== 'empty') moved = resize(moved, size)
    if (twoLines) moved = withSecondLine(moved)
    next = keepStarts(snapshot, moved)
  }
  return {
    snapshot,
    later: next,
    paired: resize(fixtureSnapshot('lobby', 'tv'), size !== null && Number.isInteger(size) && size > 0 ? size : 12),
    partyName: 'Birthday party',
    recap: scene === 'recap' ? fixtureRecapDoc() : undefined,
    hostPreview: search.get('host') === '1' && !search.has('mirror'),
  }
}

function build(scene: FixtureScene | TvOnlyScene): Snapshot {
  switch (scene) {
    case 'recap': {
      const s = fixtureSnapshot('archived', 'tv')
      return { ...s, session: { ...s.session!, tv_scene: 'recap' } }
    }
    case 'standings':
      // The final screen's 3 minutes are over: back to the standings, "Last game: Bo won ...".
      return { ...fixtureSnapshot('final', 'tv'), now: FIXTURE_NOW + 4 * MIN }
    case 'between': {
      // Three games running, none on the stage: the strip beside the podium.
      const s = fixtureSnapshot('background', 'tv')
      return { ...s, session: { ...s.session!, spotlight_game_id: null, spotlight_at: null } }
    }
    case 'pong':
    case 'pong-final':
    case 'pong-over': {
      // An in-person round (no TV view of its own) on the stage, beside the background games;
      // pong-over: the host ended it with no winner.
      const s = fixtureSnapshot('background', 'tv')
      const finished = scene !== 'pong'
      const points = { [s.players[4].id]: 7, [s.players[9].id]: 4, [s.players[6].id]: 3 }
      const pong: SessionGame = {
        id: PONG,
        game_type: 'in-person',
        title: 'Beer pong',
        position: 3,
        status: finished ? 'finished' : 'active',
        public_state: {},
        started_at: FIXTURE_NOW - 25 * MIN,
        finished_at: finished ? FIXTURE_NOW - 20_000 : null,
        finished_by: finished ? 'host' : null,
        winners: scene === 'pong-final' ? [s.players[4].id] : [],
        wake_at: null,
        archived_at: null,
        created_at: FIXTURE_NOW - 120 * MIN,
      }
      const feed = scene === 'pong-final'
        ? [say(950, `${s.players[4].name} won Beer pong`, { game_id: PONG, detail: '7 points', icon: 'trophy', sound: 'fanfare' }), ...s.feed]
        : s.feed
      return {
        ...s,
        session: { ...s.session!, spotlight_game_id: PONG, spotlight_at: FIXTURE_NOW - 25 * MIN },
        games: [...s.games, pong],
        game_points: { ...s.game_points, [PONG]: points },
        feed,
      }
    }
    case 'hunt':
    case 'hunt-ended': {
      // Last one standing on the stage: live, or ended by the host with several still standing.
      const s = fixtureSnapshot('background', 'tv')
      const hunt = s.games.find((g) => g.game_type === 'elimination')!
      const ended = scene === 'hunt-ended'
      const games = s.games.map((g) =>
        g.id === hunt.id && ended ? { ...g, status: 'finished' as const, finished_at: FIXTURE_NOW - 20_000, finished_by: 'host' as const } : g,
      )
      return { ...s, session: { ...s.session!, spotlight_game_id: hunt.id, spotlight_at: FIXTURE_NOW - 30 * MIN }, games }
    }
    case 'empty': {
      const s = fixtureSnapshot('lobby', 'tv')
      return { ...s, players: [], standings: [] }
    }
    case 'quiz-lobby':
    case 'quiz-final': {
      // The quiz on the stage before its first question, or just finished (its podium, inside its 3 minutes).
      const s = fixtureSnapshot('quiz-leaderboard', 'tv')
      const done = scene === 'quiz-final'
      const games = s.games.map((g): SessionGame => {
        if (g.game_type !== 'quiz') return g
        const pub = g.public_state as { total: number; leaderboard: { playerId: string; rank: number }[] }
        if (!done) return { ...g, public_state: { phase: 'lobby', index: -1, total: pub.total, question: null, reveal: null, leaderboard: [] } }
        const winners = pub.leaderboard.filter((row) => row.rank === 1).map((row) => row.playerId)
        return { ...g, status: 'finished', public_state: { ...pub, phase: 'done' }, finished_at: FIXTURE_NOW - 20_000, finished_by: 'game', winners }
      })
      return { ...s, games, prompts: done ? s.prompts : [], tallies: {} }
    }
    case 'fusion-final': {
      // Who is fused? just finished after its reveals (its podium, inside its 3 minutes).
      const s = fixtureSnapshot('fusion-reveal', 'tv')
      const games = s.games.map((g): SessionGame => {
        if (g.game_type !== 'fusion') return g
        type Picture = { revealed: { both: number; one: number; voters: number } | null }
        const pub = g.public_state as { top: { playerId: string; points: number }[]; pictures: Picture[] }
        const best = pub.top[0]?.points ?? 0
        const winners = pub.top.filter((row) => row.points === best && best > 0).map((row) => row.playerId)
        // Sample counts: the first picture fooled most voters, so the screen has a best disguise to name.
        const pictures = pub.pictures.map((p, i) => (i === 0 && p.revealed ? { ...p, revealed: { ...p.revealed, both: 1, one: p.revealed.voters - 1 } } : p))
        return { ...g, status: 'finished', public_state: { ...pub, pictures, phase: 'done' }, finished_at: FIXTURE_NOW - 20_000, finished_by: 'game', winners }
      })
      return { ...s, games, prompts: [], tallies: {} }
    }
    default:
      return fixtureSnapshot(scene, 'tv')
  }
}

/** A round of darts live underneath, beside what already runs: the band's second line. */
function withSecondLine(s: Snapshot): Snapshot {
  if (!s.session || s.games.some((g) => g.title === 'Darts')) return s
  const darts: SessionGame = {
    id: DARTS,
    game_type: 'in-person',
    title: 'Darts',
    position: 4,
    status: 'active',
    public_state: {},
    started_at: FIXTURE_NOW - 30 * MIN,
    finished_at: null,
    finished_by: null,
    winners: [],
    wake_at: null,
    archived_at: null,
    created_at: FIXTURE_NOW - 120 * MIN,
  }
  return { ...s, games: [...s.games, darts] }
}

/** `next` with the games' start times (and the stage's) of `first`, so a screen keyed on them stays mounted. */
function keepStarts(first: Snapshot, next: Snapshot): Snapshot {
  const started = new Map(first.games.map((g) => [g.id, g.started_at]))
  const games = next.games.map((g) => (started.has(g.id) ? { ...g, started_at: started.get(g.id) ?? g.started_at } : g))
  const session = next.session && first.session ? { ...next.session, spotlight_at: first.session.spotlight_at } : next.session
  return { ...next, games, session }
}

/** The party with `size` guests: the fixture's first ones, or more after them. */
function resize(s: Snapshot, size: number): Snapshot {
  if (!s.session) return s
  const players: Player[] = s.players.slice(0, size)
  const standings: ScoreRow[] = s.standings.filter((row) => players.some((p) => p.id === row.player_id))
  const extra: Player[] = []
  for (let i = players.length; i < size; i++) {
    const n = i - s.players.length
    const name = EXTRA_NAMES[n % EXTRA_NAMES.length] + (n >= EXTRA_NAMES.length ? ` ${Math.floor(n / EXTRA_NAMES.length) + 1}` : '')
    extra.push({ id: uid(n), name, code: `X${String(n).padStart(4, '0')}`, profile: {}, created_at: FIXTURE_NOW - (60 - n) * MIN })
  }
  const extraRows = extra.map((p, n) => ({ player_id: p.id, name: p.name, code: p.code, points: (n * 7) % 13, profile: p.profile }))
  const allStandings = [...standings, ...extraRows].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))
  const ids = extra.map((p) => p.id)
  // Sample data only: a round of Last one standing deals the newcomers in too.
  const games = s.games.map((g) => {
    const pub = g.public_state as { alive?: unknown; out?: unknown; winner?: string | null; outBy?: Record<string, unknown> } | null
    if (!pub || !Array.isArray(pub.alive) || !Array.isArray(pub.out) || ids.length === 0) return g
    const keep = (list: string[]) => list.filter((id) => players.some((p) => p.id === id))
    if (pub.winner) {
      const outBy = { ...pub.outBy, ...Object.fromEntries(ids.map((id) => [id, { by: pub.winner, method: 'tag' }])) }
      return { ...g, public_state: { ...pub, alive: keep(pub.alive as string[]), out: [...keep(pub.out as string[]), ...ids], outBy } }
    }
    return { ...g, public_state: { ...pub, alive: [...keep(pub.alive as string[]), ...ids], out: keep(pub.out as string[]) } }
  })
  const tallies = Object.fromEntries(
    Object.entries(s.tallies).map(([gameId, counts]) => [gameId, Object.fromEntries(Object.entries(counts).map(([key, n]) => [key, Math.min(n, size)]))]),
  )
  return { ...s, players: [...players, ...extra], standings: allStandings, games, tallies }
}

/**
 * The finished game's points for the night's top three too, as live data has
 * them (a winner is usually on the night's podium): the winner's screen then
 * shows its "+3" chips on the steps, where the fit is tightest.
 */
function withPodiumGains(s: Snapshot): Snapshot {
  const game = s.games.find((g) => g.id === s.session?.spotlight_game_id && g.status === 'finished')
  if (!game) return s
  const points = { ...(s.game_points[game.id] ?? {}) }
  s.standings.slice(0, 3).forEach((row, i) => {
    points[row.player_id] ??= [3, 2, 1][i]
  })
  return { ...s, game_points: { ...s.game_points, [game.id]: points } }
}

/** The sample quiz with its open question's words replaced (dev fit checks). */
function withQuestion(s: Snapshot, text: string | null, options: string | null): Snapshot {
  if (!text && !options) return s
  const games = s.games.map((g) => {
    const pub = g.public_state as { question?: { text: string; options: string[] } | null } | null
    if (g.game_type !== 'quiz' || !pub?.question) return g
    const question = { ...pub.question, ...(text ? { text } : {}), ...(options ? { options: options.split('|').slice(0, 4) } : {}) }
    return { ...g, public_state: { ...pub, question } }
  })
  return { ...s, games }
}

// Past every id the scenes hold (pong-final's news is 950), so the news is newer than all of them.
let nextId = 1000
function say(id: number, message: string, patch: Partial<FeedItem> = {}): FeedItem {
  return {
    id,
    game_id: null,
    message,
    detail: null,
    audience: null,
    sound: null,
    icon: null,
    tone: null,
    interrupt: false,
    created_at: FIXTURE_NOW,
    ...patch,
  }
}

/** The same scene a moment later, with one piece of news in it. */
function withNews(s: Snapshot, news: News): Snapshot {
  const of = (type: string) => s.games.find((g) => g.game_type === type)?.id ?? null
  const stage = s.session?.spotlight_game_id ?? null
  const at = s.now + 1000
  const [a, b] = [s.players[7]?.name ?? 'Emil', s.players[8]?.name ?? 'Clara']
  switch (news) {
    case 'banner':
    case 'ticker':
      return {
        ...s,
        feed: [say(nextId++, `${a} got ${b}`, { game_id: of('elimination'), icon: 'sword', tone: 'pink', sound: 'slash', created_at: at }), ...s.feed],
      }
    case 'interrupt':
      return {
        ...s,
        feed: [
          say(nextId++, `${s.players[1]?.name ?? 'Bo'} is the last one standing!`, {
            game_id: of('elimination'),
            detail: '5 knockouts',
            icon: 'crown',
            sound: 'fanfare',
            interrupt: true,
            created_at: at,
          }),
          ...s.feed,
        ],
      }
    case 'stage':
      return {
        ...s,
        feed: [say(nextId++, 'Here comes the next question', { game_id: stage, icon: 'megaphone', sound: 'whoosh', created_at: at }), ...s.feed],
      }
    case 'points': {
      const gains = new Map([[s.standings[1]?.player_id, 3], [s.standings[4]?.player_id, 1], [s.standings[6]?.player_id, 2]])
      const standings = s.standings
        .map((row) => ({ ...row, points: row.points + (gains.get(row.player_id) ?? 0) }))
        .sort((x, y) => y.points - x.points || x.name.localeCompare(y.name))
      return { ...s, standings }
    }
  }
}
