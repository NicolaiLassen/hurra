// The Lydspor fixture scenes (src/lib/fixtures.ts, spec 18.2) show what the
// screens are built against, and keep the room's secrets on every screen but
// the host page.
import { describe, expect, it } from 'vitest'
import { FIXTURE_PLAYER_ID, fixtureSnapshot, type FixtureScene } from '@/lib/fixtures'
import { readPublic, readView } from './read'
import { SAMPLE_SONGS, SOUNDTRACK_SCENES } from './samples'
import type { SoundtrackConfig, SoundtrackState } from './types'

const scene = (name: (typeof SOUNDTRACK_SCENES)[number]) => `soundtrack-${name}` as FixtureScene

function lydspor(name: (typeof SOUNDTRACK_SCENES)[number], screen: 'phone' | 'tv' | 'host') {
  const snapshot = fixtureSnapshot(scene(name), screen)
  const game = snapshot.games.find((g) => g.game_type === 'soundtrack')!
  return {
    snapshot,
    game,
    pub: readPublic(game.public_state)!,
    view: readView(snapshot.me?.views[game.id]),
    mine: snapshot.me?.answers[game.id] ?? {},
    held: snapshot.states?.[game.id] as { state: SoundtrackState; config: SoundtrackConfig } | undefined,
    tallies: snapshot.tallies[game.id] ?? {},
  }
}

describe('the Lydspor scenes', () => {
  it('put Lydspor on the TV in every phase, the crown last', () => {
    const phases = SOUNDTRACK_SCENES.map((name) => lydspor(name, 'tv').pub.phase)
    expect(phases).toEqual(['lobby', 'playing', 'lastCall', 'locked', 'reveal', 'standings', 'done'])
    for (const name of SOUNDTRACK_SCENES) {
      const { snapshot, game } = lydspor(name, 'tv')
      expect(snapshot.session?.spotlight_game_id).toBe(game.id)
      expect(game.status).toBe(name === 'final' ? 'finished' : 'active')
    }
  })

  it('play song 5 of 8: Sofie has typed songs 1 to 4, with one misspelling and one empty singer, and not song 5 yet', () => {
    const { pub, mine, tallies, held } = lydspor('playing', 'phone')
    expect(pub).toMatchObject({ total: 8, playing: 10 })
    expect(pub.playedAt).toHaveLength(5)
    expect(mine['s1.title']).toEqual({ text: 'Papir Lanterner' })
    expect(mine['s3.singer']).toBeUndefined()
    expect(Object.keys(mine).filter((key) => key.startsWith('s5.'))).toEqual([])
    expect(Object.keys(mine)).toHaveLength(11)
    expect(held).toBeUndefined()
    expect(lydspor('playing', 'tv').tallies['s5.title']).toBeGreaterThan(0)
    expect(tallies['s5.title']).toBeGreaterThan(0)
    expect(lydspor('playing', 'host').held!.state.phase).toBe('playing')
  })

  it('count down the last call, with parts still missing', () => {
    const { pub, mine, snapshot } = lydspor('last-call', 'phone')
    expect(pub.lockAt! - snapshot.now).toBe(38_000)
    expect(mine['s3.singer']).toBeUndefined()
    expect(mine['s7.event']).toBeUndefined()
  })

  it('reveal song 1 with one close title accepted and one close singer not', () => {
    const { pub, view, held } = lydspor('reveal', 'phone')
    expect(pub.reveal).toMatchObject({ n: 1, title: 'Paper Lanterns', singer: 'Mira Holm' })
    expect(view!.songs[0]).toMatchObject({ event: 'right', title: 'accepted', singer: 'wrong', points: 3 })
    const review = lydspor('reveal', 'host').held!.state.review![0]
    expect(review.title.filter((row) => row.verdict === 'close' && row.accepted)).toHaveLength(1)
    expect(review.singer.filter((row) => row.verdict === 'close' && !row.accepted).length).toBeGreaterThan(0)
    expect(held).toBeUndefined()
  })

  it('show the top 5 after reveal 4, with Sofie in the photo of song 4', () => {
    const { pub, view } = lydspor('standings', 'phone')
    expect(pub).toMatchObject({ phase: 'standings', revealed: 4 })
    expect(pub.top.length).toBeGreaterThan(0)
    expect(view!.songs[3]).toMatchObject({ inPhoto: true, points: 0 })
  })

  it('crown a winner and pay the night board at most 20', () => {
    const { pub, view, game, snapshot } = lydspor('final', 'phone')
    expect(pub.final!.length).toBeGreaterThan(0)
    expect(game.winners.length).toBeGreaterThan(0)
    expect(view!.final).toMatchObject({ credit: expect.any(Number) })
    expect(Math.max(...Object.values(snapshot.game_points[game.id] ?? {}))).toBeLessThanOrEqual(20)
    expect(pub.extras).toHaveLength(4)
  })

  it('never show an unrevealed song, or anyone else’s typed answer, on a phone or the TV', () => {
    for (const name of SOUNDTRACK_SCENES) {
      const revealed = lydspor(name, 'tv').pub.revealed
      const hidden = SAMPLE_SONGS.slice(revealed).flatMap((song) => [song.title, song.singer, song.caption])
      for (const screen of ['phone', 'tv'] as const) {
        const { snapshot, game } = lydspor(name, screen)
        // Sofie's own answers (myAnswers, and her locked ones in the view) are hers to see.
        const own = snapshot.me ? { ...snapshot.me, answers: {}, views: { ...snapshot.me.views, [game.id]: { ...(snapshot.me.views[game.id] as object), mine: null } } } : null
        const shown = JSON.stringify({ ...snapshot, me: own })
        for (const word of hidden) expect(shown, `${name} ${screen}: ${word}`).not.toContain(word)
        // Typed answers: only Sofie's own, in her own answers.
        expect(shown, `${name} ${screen}`).not.toContain('Myra Holmes')
        expect(JSON.stringify(snapshot.me?.views[game.id] ?? null)).not.toContain('Myra Holmes')
        expect(snapshot.states).toBeNull()
      }
    }
    expect(lydspor('playing', 'phone').snapshot.me!.player_id).toBe(FIXTURE_PLAYER_ID)
  })
})
