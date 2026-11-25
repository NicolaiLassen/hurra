import { describe, expect, it } from 'vitest'
import type { TvScene } from '@/lib/stage'
import type { Player, Session, SessionGame } from '@/lib/types'
import {
  byOldestStart,
  comingUp,
  freshStage,
  joinPlace,
  mainArea,
  newsStage,
  resultLine,
  runningFor,
  sceneLine,
  strapNews,
  TITLE_CARD_FRESH_MS,
  titleCardKey,
  topOfGame,
  winnerNames,
} from './scene'

const NOW = 1_795_900_000_000
const MIN = 60_000

const player = (id: string, name: string): Player => ({ id, name, code: id.toUpperCase(), profile: {}, created_at: NOW - 100 * MIN })
const PLAYERS = [player('ana', 'Ana'), player('bo', 'Bo'), player('mads', 'Mads')]

function game(id: string, patch: Partial<SessionGame> = {}): SessionGame {
  return {
    id,
    game_type: 'quiz',
    title: 'Quiz',
    position: 0,
    status: 'active',
    public_state: {},
    started_at: NOW - 5 * MIN,
    finished_at: null,
    finished_by: null,
    winners: [],
    wake_at: null,
    archived_at: null,
    created_at: NOW - 60 * MIN,
    ...patch,
  }
}

const session = (patch: Partial<Session> = {}): Session => ({
  id: 's',
  name: 'Party',
  join_code: 'PARTY',
  status: 'open',
  data: {},
  spotlight_game_id: null,
  spotlight_at: null,
  tv_scene: 'live',
  sound_volume: 100,
  archived_at: null,
  created_at: NOW - 300 * MIN,
  ...patch,
})

const withView = (type: string) => type === 'quiz'

describe('mainArea', () => {
  it("shows a live game's own screen when it has one, else the standings with Now playing", () => {
    const quiz = game('q')
    const pong = game('p', { game_type: 'in-person', title: 'Beer pong' })
    expect(mainArea({ kind: 'live', game: quiz }, withView)).toEqual({ kind: 'stage', game: quiz, finished: false })
    expect(mainArea({ kind: 'live', game: pong }, withView)).toEqual({ kind: 'board', over: false, nowPlaying: pong })
  })

  it('always gives a finished game its final screen, its own or the generic one', () => {
    const pong = game('p', { game_type: 'in-person', status: 'finished' })
    expect(mainArea({ kind: 'final', game: pong, until: NOW + MIN }, withView)).toEqual({ kind: 'stage', game: pong, finished: true })
  })

  it('shows the standings between games and at the end, and the recap full screen', () => {
    expect(mainArea({ kind: 'standings', lastGame: null }, withView)).toEqual({ kind: 'board', over: false, nowPlaying: null })
    expect(mainArea({ kind: 'over' }, withView)).toEqual({ kind: 'board', over: true, nowPlaying: null })
    expect(mainArea({ kind: 'recap' }, withView)).toEqual({ kind: 'recap' })
  })
})

describe('news on the stage', () => {
  const hunt = game('h', { game_type: 'elimination', title: 'Last one standing' })
  const bannersOf = (type: string): 'banner' | 'sound-only' => (type === 'quiz' ? 'sound-only' : 'banner')

  it("lets a live game's own stageBanners decide, and keeps the board and the recap as they were", () => {
    expect(newsStage({ kind: 'stage', game: hunt, finished: false }, bannersOf)).toEqual({ kind: 'stage', gameId: 'h', banners: 'banner' })
    expect(newsStage({ kind: 'stage', game: game('q'), finished: false }, bannersOf)).toEqual({ kind: 'stage', gameId: 'q', banners: 'sound-only' })
    expect(newsStage({ kind: 'board', over: false, nowPlaying: null }, bannersOf)).toEqual({ kind: 'board' })
    expect(newsStage({ kind: 'recap' }, bannersOf)).toEqual({ kind: 'recap' })
  })

  it("plays only the sound of a game's news on its own final screen, which shows the result itself", () => {
    expect(newsStage({ kind: 'stage', game: { ...hunt, status: 'finished' }, finished: true }, bannersOf)).toEqual({
      kind: 'stage',
      gameId: 'h',
      banners: 'sound-only',
    })
  })

  it("takes down a strap from the game whose winner's screen has just taken the stage, and keeps any other", () => {
    const winnerNews = { id: 1, game_id: 'h' }
    const party = { id: 2, game_id: null }
    const final = { kind: 'stage', game: { ...hunt, status: 'finished' }, finished: true } as const
    expect(strapNews(winnerNews, final)).toBeUndefined()
    expect(strapNews(party, final)).toBe(party)
    expect(strapNews(winnerNews, { kind: 'stage', game: hunt, finished: false })).toBe(winnerNews)
    expect(strapNews(winnerNews, { kind: 'board', over: false, nowPlaying: null })).toBe(winnerNews)
    expect(strapNews(undefined, final)).toBeUndefined()
  })
})

