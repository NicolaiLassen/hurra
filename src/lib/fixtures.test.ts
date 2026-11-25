import { describe, expect, it } from 'vitest'
import {
  FIXTURE_NOW,
  FIXTURE_PLAYER_ID,
  FIXTURE_SCENES,
  fixtureRecapDoc,
  fixtureSnapshot,
  FUSION_STAGE_SCENES,
  isFixtureScene,
} from './fixtures'
import { backgroundGames, phoneLayout, tvScene } from './stage'

const screens = ['phone', 'tv', 'host'] as const

describe('fixtureSnapshot', () => {
  it('gives every scene to every screen, with what that screen may read', () => {
    for (const scene of FIXTURE_SCENES) {
      for (const screen of screens) {
        const s = fixtureSnapshot(scene, screen)
        expect(s.now).toBe(FIXTURE_NOW)
        if (scene === 'removed') {
          expect(s).toMatchObject({ member: false, exists: true, session: null, me: null })
          continue
        }
        expect(s.member).toBe(true)
        expect(s.me === null).toBe(screen !== 'phone')
        expect(s.states === null).toBe(screen !== 'host')
        expect(s.screens === null).toBe(screen !== 'host')
        // Targeted announcements reach only their own phone.
        for (const item of s.feed) {
          if (item.audience) expect(screen === 'phone' && item.audience.includes(FIXTURE_PLAYER_ID)).toBe(true)
        }
        // Prompts belong to live games; standings are sorted.
        const live = new Set(s.games.filter((g) => g.status === 'active').map((g) => g.id))
        for (const p of s.prompts) expect(live.has(p.game_id)).toBe(true)
        for (let i = 1; i < s.standings.length; i++) expect(s.standings[i - 1].points).toBeGreaterThanOrEqual(s.standings[i].points)
      }
    }
  })

  it('keeps the open question’s answer and the fusion key off every screen but the host page until revealed', () => {
    // Every live scene: the host page gets states only of live games.
    const live = FUSION_STAGE_SCENES.filter((scene) => scene !== 'fusion-final')
    for (const scene of ['quiz-question', 'background', 'fusion-legacy', ...live] as const) {
      for (const screen of ['phone', 'tv'] as const) {
        const s = fixtureSnapshot(scene, screen)
        // Prompt specs are public: never an answer in them.
        expect(JSON.stringify(s.prompts)).not.toContain('correct')
        // The fusion key (picture number to people) lives only in the host's state.
        expect(JSON.stringify(s)).not.toContain('"key":{')
        for (const g of s.games) {
          const state = g.public_state as { phase?: string; index?: number; reveal?: unknown; pictures?: { revealed: unknown }[] } | null
          if (g.game_type === 'quiz' && state?.phase === 'question') {
            expect(state.reveal).toBeNull()
            expect(JSON.stringify(state)).not.toContain('"correct"')
            // A phone knows the right answer only of questions already revealed.
            const view = s.me?.views[g.id] as { last: { index: number } | null } | undefined
            if (view?.last) expect(view.last.index).toBeLessThan(state.index!)
          }
          for (const picture of state?.pictures ?? []) if (picture.revealed === null) expect(JSON.stringify(picture)).not.toContain('people')
        }
      }
      expect(JSON.stringify(fixtureSnapshot(scene, 'host').states)).toMatch(/"correct"|"key":\{/)
    }
  })

  it('matches the stage rules each scene is named for', () => {
    expect(phoneLayout(fixtureSnapshot('lobby', 'phone'), FIXTURE_NOW).main.kind).toBe('lobby')
    for (const scene of ['quiz-question', 'quiz-reveal', 'quiz-leaderboard'] as const) {
      const s = fixtureSnapshot(scene, 'tv')
      expect(tvScene(s, FIXTURE_NOW)).toMatchObject({ kind: 'live', game: { game_type: 'quiz' } })
      expect(phoneLayout(fixtureSnapshot(scene, 'phone'), FIXTURE_NOW).main).toMatchObject({ kind: 'game', onStage: true })
    }
    // A live round of the background version, on the TV since the update: live, as a lobby that never starts.
    expect(tvScene(fixtureSnapshot('fusion-legacy', 'tv'), FIXTURE_NOW)).toMatchObject({ kind: 'live', game: { game_type: 'fusion' } })
    expect(phoneLayout(fixtureSnapshot('fusion-legacy', 'phone'), FIXTURE_NOW).main).toMatchObject({ kind: 'game', onStage: true })
    const final = tvScene(fixtureSnapshot('final', 'tv'), FIXTURE_NOW)
    expect(final).toMatchObject({ kind: 'final', game: { game_type: 'elimination', winners: [expect.any(String)] } })
    expect(phoneLayout(fixtureSnapshot('final', 'phone'), FIXTURE_NOW).main.kind).toBe('result')
    const background = fixtureSnapshot('background', 'tv')
    expect(tvScene(background, FIXTURE_NOW)).toMatchObject({ kind: 'live', game: { game_type: 'quiz' } })
    expect(backgroundGames(background).map((g) => g.game_type).sort()).toEqual(['elimination', 'in-person'])
    expect(phoneLayout(fixtureSnapshot('background', 'phone'), FIXTURE_NOW).alsoRunning).toHaveLength(2)
    expect(tvScene(fixtureSnapshot('archived', 'tv'), FIXTURE_NOW).kind).toBe('over')
    expect(phoneLayout(fixtureSnapshot('archived', 'phone'), FIXTURE_NOW).main.kind).toBe('over')
  })

  it('shows the phone’s own state: unanswered in the question scene, locked in during background', () => {
    const quizOf = (scene: 'quiz-question' | 'background') => {
      const s = fixtureSnapshot(scene, 'phone')
      return { s, quiz: s.games.find((g) => g.game_type === 'quiz')! }
    }
    const question = quizOf('quiz-question')
    expect(question.s.me?.answers[question.quiz.id]?.q3).toBeUndefined()
    const background = quizOf('background')
    expect(background.s.me?.answers[background.quiz.id]?.q3).toEqual({ choice: [expect.any(String)] })
    expect(question.s.tallies[question.quiz.id].q3).toBeGreaterThan(0)
  })

  it('knows its scene names', () => {
    expect(isFixtureScene('final')).toBe(true)
    expect(isFixtureScene('nope')).toBe(false)
    expect(isFixtureScene(null)).toBe(false)
  })
})

describe('fixtureRecapDoc', () => {
  it('is a recap of the archived scene', () => {
    const doc = fixtureRecapDoc()
    const archived = fixtureSnapshot('archived', 'tv')
    expect(doc.version).toBe(1)
    expect(doc.standings.map((r) => r.playerId)).toEqual(archived.standings.map((r) => r.player_id))
    expect(doc.chapters).toHaveLength(archived.games.length)
    expect(Object.keys(doc.players)).toContain(FIXTURE_PLAYER_ID)
    expect(doc.race.length).toBeLessThanOrEqual(120)
    expect(doc.timeline.length).toBeLessThanOrEqual(60)
  })
})
