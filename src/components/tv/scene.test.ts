import { describe, expect, it } from 'vitest'
import type { TvScene } from '@/lib/stage'
import type { Player, Session, SessionGame } from '@/lib/types'
import {
  byOldestStart,
  freshStage,
  joinCardPlace,
  mainArea,
  resultLine,
  runningFor,
  sceneLine,
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

describe('joinCardPlace', () => {
  const board = { kind: 'board', over: false, nowPlaying: null } as const
  const stage = { kind: 'stage', game: game('q'), finished: false } as const

  it('puts the big join card on the board while the standings show 1 to 3 guests', () => {
    expect([1, 2, 3].map((guests) => joinCardPlace(board, true, guests))).toEqual(['board', 'board', 'board'])
  })

  it('keeps it in the header for a bigger party, and while a game holds the stage', () => {
    expect(joinCardPlace(board, true, 4)).toBe('header')
    expect(joinCardPlace(board, true, 45)).toBe('header')
    expect(joinCardPlace(stage, true, 2)).toBe('header')
  })

  it('shows none while joining is closed, or before anyone joined (the empty board is a QR code already)', () => {
    expect(joinCardPlace(board, false, 2)).toBeNull()
    expect(joinCardPlace(stage, false, 12)).toBeNull()
    expect(joinCardPlace(board, true, 0)).toBeNull()
  })
})

describe('the scene line', () => {
  const finished = game('q', { status: 'finished', finished_at: NOW - MIN, winners: ['mads'] })

  it('names the stage game while it is live or on its final screen', () => {
    expect(sceneLine({ kind: 'live', game: game('q') }, PLAYERS)).toEqual({ lead: 'Now on stage:', strong: 'Quiz' })
    expect(sceneLine({ kind: 'final', game: finished, until: NOW + MIN }, PLAYERS)).toEqual({ lead: 'Final result:', strong: 'Quiz' })
  })

  it('says how the last game went until the next one starts', () => {
    expect(sceneLine({ kind: 'standings', lastGame: finished }, PLAYERS)).toEqual({ lead: 'Last game:', strong: 'Mads won Quiz' })
    expect(sceneLine({ kind: 'standings', lastGame: null }, PLAYERS)).toEqual({ lead: 'Live scoreboard' })
  })

  it('has its own words for the end of the party and the recap', () => {
    const scenes: [TvScene, string][] = [
      [{ kind: 'over' }, 'Final standings'],
      [{ kind: 'recap' }, 'Recap of the night'],
    ]
    for (const [scene, lead] of scenes) expect(sceneLine(scene, PLAYERS)).toEqual({ lead })
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