describe('joinPlace', () => {
  const board = { kind: 'board', over: false, nowPlaying: null } as const
  const stage = { kind: 'stage', game: game('q'), finished: false } as const

  it('puts the join block on the board while the standings show, whatever the party\'s size', () => {
    expect([1, 2, 3, 4, 24, 45].map((guests) => joinPlace(board, true, guests))).toEqual(['board', 'board', 'board', 'board', 'board', 'board'])
  })

  it('gives a game on the stage only the band\'s code', () => {
    expect(joinPlace(stage, true, 2)).toBe('code')
    expect(joinPlace(stage, true, 45)).toBe('code')
  })

  it('gives the band the code while a game without a screen of its own holds the stage, since its card stands beside the podium', () => {
    const pong = { kind: 'board', over: false, nowPlaying: game('p', { game_type: 'in-person', title: 'Beer pong' }) } as const
    expect(joinPlace(pong, true, 24)).toBe('code')
    // A small party still gets the board's big join card.
    expect(joinPlace(pong, true, 2)).toBe('board')
  })

  it('shows none while joining is closed, on the recap, or before anyone joined (the lobby is a QR code already)', () => {
    expect(joinPlace(board, false, 2)).toBeNull()
    expect(joinPlace(stage, false, 12)).toBeNull()
    expect(joinPlace({ kind: 'recap' }, true, 12)).toBeNull()
    expect(joinPlace(board, true, 0)).toBeNull()
  })
})

describe('the programme strap', () => {
  const finished = game('q', { status: 'finished', finished_at: NOW - MIN, winners: ['mads'] })
  const pending = (id: string, title: string, position: number, patch: Partial<SessionGame> = {}) =>
    game(id, { title, position, status: 'pending', started_at: null, ...patch })

  it("puts the stage game's title on the tab and leaves the strap to the game, live or on its final screen", () => {
    const quiz = game('q')
    expect(sceneLine({ kind: 'live', game: quiz }, PLAYERS, [quiz])).toEqual({ tab: 'Quiz', game: quiz })
    expect(sceneLine({ kind: 'final', game: finished, until: NOW + MIN }, PLAYERS, [finished])).toEqual({ tab: 'Quiz', game: finished })
  })

  it("says what is next between games, in the host's order, with the one after it", () => {
    const games = [pending('f', 'Who is fused?', 3), finished, pending('q2', 'Quiz', 2), pending('p', 'Beer pong', 4)]
    expect(sceneLine({ kind: 'standings', lastGame: finished }, PLAYERS, games)).toEqual({
      tab: 'Next',
      strong: 'Quiz',
      rest: 'then Who is fused?',
    })
    expect(sceneLine({ kind: 'standings', lastGame: null }, PLAYERS, [pending('f', 'Who is fused?', 3)])).toEqual({
      tab: 'Next',
      strong: 'Who is fused?',
    })
  })

  it('says how the last game went when nothing is left to come', () => {
    expect(sceneLine({ kind: 'standings', lastGame: finished }, PLAYERS, [finished])).toEqual({ tab: 'Standings', strong: 'Mads won Quiz' })
    expect(sceneLine({ kind: 'standings', lastGame: null }, PLAYERS, [])).toEqual({ tab: 'Standings', strong: 'The scoreboard' })
  })

  it('has its own words for the end of the party and the recap', () => {
    expect(sceneLine({ kind: 'over' }, PLAYERS, [])).toEqual({ tab: 'The end', strong: 'Final standings' })
    expect(sceneLine({ kind: 'recap' }, PLAYERS, [])).toEqual({ tab: 'Recap', strong: 'Recap of the night' })
  })

  it('leaves out games that started, finished or were archived from what comes up', () => {
    const games = [pending('a', 'Archived', 1, { archived_at: NOW }), game('live'), finished, pending('n', 'Next one', 5)]
    expect(comingUp(games).map((g) => g.id)).toEqual(['n'])
  })
})

