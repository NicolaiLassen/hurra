import { describe, expect, it } from 'vitest'
import { readPublic, readView, type FusionPublicState } from '@/games/fusion/shapes'
import {
  FIXTURE_NOW,
  FIXTURE_PLAYER_ID,
  FIXTURE_SCENES,
  fixtureRecapDoc,
  fixtureSnapshot,
  FUSION_STAGE_SCENES,
  isFixtureScene,
  type FusionStageScene,
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

describe('Participant fusion on the stage', () => {
  const fusionOf = (scene: FusionStageScene, screen: 'phone' | 'tv' | 'host' = 'tv') => {
    const s = fixtureSnapshot(scene, screen)
    const game = s.games.find((g) => g.game_type === 'fusion')!
    return { s, game, pub: readPublic(game.public_state)! }
  }
  const hostState = (scene: FusionStageScene) => {
    const { s, game } = fusionOf(scene, 'host')
    return s.states![game.id] as { state: { key: Record<string, [string, string]>; revealed: number[] }; config: { pictures: unknown[] } }
  }

  it('gives every scene the full public state, as the screens read it', () => {
    for (const scene of FUSION_STAGE_SCENES) {
      const { pub } = fusionOf(scene)
      expect(readPublic(JSON.parse(JSON.stringify(pub))), scene).toEqual(pub)
    }
  })

  it('keeps who is in a picture off the TV and the phones until its reveal', () => {
    for (const scene of FUSION_STAGE_SCENES.filter((s) => s !== 'fusion-final')) {
      const { state } = hostState(scene)
      for (const screen of ['phone', 'tv'] as const) {
        const { s, pub, game } = fusionOf(scene, screen)
        expect(s.states).toBeNull()
        for (const picture of pub.pictures) {
          if (picture.revealed) expect(picture.revealed.people, scene).toEqual(state.key[picture.n])
          else expect(JSON.stringify(picture), scene).not.toMatch(/people|names/)
        }
        // A view says only whether its own guest is in the picture.
        if (screen === 'phone') expect(Object.keys(s.me!.views[game.id] as object)).toEqual(['points', 'rank', 'hits', 'inPicture'])
      }
    }
  })

  it('holds the TV, with Last one standing in the background; the final scene is the winner’s screen', () => {
    for (const scene of FUSION_STAGE_SCENES.filter((s) => s !== 'fusion-final')) {
      expect(tvScene(fixtureSnapshot(scene, 'tv'), FIXTURE_NOW), scene).toMatchObject({ kind: 'live', game: { game_type: 'fusion' } })
      expect(backgroundGames(fixtureSnapshot(scene, 'tv')).map((g) => g.game_type), scene).toEqual(['elimination'])
      expect(phoneLayout(fixtureSnapshot(scene, 'phone'), FIXTURE_NOW).main, scene).toMatchObject({ kind: 'game', onStage: true })
    }
    expect(tvScene(fixtureSnapshot('fusion-final', 'tv'), FIXTURE_NOW)).toMatchObject({ kind: 'final', game: { game_type: 'fusion' } })
    expect(phoneLayout(fixtureSnapshot('fusion-final', 'phone'), FIXTURE_NOW).main.kind).toBe('result')
  })

  it('has 2, 12 and 40 pictures, each with a sample image', () => {
    for (const [scene, count] of [['fusion-wall-2', 2], ['fusion-wall', 12], ['fusion-wall-40', 40]] as const) {
      const { pub } = fusionOf(scene)
      expect(pub.pictures).toHaveLength(count)
      expect(pub.pictures.every((p) => p.image === `fixture/fusion-${p.n}.jpg`)).toBe(true)
      expect(hostState(scene).config.pictures).toHaveLength(count)
    }
  })

  it('plays each phase as the spec’s table says', () => {
    const at = (scene: FusionStageScene) => fusionOf(scene)
    const revealed = (pub: FusionPublicState) => pub.pictures.filter((p) => p.revealed).map((p) => p.n)
    const sofie = (scene: FusionStageScene) => {
      const { s, game } = fusionOf(scene, 'phone')
      return { view: readView(s.me!.views[game.id])!, answers: s.me!.answers[game.id] ?? {}, tallies: s.tallies[game.id] ?? {} }
    }

    // The lobby, a minute in; two of the party's 12 still wait for their people.
    const lobby = at('fusion-lobby')
    expect(lobby.pub).toMatchObject({ phase: 'lobby', showing: null, current: null, top: [] })
    expect(lobby.s.session!.spotlight_at).toBe(FIXTURE_NOW - 60_000)
    expect(Object.keys(hostState('fusion-lobby').state.key)).toHaveLength(10)

    // The showing on its third picture (its second of two), the wall due at its end.
    for (const [scene, onShow] of [['fusion-showing', 2], ['fusion-showing-2', 1], ['fusion-showing-40', 2]] as const) {
      const { pub, game } = at(scene)
      expect(Math.floor((FIXTURE_NOW - pub.showing!.startedAt) / 6000), scene).toBe(onShow)
      expect(game.wake_at).toBe(pub.showing!.endsAt)
    }

    // The wall: 3 revealed (1 of 2, 15 of 40); Sofie got both on #1, one on #2, none on #3.
    expect(revealed(at('fusion-wall').pub)).toEqual([1, 2, 3])
    expect(revealed(at('fusion-wall-2').pub)).toEqual([1])
    expect(revealed(at('fusion-wall-40').pub)).toHaveLength(15)
    expect(sofie('fusion-wall').view).toMatchObject({ points: 4, hits: { 1: 2, 2: 1, 3: 0 }, inPicture: false })

    // Asking: #4 (#2, #16), 18 s left, 7 locked in, Sofie not yet.
    for (const [scene, n] of [['fusion-asking', 4], ['fusion-asking-2', 2], ['fusion-asking-40', 16]] as const) {
      const { pub, game } = at(scene)
      expect(pub.current, scene).toMatchObject({ n, key: `p${n}`, endsAt: FIXTURE_NOW + 18_000, revealedAt: null })
      expect(pub.current!.step).toBe(revealed(pub).length + 1)
      expect(game.wake_at).toBe(FIXTURE_NOW + 18_000 + 1250)
      expect(sofie(scene).tallies).toEqual({ [`p${n}`]: 7 })
      expect(sofie(scene).answers[`p${n}`]).toBeUndefined()
      expect(sofie(scene).view.inPicture).toBe(false)
    }
    const locked = sofie('fusion-asking-locked')
    const { s } = fusionOf('fusion-asking-locked', 'phone')
    const name = (id: string) => s.players.find((p) => p.id === id)?.name
    expect((locked.answers.p4 as { choice: string[] }).choice.map(name).sort()).toEqual(['Bo', 'Maja'])

    // #6 asked out of order, as picture 4 of 12: Sofie is in it.
    expect(at('fusion-asking-you').pub.current).toMatchObject({ n: 6, step: 4 })
    expect(sofie('fusion-asking-you').view.inPicture).toBe(true)

    // The reveal: #4, 1.5 s ago; Sofie got both (+3). The wall follows 10 s after it.
    const reveal = at('fusion-reveal')
    expect(reveal.pub.current).toMatchObject({ n: 4, step: 4, revealedAt: FIXTURE_NOW - 1500 })
    expect(reveal.pub.pictures[3].revealed).toMatchObject({ step: 4, at: FIXTURE_NOW - 1500 })
    expect(reveal.game.wake_at).toBe(FIXTURE_NOW - 1500 + 10_000)
    expect(sofie('fusion-reveal').view).toMatchObject({ points: 7, hits: { 4: 2 } })
    expect(at('fusion-reveal-2').pub.current!.n).toBe(2)
    expect(at('fusion-reveal-40').pub.current!.n).toBe(16)

    // Every picture revealed: the crown is next. Then the final, a minute ago.
    expect(at('fusion-crown').pub.phase).toBe('wall')
    expect(revealed(at('fusion-crown').pub)).toHaveLength(12)
    const final = at('fusion-final')
    expect(final.pub.phase).toBe('done')
    expect(final.game).toMatchObject({ status: 'finished', finished_at: FIXTURE_NOW - 60_000, winners: [expect.any(String)] })
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
