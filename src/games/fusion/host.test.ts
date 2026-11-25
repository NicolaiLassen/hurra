import { describe, expect, it } from 'vitest'
import { FIXTURE_NOW, fixtureSnapshot, type FusionStageScene } from '@/lib/fixtures'
import { crownConfirm, headline, hostSteps, mayVote, nextToAsk, PHASE_CHIP } from './host'
import type { FusionState } from './logic'
import { readPublic } from './shapes'

/** A host page's view of a fixture scene, at `now`. */
function scene(name: FusionStageScene, patch: (state: FusionState) => FusionState = (s) => s) {
  const s = fixtureSnapshot(name, 'host')
  const game = s.games.find((g) => g.game_type === 'fusion')!
  const pub = readPublic(game.public_state)!
  const state = patch(s.states![game.id].state as FusionState)
  const tallies = s.tallies[game.id] ?? {}
  const steps = (now = FIXTURE_NOW, players = s.players, counts = tallies) => hostSteps(pub, state, counts, players, now)
  return { pub, state, tallies, players: s.players, steps }
}

describe('the host’s steps', () => {
  it('in the lobby: start the showing, or skip it for the wall', () => {
    const { steps, pub } = scene('fusion-lobby')
    expect(steps()).toEqual({
      main: { label: 'Start the showing', icon: 'play', action: { type: 'show' } },
      extra: [{ label: 'Skip the showing: go to the wall', icon: 'wall', action: { type: 'wall', from: 'lobby' } }],
      line: 'Start when the room is looking at the TV. Each picture shows for 6 s, then all of them.',
      confirm: crownConfirm(12),
    })
    expect(PHASE_CHIP[pub.phase]).toBe('Ready')
    expect(headline(pub, FIXTURE_NOW)).toBe('12 pictures')
  })

  it('in the showing: skip to the wall, which follows by itself', () => {
    const { steps, pub } = scene('fusion-showing')
    expect(steps().main).toEqual({ label: 'Skip to the wall', icon: 'wall', action: { type: 'wall', from: 'showing' } })
    expect(steps().extra).toEqual([])
    // 12 pictures of 6 s, started 15 s ago.
    expect(steps().line).toBe('The wall follows by itself in 57 s.')
    expect(steps(pub.showing!.endsAt).line).toBe('The wall is coming up.')
    expect(headline(pub, FIXTURE_NOW)).toBe('Showing 3 of 12')
  })

  it('on the wall: ask the next picture with its people set, crowning early in the menu behind a confirm', () => {
    const { steps, pub } = scene('fusion-wall')
    const { main, extra, line, confirm } = steps()
    expect(main).toEqual({ label: 'Ask #4', icon: 'ask', action: { type: 'ask', n: 4 } })
    expect(extra).toEqual([{ label: 'Crown the face detective now…', icon: 'crown', action: { type: 'finish' }, confirm: crownConfirm(9) }])
    expect(line).toBe('Ask the next picture when the room is ready, or ask any picture below.')
    expect(confirm).toEqual({
      title: 'Crown the face detective now?',
      description: "9 pictures haven't been asked. They stay secret, and nobody scores on them.",
      cancel: 'Keep going',
      action: 'Crown now',
    })
    expect(headline(pub, FIXTURE_NOW)).toBe('3 of 12 revealed')
  })

  it('skips a picture without its people for the next one that has them', () => {
    const { pub, state } = scene('fusion-wall', (s) => ({ ...s, key: Object.fromEntries(Object.entries(s.key).filter(([n]) => n !== '4')) }))
    expect(nextToAsk(pub, state)?.n).toBe(5)
  })

  it('on the wall with nothing left to ask: crown, asking first while unasked pictures remain', () => {
    const all = scene('fusion-crown')
    expect(all.steps()).toEqual({
      main: { label: 'Crown the face detective', icon: 'crown', action: { type: 'finish' } },
      extra: [],
      line: 'That was the last picture. Crown the face detective.',
      confirm: null,
    })
    const unset = scene('fusion-wall-2', (s) => ({ ...s, key: { 1: s.key[1] } }))
    expect(unset.steps()).toEqual({
      main: { label: 'Crown the face detective…', icon: 'crown', action: { type: 'finish' }, confirm: crownConfirm(1) },
      extra: [],
      line: "1 picture doesn't have their two people set. Set them with Show who to ask them, or crown the face detective.",
      confirm: crownConfirm(1),
    })
    expect(crownConfirm(1).description).toBe("1 picture hasn't been asked. It stays secret, and nobody scores on it.")
  })

  it('while a picture is asked: Reveal now, closing its guess first, with the exact count of who has locked in', () => {
    const { steps, pub, state, players } = scene('fusion-asking')
    const { main, extra, line, confirm } = steps()
    expect(main).toEqual({ label: 'Reveal now', icon: 'reveal', action: { type: 'reveal', n: 4 }, close: ['p4'] })
    expect(extra).toEqual([])
    expect(confirm).toBeNull()
    // 12 guests, 2 of them in #4.
    expect(mayVote(state, 4, players)).toBe(10)
    expect(line).toBe("7 of 10 have locked in. It reveals by itself when time's up.")
    expect(steps(FIXTURE_NOW, players, { p4: 10 }).line).toBe('Everyone has locked in. Reveal now.')
    expect(steps(pub.current!.endsAt).line).toBe("Time's up. Tap Reveal now if the reveal doesn't come.")
    expect(PHASE_CHIP[pub.phase]).toBe('Guessing')
    expect(headline(pub, FIXTURE_NOW)).toBe('Picture 4 of 12: #4')
  })

  it('counts the guess of a picture asked out of order by its place in the guessing', () => {
    const { pub, steps } = scene('fusion-asking-you')
    expect(headline(pub, FIXTURE_NOW)).toBe('Picture 4 of 12: #6')
    expect(steps().main?.action).toEqual({ type: 'reveal', n: 6 })
  })

  it('after a reveal: back to the wall, or skip it to ask the next picture', () => {
    const { steps, pub } = scene('fusion-reveal')
    const { main, extra, line } = steps()
    expect(main).toEqual({ label: 'Back to the wall', icon: 'wall', action: { type: 'wall', from: 'reveal', n: 4 } })
    expect(extra).toEqual([{ label: 'Skip the wall: ask #5', icon: 'ask', action: { type: 'ask', n: 5 } }])
    const counts = pub.pictures[3].revealed!
    expect(line).toBe(`${counts.both} of ${counts.voters} got both, ${counts.one} got one. The wall follows by itself in 9 s.`)
    expect(PHASE_CHIP[pub.phase]).toBe('Revealed')
  })

  it('after the last reveal: skip the wall to crown the face detective', () => {
    const { steps } = scene('fusion-reveal-2')
    expect(steps().extra).toEqual([{ label: 'Skip the wall: crown the face detective', icon: 'crown', action: { type: 'finish' } }])
  })

  it('once over, or for a round of the background version: no steps', () => {
    const { pub } = scene('fusion-wall')
    const none = { main: null, extra: [], line: null, confirm: null }
    expect(hostSteps({ ...pub, phase: 'done' }, null, {}, [], FIXTURE_NOW)).toEqual(none)
    expect(hostSteps(pub, { phase: 'locked' } as unknown as FusionState, {}, [], FIXTURE_NOW)).toEqual(none)
    expect(headline({ ...pub, phase: 'done' }, FIXTURE_NOW)).toBe('Participant fusion is over')
  })
})