describe('results', () => {
  it('lists every winner still in the party, in order', () => {
    const tie = game('q', { winners: ['bo', 'gone', 'ana'] })
    expect(winnerNames(tie, PLAYERS)).toEqual(['Bo', 'Ana'])
    expect(resultLine(tie, PLAYERS)).toBe('Bo and Ana won Quiz')
  })

  it('says the game is over when nobody (still here) won', () => {
    expect(resultLine(game('q', { winners: [] }), PLAYERS)).toBe('Quiz is over')
    expect(resultLine(game('q', { winners: ['gone'] }), PLAYERS)).toBe('Quiz is over')
  })
})

describe('the generic status card', () => {
  it('says how long a game has run', () => {
    expect(runningFor(20_000)).toBe('Just started')
    expect(runningFor(12 * MIN + 30_000)).toBe('12 min')
    expect(runningFor(60 * MIN)).toBe('1 h')
    expect(runningFor(65 * MIN)).toBe('1 h 5 min')
  })

  it("ranks a game's scorers who are still here, and nobody before the first point", () => {
    const top = topOfGame({ ana: 3, bo: 7, gone: 9, mads: 0 }, PLAYERS)
    expect(top.map((row) => [row.player.name, row.points])).toEqual([
      ['Bo', 7],
      ['Ana', 3],
    ])
    expect(topOfGame({}, PLAYERS)).toEqual([])
  })
})

describe('byOldestStart', () => {
  it('keeps the evening-long game first and later games below it', () => {
    const elimination = game('e', { started_at: NOW - 90 * MIN })
    const fusion = game('f', { started_at: NOW - 30 * MIN })
    const pending = game('p', { started_at: null })
    expect([fusion, elimination, pending].sort(byOldestStart).map((g) => g.id)).toEqual(['p', 'e', 'f'])
  })
})

describe('the title card', () => {
  const live = (patch: Partial<SessionGame> = {}): TvScene => ({ kind: 'live', game: game('q', patch) })

  it('shows when a game has just taken the stage', () => {
    const scene = live()
    expect(freshStage(scene, session({ spotlight_at: NOW - 2000 }), NOW)).toBe(titleCardKey(game('q')))
  })

  it('stays away from a TV that opens long after the game took the stage', () => {
    expect(freshStage(live(), session({ spotlight_at: NOW - TITLE_CARD_FRESH_MS - 1 }), NOW)).toBeNull()
  })

  it('shows again for a restart on the stage: a new round, though the spotlight never changed', () => {
    const restarted = live({ started_at: NOW - 1000 })
    const key = freshStage(restarted, session({ spotlight_at: NOW - 30 * MIN }), NOW)
    expect(key).toBe(titleCardKey(game('q', { started_at: NOW - 1000 })))
    expect(key).not.toBe(titleCardKey(game('q')))
  })

  it('never shows for a final screen or the standings', () => {
    const done = game('q', { status: 'finished', finished_at: NOW })
    expect(freshStage({ kind: 'final', game: done, until: NOW + MIN }, session({ spotlight_at: NOW }), NOW)).toBeNull()
    expect(freshStage({ kind: 'standings', lastGame: null }, session({ spotlight_at: NOW }), NOW)).toBeNull()
  })
})
