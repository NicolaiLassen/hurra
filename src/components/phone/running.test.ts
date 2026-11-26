import { describe, expect, it, vi } from 'vitest'
import { isBackgroundGame, phoneSecretOf } from '@/components/phone/calls'
import { elimination } from '@/games/elimination'
import { FIXTURE_NOW, FIXTURE_SCENES, FUSION_STAGE_SCENES, fixtureSnapshot, type FixtureScene } from '@/lib/fixtures'
import { FINAL_SCREEN_MS } from '@/lib/stage'
import type { SessionGame, Snapshot } from '@/lib/types'
import { barSecret, homeLayout, mainCardNews, peekOpen, phoneFocus, sheetGivesWay } from './running'

// No network here: the phone's calls load the client, and nothing calls it.
vi.mock('@/lib/supabase', () => ({ supabase: {} }))

describe("the main card's news", () => {
  it('is a new game on the main card or a new question on it', () => {
    expect(mainCardNews({ gameId: 'q', questionKey: 'q2' }, { gameId: 'q', questionKey: 'q3' })).toBe(true)
    expect(mainCardNews({ gameId: null, questionKey: null }, { gameId: 'q', questionKey: null })).toBe(true)
    expect(mainCardNews({ gameId: 'q', questionKey: 'q3' }, { gameId: 'q', questionKey: 'q3' })).toBe(false)
    // A question closing, or the card emptying, is not news.
    expect(mainCardNews({ gameId: 'q', questionKey: 'q3' }, { gameId: 'q', questionKey: null })).toBe(false)
    expect(mainCardNews({ gameId: 'q', questionKey: null }, { gameId: null, questionKey: null })).toBe(false)
  })
})

describe('a sheet left open', () => {
  const base = { news: true, covered: true, timed: true, scanning: false }

  it("gives way to a new timed question, so a guest who left the hunt's sheet open after a scan still answers the quiz", () => {
    expect(sheetGivesWay(base)).toBe(true)
  })

  it('stays for anything else: no news, no sheet, a question without a clock, or a scan still being handled', () => {
    expect(sheetGivesWay({ ...base, news: false })).toBe(false)
    expect(sheetGivesWay({ ...base, covered: false })).toBe(false)
    expect(sheetGivesWay({ ...base, timed: false })).toBe(false)
    expect(sheetGivesWay({ ...base, scanning: true })).toBe(false)
  })
})

