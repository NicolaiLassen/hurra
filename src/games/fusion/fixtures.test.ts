// Participant fusion's sample parties (src/lib/fixtures.ts, docs/engine-v2.md
// 5.11): one scene per step of the stage round, read through the game's own
// readers. Here, beside the game, so the core's tests never import a game.
import { describe, expect, it } from 'vitest'
import { readPublic, readView, type FusionPublicState } from '@/games/fusion/shapes'
import { FIXTURE_NOW, fixtureSnapshot, FUSION_STAGE_SCENES, type FusionStageScene } from '@/lib/fixtures'
import { backgroundGames, phoneLayout, tvScene } from '@/lib/stage'

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

  it('offers the names to guess with each picture’s guess, everyone here and the names in the pictures, and lists no one expected', () => {
    for (const scene of FUSION_STAGE_SCENES) {
      for (const screen of ['phone', 'tv', 'host'] as const) expect(fusionOf(scene, screen).pub, scene).not.toHaveProperty('expected')
    }
    const { s, game } = fusionOf('fusion-asking', 'phone')
    const spec = s.prompts.find((p) => p.game_id === game.id && p.key === 'p4')!.spec
    expect(spec).toMatchObject({ kind: 'choice', min: 2, max: 2, final: true })
    const options = (spec as unknown as { options: string[] }).options
    // Zelda is on the guest list and in #3; Tilde on no list, in #7; Quentin, listed in no picture, is not offered.
    expect(options).toEqual(expect.arrayContaining(['Ana', 'Sofie', 'Zelda', 'Tilde']))
    expect(options).not.toContain('Quentin')
    expect(new Set(options).size).toBe(options.length)
  })

  it('keeps who is in a picture off the TV and the phones until its reveal', () => {
    for (const scene of FUSION_STAGE_SCENES.filter((s) => s !== 'fusion-final')) {
      const { state } = hostState(scene)
      for (const screen of ['phone', 'tv'] as const) {
        const { s, pub, game } = fusionOf(scene, screen)
        expect(s.states).toBeNull()
        for (const picture of pub.pictures) {
          if (picture.revealed) expect(picture.revealed.names, scene).toEqual(state.key[picture.n])
          else expect(JSON.stringify(picture), scene).not.toMatch(/people|names/)
        }
        // A view says nothing about who is in a picture: points, place and hits.
        if (screen === 'phone') expect(Object.keys(s.me!.views[game.id] as object)).toEqual(['points', 'rank', 'hits'])
      }
    }
  })

  it("keeps each picture's image off the TV and the phones until it is asked: placeholders till then", () => {
    for (const scene of FUSION_STAGE_SCENES) {
      for (const screen of ['phone', 'tv'] as const) {
        const { s, pub } = fusionOf(scene, screen)
        for (const picture of pub.pictures) {
          const asked = picture.revealed !== null || pub.current?.n === picture.n
          expect(picture.asked, `${scene} #${picture.n}`).toBe(asked)
          expect(picture.image, `${scene} #${picture.n}`).toBe(asked ? `fixture/fusion-${picture.n}.jpg` : null)
        }
        const unasked = pub.pictures.filter((p) => !p.asked).map((p) => `fixture/fusion-${p.n}.jpg`)
        const text = JSON.stringify(s)
        for (const path of unasked) expect(text, scene).not.toContain(`"${path}"`)
      }
    }
    expect(fusionOf('fusion-start').pub.pictures.every((p) => !p.asked)).toBe(true)
  })

  it("keeps the two people's own photos off the TV and the phones until their picture's reveal", () => {
    for (const scene of FUSION_STAGE_SCENES.filter((s) => s !== 'fusion-final')) {
      const settings = hostState(scene).config.pictures as { originals?: [string | null, string | null] }[]
      for (const screen of ['phone', 'tv'] as const) {
        const { s, pub } = fusionOf(scene, screen)
        for (const picture of pub.pictures) {
          if (picture.revealed) expect(picture.revealed.originals, scene).toEqual(settings[picture.n - 1].originals ?? [null, null])
          else expect(JSON.stringify(picture), scene).not.toContain('original-')
        }
        // Nothing else a screen reads carries one: the views, the prompts, the feed.
        expect(JSON.stringify({ me: s.me, prompts: s.prompts, feed: s.feed }), scene).not.toContain('original-')
      }
    }
    // The reveal of #4 has both photos; #6 only the first person's; the plain scene none.
    expect(fusionOf('fusion-reveal').pub.pictures[3].revealed?.originals).toEqual(['fixture/original-4-1.jpg', 'fixture/original-4-2.jpg'])
    expect(fusionOf('fusion-reveal-you').pub.pictures[5].revealed?.originals).toEqual(['fixture/original-6-1.jpg', null])
    expect(fusionOf('fusion-reveal-plain').pub.pictures[3].revealed?.originals).toEqual([null, null])
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

  it('has 2, 8, 12 and 40 pictures, each with a sample image in the settings, shown once asked', () => {
    for (const [scene, count] of [['fusion-wall-2', 2], ['fusion-wall-8', 8], ['fusion-wall', 12], ['fusion-wall-40', 40]] as const) {
      const { pub } = fusionOf(scene)
      expect(pub.pictures).toHaveLength(count)
      expect(pub.pictures.filter((p) => p.asked).every((p) => p.image === `fixture/fusion-${p.n}.jpg`)).toBe(true)
      const settings = hostState(scene).config.pictures as { image: string }[]
      expect(settings).toHaveLength(count)
      expect(settings.every((p, i) => p.image === `fixture/fusion-${i + 1}.jpg`)).toBe(true)
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
    expect(lobby.pub).toMatchObject({ phase: 'lobby', current: null, top: [] })
    expect(lobby.s.session!.spotlight_at).toBe(FIXTURE_NOW - 60_000)
    expect(Object.keys(hostState('fusion-lobby').state.key)).toHaveLength(10)

    // The first wall, before any picture is asked: every one a placeholder.
    for (const [scene, count] of [['fusion-start', 12], ['fusion-start-2', 2], ['fusion-start-8', 8]] as const) {
      const { pub } = at(scene)
      expect(pub, scene).toMatchObject({ phase: 'wall', current: null })
      expect(pub.pictures.filter((p) => !p.asked)).toHaveLength(count)
    }

    // The wall: 3 revealed (1 of 2, 15 of 40); Sofie got both on #1, one on #2, none on #3.
    expect(revealed(at('fusion-wall').pub)).toEqual([1, 2, 3])
    expect(revealed(at('fusion-wall-2').pub)).toEqual([1])
    expect(revealed(at('fusion-wall-8').pub)).toEqual([1, 2, 3])
    expect(revealed(at('fusion-wall-40').pub)).toHaveLength(15)
    expect(sofie('fusion-wall').view).toEqual({ points: 4, rank: expect.any(Number), hits: { 1: 2, 2: 1, 3: 0 } })

    // The suspense: #4 asked 3 s after the scene's clock starts, its countdown after the TV's suspense.
    for (const [scene, n] of [['fusion-hop', 4], ['fusion-hop-2', 2], ['fusion-hop-8', 4]] as const) {
      const { pub } = at(scene)
      expect(pub.current, scene).toMatchObject({ n, openedAt: FIXTURE_NOW + 3_000, startsAt: FIXTURE_NOW + 5_800, endsAt: FIXTURE_NOW + 35_800 })
      expect(sofie(scene).tallies).toEqual({})
    }

    // Asking: #4 (#2, #16), 18 s left, 7 locked in, Sofie not yet.
    for (const [scene, n] of [['fusion-asking', 4], ['fusion-asking-2', 2], ['fusion-asking-40', 16]] as const) {
      const { pub, game } = at(scene)
      expect(pub.current, scene).toMatchObject({ n, key: `p${n}`, endsAt: FIXTURE_NOW + 18_000, revealedAt: null })
      expect(pub.current!.startsAt - pub.current!.openedAt).toBe(2_800)
      expect(pub.current!.step).toBe(revealed(pub).length + 1)
      expect(game.wake_at).toBe(FIXTURE_NOW + 18_000 + 1250)
      expect(sofie(scene).tallies).toEqual({ [`p${n}`]: 7 })
      expect(sofie(scene).answers[`p${n}`]).toBeUndefined()
    }
    // A lock is two names.
    expect((sofie('fusion-asking-locked').answers.p4 as { choice: string[] }).choice).toEqual(['Bo', 'Maja'])

    // #6 asked out of order, as picture 4 of 12: Sofie is in it, and guesses like anyone.
    expect(at('fusion-asking-you').pub.current).toMatchObject({ n: 6, step: 4 })
    expect(sofie('fusion-asking-you').view).not.toHaveProperty('inPicture')

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
