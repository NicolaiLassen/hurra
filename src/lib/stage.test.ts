import { describe, expect, it } from 'vitest'
import {
  backgroundGames,
  FINAL_SCREEN_MS,
  finalScreenEndsAt,
  gamePointsOf,
  liveGames,
  myAnswersOf,
  phoneLayout,
  promptsOf,
  recentlyFinished,
  scanTarget,
  talliesOf,
  tvScene,
} from './stage'
import type { Session, SessionGame, Snapshot } from './types'

const NOW = 1_795_900_000_000
const MIN = 60_000

const session = (patch: Partial<Session> = {}): Session => ({
  id: 's',
  name: 'Party',
  join_code: 'PARTY',
  status: 'open',
  data: {},
  spotlight_game_id: null,
  spotlight_at: null,
  tv_scene: 'live',
  archived_at: null,
  created_at: NOW - 600 * MIN,
  ...patch,
})

function game(id: string, patch: Partial<SessionGame> = {}): SessionGame {
  return {
    id,
    game_type: 'quiz',
    title: id,
    position: 0,
    status: 'pending',
    public_state: null,
    started_at: null,
    finished_at: null,
    finished_by: null,
    winners: [],
    wake_at: null,
    archived_at: null,
    created_at: NOW - 300 * MIN,
    ...patch,
  }
}

const live = (id: string, startedMinAgo: number, patch: Partial<SessionGame> = {}) =>
  game(id, { status: 'active', started_at: NOW - startedMinAgo * MIN, ...patch })
const finished = (id: string, startedMinAgo: number, finishedMinAgo: number, patch: Partial<SessionGame> = {}) =>
  game(id, { status: 'finished', started_at: NOW - startedMinAgo * MIN, finished_at: NOW - finishedMinAgo * MIN, finished_by: 'game', ...patch })

function snap(games: SessionGame[], patch: Partial<Session> = {}, extra: Partial<Snapshot> = {}): Snapshot {
  return {
    now: NOW,
    member: true,
    exists: true,
    session: session(patch),
    games,
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
    ...extra,
  }
}

describe('tvScene', () => {
  it('plays the recap when the scene is recap and one is published', () => {
    const s = snap([live('quiz', 5)], { tv_scene: 'recap', spotlight_game_id: 'quiz' }, { recap: { published_at: NOW - MIN } })
    expect(tvScene(s, NOW)).toEqual({ kind: 'recap' })
    // Nothing published yet: the scene falls through to the stage.
    expect(tvScene({ ...s, recap: null }, NOW).kind).toBe('live')
  })

  it('shows the final standings once the party is archived (the recap still wins)', () => {
    const s = snap([live('quiz', 5)], { archived_at: NOW - MIN, spotlight_game_id: 'quiz' })
    expect(tvScene(s, NOW)).toEqual({ kind: 'over' })
    expect(tvScene({ ...s, session: { ...s.session!, tv_scene: 'recap' }, recap: { published_at: NOW } }, NOW)).toEqual({ kind: 'recap' })
  })

  it('shows the spotlit game while it is live', () => {
    const quiz = live('quiz', 5)
    expect(tvScene(snap([quiz, live('elim', 50)], { spotlight_game_id: 'quiz', spotlight_at: NOW - 5 * MIN }), NOW)).toEqual({ kind: 'live', game: quiz })
  })

  it('shows a finished spotlight for 3 minutes from max(finished_at, spotlight_at)', () => {
    const elim = finished('elim', 60, 1)
    const s = snap([elim], { spotlight_game_id: 'elim', spotlight_at: NOW - 1 * MIN })
    const until = NOW - MIN + FINAL_SCREEN_MS
    expect(tvScene(s, NOW)).toEqual({ kind: 'final', game: elim, until })
    expect(tvScene(s, until - 1).kind).toBe('final')
    expect(tvScene(s, until)).toEqual({ kind: 'standings', lastGame: elim })
    // Put on the TV later by the host: the 3 minutes count from then.
    const later = snap([finished('elim', 60, 30)], { spotlight_game_id: 'elim', spotlight_at: NOW - 30_000 })
    expect(finalScreenEndsAt(later, 'elim')).toBe(NOW - 30_000 + FINAL_SCREEN_MS)
    expect(tvScene(later, NOW).kind).toBe('final')
  })

  it('never shows an archived game, and a pending spotlight leaves the standings', () => {
    expect(tvScene(snap([finished('elim', 60, 1, { archived_at: NOW })], { spotlight_game_id: 'elim', spotlight_at: NOW - MIN }), NOW).kind).toBe('standings')
    expect(tvScene(snap([game('quiz')], { spotlight_game_id: 'quiz', spotlight_at: NOW }), NOW)).toEqual({ kind: 'standings', lastGame: null })
  })

  it('shows the standings with the last game until another game starts', () => {
    const pong = finished('pong', 40, 20, { winners: ['ana'] })
    expect(tvScene(snap([pong, game('quiz')]), NOW)).toEqual({ kind: 'standings', lastGame: pong })
    // A game that started and finished since then is the last game now.
    const quick = finished('quick', 10, 5)
    expect(tvScene(snap([pong, quick]), NOW)).toEqual({ kind: 'standings', lastGame: quick })
    // A game started after the last finish (running in the background, or since archived): no "Last game".
    expect(tvScene(snap([pong, live('elim', 10)]), NOW)).toEqual({ kind: 'standings', lastGame: null })
    expect(tvScene(snap([pong, finished('gone', 10, 5, { archived_at: NOW })]), NOW)).toEqual({ kind: 'standings', lastGame: null })
  })
})