// The takeover (docs/identity.md, The phone): which screen fills the phone for
// every combination of the stage game, the games beside it, a finish, a guest
// who joins mid-game, and the peek.
describe('the takeover', () => {
  const focusOf = (scene: FixtureScene | Snapshot, now = FIXTURE_NOW) =>
    phoneFocus(typeof scene === 'string' ? fixtureSnapshot(scene, 'phone') : scene, now, isBackgroundGame)
  const takenBy = (scene: FixtureScene | Snapshot, now = FIXTURE_NOW) => {
    const focus = focusOf(scene, now)
    return focus.kind === 'takeover' ? `${focus.game.game_type}${focus.finished ? ' finished' : ''}` : 'home'
  }
  const typeOf = (s: Snapshot, type: string) => s.games.find((g) => g.game_type === type)!
  const withGame = (s: Snapshot, type: string, patch: Partial<SessionGame>): Snapshot => ({
    ...s,
    games: s.games.map((g) => (g.game_type === type ? { ...g, ...patch } : g)),
  })

  it('is the stage game, live, over every scene with one on the TV, with or without games beside it', () => {
    for (const scene of ['quiz-question', 'quiz-reveal', 'quiz-leaderboard', 'background', 'background-reveal'] as const) {
      expect(takenBy(scene), scene).toBe('quiz')
    }
    for (const scene of FUSION_STAGE_SCENES.filter((scene) => scene !== 'fusion-final')) expect(takenBy(scene), scene).toBe('fusion')
    for (const scene of FIXTURE_SCENES.filter((scene) => scene.startsWith('soundtrack-') && scene !== 'soundtrack-final')) {
      expect(takenBy(scene), scene).toBe('soundtrack')
    }
    // An in-person round on the TV takes the phone over too: its code is what the guest needs.
    expect(takenBy('in-person')).toBe('in-person')
    // Last one standing runs beside the stage game in those scenes, and never takes the phone itself.
    const background = fixtureSnapshot('background', 'phone')
    expect(typeOf(background, 'elimination').status).toBe('active')
    expect(focusOf(background)).toMatchObject({ kind: 'takeover', finished: false, until: null })
  })

  it('stays on the result while the TV shows the final screen, and goes home with the TV', () => {
    expect(takenBy('fusion-final')).toBe('fusion finished')
    expect(takenBy('soundtrack-final')).toBe('soundtrack finished')
    const final = fixtureSnapshot('fusion-final', 'phone')
    const focus = focusOf(final)
    const fusion = typeOf(final, 'fusion')
    expect(focus).toMatchObject({ kind: 'takeover', finished: true, until: fusion.finished_at! + FINAL_SCREEN_MS })
    const until = focus.kind === 'takeover' ? focus.until! : 0
    expect(takenBy(final, until - 1)).toBe('fusion finished')
    expect(takenBy(final, until)).toBe('home')
    // Back to standings ends it at once: the home, with the result card on it until the next game starts.
    const back = { ...final, session: { ...final.session!, spotlight_game_id: null } }
    expect(takenBy(back)).toBe('home')
    expect(homeLayout(back, FIXTURE_NOW, isBackgroundGame).main).toMatchObject({ kind: 'result', game: { id: fusion.id } })
  })

  it('is the home between stage games, on the recap and once the party is over', () => {
    expect(takenBy('lobby')).toBe('home')
    expect(takenBy('between')).toBe('home')
    expect(takenBy('archived')).toBe('home')
    // The host sends the TV back to the standings while the quiz runs: the quiz is the home's main card again.
    const quiz = fixtureSnapshot('background-reveal', 'phone')
    const standings = { ...quiz, session: { ...quiz.session!, spotlight_game_id: null } }
    expect(takenBy(standings)).toBe('home')
    expect(homeLayout(standings, FIXTURE_NOW, isBackgroundGame).main).toMatchObject({ kind: 'game', game: { game_type: 'quiz' }, onStage: false })
    // The recap on the TV.
    const recap = { ...quiz, session: { ...quiz.session!, tv_scene: 'recap' as const }, recap: { published_at: FIXTURE_NOW - 60_000 } }
    expect(takenBy(recap)).toBe('home')
  })

  it('leaves a background game on the TV to the home: Last one standing on the stage, live or finished', () => {
    const background = fixtureSnapshot('background', 'phone')
    const hunt = typeOf(background, 'elimination')
    const onStage = { ...background, session: { ...background.session!, spotlight_game_id: hunt.id, spotlight_at: FIXTURE_NOW } }
    expect(takenBy(onStage)).toBe('home')
    // Its final screen (the final scene: Bo is the last one standing) is the home's result card.
    expect(focusOf('final').kind).toBe('home')
  })

  it('a stage game started in the background, off the TV, takes nothing over', () => {
    // The background scene's darts are an in-person round, made for the stage, running beside the quiz.
    const background = fixtureSnapshot('background', 'phone')
    const darts = typeOf(background, 'in-person')
    expect(darts.status).toBe('active')
    expect(focusOf(background)).toMatchObject({ kind: 'takeover', game: { game_type: 'quiz' } })
    const quizOff = withGame(background, 'quiz', { status: 'finished', finished_at: FIXTURE_NOW - 10 * 60_000, winners: [] })
    expect(takenBy({ ...quizOff, session: { ...quizOff.session!, spotlight_game_id: null } })).toBe('home')
  })

  it('takes over for a guest who joins mid-game too: it reads the TV, not the phone', () => {
    const s = fixtureSnapshot('background-reveal', 'phone')
    const joined: Snapshot = {
      ...s,
      players: [...s.players, { id: 'wilma', name: 'Wilma', code: 'W1L7A', profile: {}, created_at: FIXTURE_NOW, joined_at: FIXTURE_NOW }],
      me: { player_id: 'wilma', views: {}, answers: {} },
    }
    expect(takenBy(joined)).toBe('quiz')
    // Not dealt into the hunt: no secret on the bar.
    const stageId = focusOf(joined).kind === 'takeover' ? typeOf(joined, 'quiz').id : null
    expect(barSecret(homeLayout(joined, FIXTURE_NOW, isBackgroundGame).alsoRunning, stageId, (g) => phoneSecretOf(g, joined.me?.views[g.id]))).toBeNull()
  })
})

