import { describe, expect, it } from 'vitest'
import { FIXTURE_NOW, fixtureSnapshot } from '@/lib/fixtures'
import { FINAL_SCREEN_MS, tvScene } from '@/lib/stage'
import type { SessionGame, Snapshot } from '@/lib/types'
import {
  arrangeGames,
  defaultAwardGame,
  formatCountdown,
  nextPosition,
  resultLine,
  screensLine,
  stageWords,
  startChoices,
  winnersChip,
} from './scene'

const players = [
  { id: 'a', name: 'Ana' },
  { id: 'b', name: 'Bo' },
  { id: 'c', name: 'Cy' },
]

describe('formatCountdown', () => {
  it('reads m:ss, rounding up to the next second', () => {
    expect(formatCountdown(FINAL_SCREEN_MS)).toBe('3:00')
    expect(formatCountdown(179_001)).toBe('3:00')
    expect(formatCountdown(179_000)).toBe('2:59')
    expect(formatCountdown(61_000)).toBe('1:01')
    expect(formatCountdown(500)).toBe('0:01')
  })

  it('never goes below 0:00', () => {
    expect(formatCountdown(0)).toBe('0:00')
    expect(formatCountdown(-5000)).toBe('0:00')
  })
})

describe('the result words', () => {
  it('names the winners, or says the game is over', () => {
    expect(resultLine({ title: 'Quiz', winners: ['a'] }, players)).toBe('Ana won Quiz')
    expect(resultLine({ title: 'Quiz', winners: ['a', 'c'] }, players)).toBe('Ana and Cy won Quiz')
    expect(resultLine({ title: 'Quiz', winners: [] }, players)).toBe('Quiz is over')
    expect(winnersChip({ winners: ['b'] }, players)).toBe('Bo won')
    expect(winnersChip({ winners: [] }, players)).toBeNull()
  })

  it('still reads when a winner has left the party', () => {
    expect(resultLine({ title: 'Quiz', winners: ['gone'] }, players)).toBe('A guest who left won Quiz')
    expect(resultLine({ title: 'Quiz', winners: ['a', 'gone'] }, players)).toBe('Ana and a guest who left won Quiz')
  })
})

describe('stageWords', () => {
  it('says which game is live on the TV', () => {
    const s = fixtureSnapshot('quiz-question', 'host')
    const words = stageWords(tvScene(s, FIXTURE_NOW), s.players, FIXTURE_NOW)
    expect(words.title).toBe('Quiz')
    expect(words.detail).toMatch(/^Live on the TV/)
  })

  it('counts down the final screen', () => {
    const s = fixtureSnapshot('final', 'host')
    const scene = tvScene(s, FIXTURE_NOW)
    expect(scene.kind).toBe('final')
    const words = stageWords(scene, s.players, FIXTURE_NOW)
    expect(words.title).toBe('Final result: Last one standing')
    // The fixture finished 40 s ago: 2:20 left of the 3 minutes.
    expect(words.detail).toBe('Bo won Last one standing. The TV goes back in 2:20.')
  })

  it('names the last game on the standings', () => {
    const s = fixtureSnapshot('final', 'host')
    const later = FIXTURE_NOW + FINAL_SCREEN_MS
    const words = stageWords(tvScene(s, later), s.players, later)
    expect(words).toEqual({ title: 'The standings', detail: 'Last game: Bo won Last one standing.' })
    const lobby = fixtureSnapshot('lobby', 'host')
    expect(stageWords(tvScene(lobby, FIXTURE_NOW), lobby.players, FIXTURE_NOW).detail).toBe("Everyone's points for the night.")
  })

  it('covers the recap and an archived party', () => {
    const archived = fixtureSnapshot('archived', 'host')
    expect(stageWords(tvScene(archived, FIXTURE_NOW), archived.players, FIXTURE_NOW).title).toBe('Final standings')
    const recap: Snapshot = { ...archived, session: { ...archived.session!, tv_scene: 'recap' } }
    expect(stageWords(tvScene(recap, FIXTURE_NOW), recap.players, FIXTURE_NOW).title).toBe('The recap of the night')
  })
})

describe('screensLine', () => {
  it('counts the paired TVs', () => {
    expect(screensLine(null)).toBe('No TV paired yet')
    expect(screensLine(0)).toBe('No TV paired yet')
    expect(screensLine(1)).toBe('1 TV paired')
    expect(screensLine(2)).toBe('2 TVs paired')
  })

  it('says when the TV is a tab of this browser (Show the TV here)', () => {
    expect(screensLine(0, true)).toBe('TV open in this browser')
    expect(screensLine(null, true)).toBe('TV open in this browser')
    // A paired TV is the stronger fact: it counts first.
    expect(screensLine(1, true)).toBe('1 TV paired')
  })
})

describe('startChoices', () => {
  it('puts the game’s own presentation first', () => {
    expect(startChoices('background').map((c) => c.stage)).toEqual([false, true])
    expect(startChoices('stage').map((c) => c.stage)).toEqual([true, false])
    expect(startChoices(undefined)[0]).toEqual({ stage: true, label: 'Start on the TV' })
  })
})

describe('defaultAwardGame', () => {
  it('prefers the game the host came from, then the live stage game, then the newest live game', () => {
    const background = fixtureSnapshot('background', 'host')
    const quiz = background.session!.spotlight_game_id!
    const elimination = background.games.find((g) => g.game_type === 'elimination')!.id
    expect(defaultAwardGame(background, elimination)).toBe(elimination)
    expect(defaultAwardGame(background, null)).toBe(quiz)
    expect(defaultAwardGame(background, 'not-a-game')).toBe(quiz)

    const offStage: Snapshot = { ...background, session: { ...background.session!, spotlight_game_id: null } }
    // Fusion started before the quiz and Last one standing: the quiz is the newest start.
    expect(defaultAwardGame(offStage, null)).toBe(quiz)
  })

  it('is none when nothing is live', () => {
    expect(defaultAwardGame(fixtureSnapshot('lobby', 'host'), null)).toBeNull()
  })

  it('never picks an archived game', () => {
    const lobby = fixtureSnapshot('lobby', 'host')
    const archived: SessionGame = { ...lobby.games[0], archived_at: FIXTURE_NOW }
    const s: Snapshot = { ...lobby, games: [archived, ...lobby.games.slice(1)] }
    expect(defaultAwardGame(s, archived.id)).toBeNull()
  })
})

describe('arranging the games', () => {
  it('splits live games, the program and the archive', () => {
    const s = fixtureSnapshot('background', 'host')
    const { live, program, archived } = arrangeGames(s)
    expect(live.map((g) => g.title)).toEqual(['Quiz', 'Last one standing', 'Who is fused?'])
    expect(program).toEqual([])
    expect(archived).toEqual([])
    const lobby = arrangeGames(fixtureSnapshot('lobby', 'host'))
    expect(lobby.live).toEqual([])
    expect(lobby.program.map((g) => g.position)).toEqual([0, 1, 2])
  })

  it('puts a new game last', () => {
    expect(nextPosition([])).toBe(0)
    expect(nextPosition([{ position: 0 }, { position: 4 }, { position: 2 }])).toBe(5)
  })
})
