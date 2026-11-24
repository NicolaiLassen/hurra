// Dev builds only (docs/engine-v2.md, 5.11): the TV page's ?fixture=<scene>,
// built on DATA's fixtures (src/lib/fixtures.ts), plus what the TV's checks
// need: a few scenes of its own, any party size, a title card, and news that
// arrives a moment after the page opens. The game data here is sample JSON
// for screens only, like the fixtures it builds on; nothing outside dev reads it.
//
// ?fixture=<scene>   a FixtureScene, or recap, standings, between, pong, pong-final, empty
// &players=8|24|45   the party's size (trimmed, or padded with more guests)
// &fresh=1           the stage game took the stage just now: its title card shows
// &later=<seconds>   the clock moved on (a final screen's 3 minutes run out)
// &news=banner|ticker|interrupt|stage|points   arrives 1.5 s after the page opens
// &host=1            a host's own browser: "Host preview"
// &name=<text>       the party's name (a long one checks the bug's ellipsis)
// &slide=<n>         the recap opens on slide n (from 0)
// On the pairing screen (fixture=removed), the code TV2026 pairs; any other is refused.
import { FIXTURE_NOW, fixtureRecapDoc, fixtureSnapshot, isFixtureScene, type FixtureScene } from '@/lib/fixtures'
import type { RecapDoc } from '@/lib/recap'
import type { FeedItem, Player, ScoreRow, SessionGame, Snapshot } from '@/lib/types'

export const TV_SCENES = ['recap', 'standings', 'between', 'pong', 'pong-final', 'empty'] as const
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
  if (search.get('fresh') === '1' && snapshot.session) {
    snapshot = { ...snapshot, session: { ...snapshot.session, spotlight_at: snapshot.now - 500 } }
  }
  const name = search.get('name')
  if (name && snapshot.session) snapshot = { ...snapshot, session: { ...snapshot.session, name } }
  const later = Number(search.get('later'))
  if (Number.isFinite(later) && later > 0) snapshot = { ...snapshot, now: snapshot.now + later * 1000 }
  return {
    snapshot,
    later: news && NEWS.includes(news) ? withNews(snapshot, news) : undefined,
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
    case 'pong-final': {
      // An in-person round (no TV view of its own) on the stage, beside the background games.
      const s = fixtureSnapshot('background', 'tv')
      const finished = scene === 'pong-final'
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
        winners: finished ? [s.players[4].id] : [],
        wake_at: null,
        archived_at: null,
        created_at: FIXTURE_NOW - 120 * MIN,
      }
      const feed = finished
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
    case 'empty': {
      const s = fixtureSnapshot('lobby', 'tv')
      return { ...s, players: [], standings: [] }
    }
    default:
      return fixtureSnapshot(scene, 'tv')
  }
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
  return { ...s, players: [...players, ...extra], standings: allStandings, games }
}

let nextId = 900
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