describe("the takeover's bar secret", () => {
  const s = fixtureSnapshot('background-reveal', 'phone')
  const quiz = s.games.find((g) => g.game_type === 'quiz')!
  const hunt = s.games.find((g) => g.game_type === 'elimination')!
  const secretOf = (g: SessionGame) => phoneSecretOf(g, s.me?.views[g.id])

  it('is the first live game off the stage with a secret for this guest: the hunt\'s task, never the darts\'', () => {
    const live = homeLayout(s, FIXTURE_NOW, isBackgroundGame).alsoRunning
    expect(live.map((g) => g.game_type)).toEqual(['elimination', 'in-person'])
    const found = barSecret(live, quiz.id, secretOf)
    expect(found?.game.id).toBe(hunt.id)
    expect(found?.secret).toEqual({ label: 'task', text: (s.me?.views[hunt.id] as { task: string }).task })
  })

  it('is nobody\'s once the hunt is on the stage, finished or archived', () => {
    expect(barSecret([hunt], hunt.id, secretOf)).toBeNull()
    expect(barSecret([{ ...hunt, status: 'finished' }], quiz.id, secretOf)).toBeNull()
    expect(barSecret([{ ...hunt, archived_at: FIXTURE_NOW }], quiz.id, secretOf)).toBeNull()
  })

  it("comes from the game's own hook: only while dealt in and standing, and never from a view it can't read", () => {
    const secret = elimination.phoneSecret!
    expect(secret({ status: 'alive', task: 'Get someone to whistle', knockouts: 0 })).toEqual({ label: 'task', text: 'Get someone to whistle' })
    expect(secret({ status: 'out', by: 'x', method: 'tag', task: 'Get someone to whistle', knockouts: 0 })).toBeNull()
    expect(secret({ status: 'winner', knockouts: 3 })).toBeNull()
    expect(secret({ status: 'spectator' })).toBeNull()
    expect(secret(null)).toBeNull()
    expect(secret(undefined)).toBeNull()
    expect(phoneSecretOf(hunt, 'not a view')).toBeNull()
    expect(phoneSecretOf(hunt, { status: 'alive', task: '  ' })).toBeNull()
  })
})

describe('the peek', () => {
  const quiz = fixtureSnapshot('background-reveal', 'phone')
  const takeover = phoneFocus(quiz, FIXTURE_NOW, isBackgroundGame)
  const quizId = quiz.games.find((g) => g.game_type === 'quiz')!.id

  it('opens over the takeover of the game it was opened over', () => {
    expect(peekOpen(takeover, quizId)).toBe(true)
    expect(peekOpen(takeover, null)).toBe(false)
  })

  it('closes when the next game takes the phone over, and never shows on the home', () => {
    const fusion = phoneFocus(fixtureSnapshot('fusion-asking', 'phone'), FIXTURE_NOW, isBackgroundGame)
    expect(peekOpen(fusion, quizId)).toBe(false)
    expect(peekOpen({ kind: 'home' }, quizId)).toBe(false)
  })

  it('gives way to a new timed question as a sheet does', () => {
    expect(sheetGivesWay({ news: true, covered: true, timed: true, scanning: false })).toBe(true)
    expect(sheetGivesWay({ news: true, covered: true, timed: false, scanning: false })).toBe(false)
  })
})