describe('the TV rail', () => {
  it('lists live games newest start first, and the background ones without the stage game', () => {
    const a = live('a', 50)
    const b = live('b', 5)
    const c = live('c', 20, { archived_at: NOW })
    const s = snap([a, b, c, game('pending')], { spotlight_game_id: 'b' })
    expect(liveGames(s).map((g) => g.id)).toEqual(['b', 'a'])
    expect(backgroundGames(s).map((g) => g.id)).toEqual(['a'])
    expect(backgroundGames(snap([a, b])).map((g) => g.id)).toEqual(['b', 'a'])
  })

  it('chips games finished in the last 10 minutes that are not on the stage', () => {
    const s = snap([finished('old', 90, 11), finished('new', 30, 2), finished('stage', 30, 1), finished('later', 30, 9)], {
      spotlight_game_id: 'stage',
      spotlight_at: NOW - MIN,
    })
    expect(recentlyFinished(s, NOW).map((g) => g.id)).toEqual(['new', 'later'])
    // Once its final screen is over, the stage game is a chip too.
    expect(recentlyFinished(s, NOW + 3 * MIN).map((g) => g.id)).toEqual(['stage', 'new'])
    expect(recentlyFinished(s, NOW, 30 * MIN).map((g) => g.id)).toEqual(['new', 'later', 'old'])
  })
})

describe('phoneLayout', () => {
  it('says the party is over once archived', () => {
    expect(phoneLayout(snap([live('quiz', 5)], { archived_at: NOW }), NOW)).toEqual({ main: { kind: 'over' }, alsoRunning: [], finishedLately: [] })
  })

  it('makes the spotlit live game the main card, the others also running', () => {
    const quiz = live('quiz', 5)
    const elim = live('elim', 50)
    const fusion = live('fusion', 80)
    const layout = phoneLayout(snap([elim, quiz, fusion], { spotlight_game_id: 'quiz' }), NOW)
    expect(layout.main).toEqual({ kind: 'game', game: quiz, onStage: true })
    expect(layout.alsoRunning.map((g) => g.id)).toEqual(['elim', 'fusion'])
  })

  it('without a live spotlight, the newest live game is main and not on the stage', () => {
    const layout = phoneLayout(snap([live('elim', 50), live('fusion', 10)], { spotlight_game_id: 'done' }), NOW)
    expect(layout.main).toMatchObject({ kind: 'game', onStage: false, game: { id: 'fusion' } })
    expect(layout.alsoRunning.map((g) => g.id)).toEqual(['elim'])
  })

  it('keeps the result card until the next game starts, however long ago it finished', () => {
    const elim = finished('elim', 300, 200)
    expect(phoneLayout(snap([elim, game('quiz')]), NOW).main).toEqual({ kind: 'result', game: elim })
    expect(phoneLayout(snap([elim, live('quiz', 1)]), NOW).main).toMatchObject({ kind: 'game', game: { id: 'quiz' } })
    // The next game started and was archived meanwhile: the result has gone.
    expect(phoneLayout(snap([elim, finished('quiz', 100, 90, { archived_at: NOW })]), NOW).main).toEqual({ kind: 'lobby' })
    expect(phoneLayout(snap([game('quiz')]), NOW).main).toEqual({ kind: 'lobby' })
  })

  it('lists other games finished in the last 30 minutes', () => {
    const layout = phoneLayout(snap([finished('a', 60, 40), finished('b', 60, 20), finished('c', 30, 5), live('d', 1)]), NOW)
    expect(layout.main).toMatchObject({ kind: 'game', game: { id: 'd' } })
    expect(layout.finishedLately.map((g) => g.id)).toEqual(['c', 'b'])
    const result = phoneLayout(snap([finished('b', 60, 20), finished('c', 30, 5)]), NOW)
    expect(result.main).toMatchObject({ kind: 'result', game: { id: 'c' } })
    expect(result.finishedLately.map((g) => g.id)).toEqual(['b'])
  })
})

describe('scanTarget', () => {
  const scans = (type: string) => type === 'elimination'

  it('gives a scan to the main game when it takes scans, else to the newest live game that does', () => {
    const elim = live('elim', 50, { game_type: 'elimination' })
    expect(scanTarget(snap([elim]), scans, NOW)).toBe(elim)
    expect(scanTarget(snap([elim, live('quiz', 5)], { spotlight_game_id: 'quiz' }), scans, NOW)).toBe(elim)
    expect(scanTarget(snap([live('quiz', 5)]), scans, NOW)).toBeNull()
    expect(scanTarget(snap([elim], { archived_at: NOW }), scans, NOW)).toBeNull()
  })
})

describe('selectors', () => {
  it('picks one game’s prompts, tallies, points and answers, with a stable empty value', () => {
    const prompt = { game_id: 'quiz', key: 'q1', spec: { kind: 'choice' as const, options: ['0'] }, opened_at: NOW, closes_at: null, closed_at: null, revealed_at: null }
    const s = snap([live('quiz', 5)], {}, {
      prompts: [prompt, { ...prompt, game_id: 'other' }],
      game_points: { quiz: { ana: 3 } },
      me: { player_id: 'ana', views: {}, answers: { quiz: { q1: { choice: ['0'] } } } },
    })
    expect(promptsOf(s, 'quiz')).toEqual([prompt])
    expect(talliesOf({ quiz: { q1: 4 } }, 'quiz')).toEqual({ q1: 4 })
    expect(gamePointsOf(s, 'quiz')).toEqual({ ana: 3 })
    expect(myAnswersOf(s, 'quiz')).toEqual({ q1: { choice: ['0'] } })
    expect(talliesOf({}, 'x')).toBe(talliesOf({}, 'y'))
    expect(gamePointsOf(s, 'x')).toBe(myAnswersOf(s, 'x'))
  })
})
