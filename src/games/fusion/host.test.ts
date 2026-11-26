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
  it('in the lobby: ask the first picture (no showing), or show the wall of placeholders first', () => {
    const { steps, pub } = scene('fusion-lobby')
    expect(steps()).toEqual({
      main: { label: 'Ask #1', icon: 'ask', action: { type: 'ask', n: 1 } },
      extra: [{ label: 'Show the wall first', icon: 'wall', action: { type: 'wall', from: 'lobby' } }],
      line: 'Ask when the room is looking at the TV: it picks the picture with a little suspense, then the guessing starts.',
      confirm: crownConfirm(12),
    })
    expect(PHASE_CHIP[pub.phase]).toBe('Ready')
    expect(headline(pub)).toBe('12 pictures')
  })

  it('in the lobby with no picture’s people typed yet: the wall only, and what to do', () => {
    const { steps } = scene('fusion-lobby', (s) => ({ ...s, key: {} }))
    expect(steps().main).toBeNull()
    expect(steps().extra.map((step) => step.label)).toEqual(['Show the wall first'])
    expect(steps().line).toBe('No picture has its two people yet. Type them with Show who, then ask.')
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
    expect(headline(pub)).toBe('3 of 12 revealed')
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

  it('while a picture is asked: Reveal now, closing its guess first, with the count of who has locked in, everyone counting', () => {
    const { steps, pub, players } = scene('fusion-asking')
    const { main, extra, line, confirm } = steps()
    expect(main).toEqual({ label: 'Reveal now', icon: 'reveal', action: { type: 'reveal', n: 4 }, close: ['p4'] })
    expect(extra).toEqual([])
    expect(confirm).toBeNull()
    // 12 guests, the 2 in #4 among them: everyone guesses every picture.
    expect(mayVote(players)).toBe(12)
    expect(line).toBe("7 of 12 have locked in. It reveals by itself when time's up.")
    expect(steps(FIXTURE_NOW, players, { p4: 12 }).line).toBe('Everyone has locked in. Reveal now.')
    expect(steps(pub.current!.endsAt).line).toBe("Time's up. Tap Reveal now if the reveal doesn't come.")
    expect(PHASE_CHIP[pub.phase]).toBe('Guessing')
    expect(headline(pub)).toBe('Picture 4 of 12: #4')
  })

  it('while the TV shows which picture it is: the guessing starts in a moment', () => {
    const { steps, pub } = scene('fusion-hop')
    expect(steps(pub.current!.openedAt + 1_000).line).toBe('The TV is picking the picture. The guessing starts in a moment.')
    expect(steps(pub.current!.startsAt).line).toBe("0 of 12 have locked in. It reveals by itself when time's up.")
  })

  it('counts the guess of a picture asked out of order by its place in the guessing', () => {
    const { pub, steps } = scene('fusion-asking-you')
    expect(headline(pub)).toBe('Picture 4 of 12: #6')
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
    expect(headline({ ...pub, phase: 'done' })).toBe('Participant fusion is over')
  })
})
