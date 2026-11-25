// Participant fusion's words on a guest's phone (spec 6.3), phase by phase and
// case by case: a voter, a lock, the two in the picture, time's up, a late
// joiner with no view yet, and each reveal outcome. Then the words of the
// section card and the result card.
import { describe, expect, it } from 'vitest'
import {
  askingCase,
  barNames,
  cardLine,
  doneWords,
  IN_PICTURE,
  lobbyWords,
  lockedWords,
  outcomeFor,
  outcomeHead,
  outcomeLine,
  outcomePoints,
  pickLine,
  placeParts,
  resultWords,
  showingWords,
  timeUpWords,
  wallWords,
  type Outcome,
  type Part,
} from '@/games/fusion/phoneLines'
import { readPublic, readView, type FusionPlayerView, type FusionPublicState, type FusionRules } from '@/games/fusion/shapes'
import { fixtureSnapshot, type FixtureScene } from '@/lib/fixtures'

const RULES: FusionRules = { seconds: 30, showSeconds: 6, perPerson: 1, bothBonus: 1 }
const view = (over: Partial<FusionPlayerView> = {}): FusionPlayerView => ({ points: 0, rank: null, hits: {}, inPicture: false, ...over })
const text = (parts: Part[] | null) => parts?.map((part) => part.text).join('') ?? null

describe('the lobby and the showing send eyes to the TV', () => {
  it('the lobby: what the round is, how it scores, and where it starts', () => {
    expect(lobbyWords(true, RULES)).toEqual({
      head: 'Two guests, one face.',
      line: 'Watch the TV.',
      body: 'Each picture shows on the TV first. Then you guess them one by one here: pick the two guests in it and lock in. 1 point for each right person, plus 1 for both.',
    })
    expect(lobbyWords(false, { ...RULES, bothBonus: 0 })).toMatchObject({
      line: 'It starts on the TV soon.',
      body: expect.stringMatching(/lock in\. 1 point for each right person\.$/),
    })
  })

  it('the showing: look at the TV, and which picture is on', () => {
    expect(showingWords('#3')).toEqual({
      head: 'Look at the TV.',
      line: 'Now showing #3.',
      body: 'Look closely. You guess them one by one after the showing.',
    })
    expect(showingWords(null).line).toBeNull()
  })
})

describe('the wall', () => {
  it('says what comes next', () => {
    expect(wallWords(0, 12, true)).toEqual({ head: 'The guessing starts soon.', line: 'Watch the TV.' })
    expect(wallWords(4, 12, true)).toEqual({ head: 'The next picture is coming up.', line: 'Watch the TV.' })
    expect(wallWords(4, 12, false)).toEqual({ head: 'The next picture is coming up.', line: null })
    expect(wallWords(12, 12, true)).toEqual({ head: 'That was the last picture.', line: 'The face detective is crowned soon.' })
  })

  it('says where you stand, the rank gold only for the leader', () => {
    expect(text(placeParts(view({ points: 3, rank: 4 }), true))).toBe('You have 3 points, 4th so far.')
    expect(placeParts(view({ points: 3, rank: 4 }), true)?.some((part) => part.leader)).toBe(false)
    expect(placeParts(view({ points: 1, rank: 1 }), true)).toEqual([
      { text: 'You have 1 point, ' },
      { text: '1st', leader: true },
      { text: ' so far.' },
    ])
    expect(text(placeParts(view({ points: 2 }), true))).toBe('You have 2 points.')
    expect(text(placeParts(view(), true))).toBe('No points yet.')
    expect(placeParts(view(), false)).toBeNull()
    // A late joiner has no view yet: no points.
    expect(text(placeParts(null, true))).toBe('No points yet.')
    expect(placeParts(null, false)).toBeNull()
  })
})

describe('a picture being guessed', () => {
  it('a voter: how picking works, the picks so far, the lock on its way', () => {
    expect(pickLine([], { kind: 'none' })).toBe('Pick two guests, then lock in. Only your first lock counts.')
    expect(pickLine(['Mads'], { kind: 'none' })).toBe('Mads and one more.')
    expect(pickLine(['Mads', 'Ida'], { kind: 'none' })).toBe("Mads and Ida. Lock in when you're sure.")
    expect(pickLine(['Mads', 'Ida'], { kind: 'sending', pick: ['m', 'i'] })).toBe('Locking in Mads and Ida…')
    expect(barNames([])).toBe('Pick two')
    expect(barNames(['Mads'])).toBe('Mads and one more')
    expect(barNames(['Mads', 'Ida'])).toBe('Mads and Ida')
  })

  it('a refused lock: the server’s words, with "Try again." when it can be', () => {
    expect(pickLine(['Mads', 'Ida'], { kind: 'refused', message: 'You already answered.', retry: false, closed: false })).toBe(
      'You already answered.',
    )
    expect(
      pickLine(['Mads', 'Ida'], {
        kind: 'refused',
        message: "Couldn't reach the game. Check your connection and try again.",
        retry: true,
        closed: false,
      }),
    ).toBe("Couldn't reach the game. Check your connection and try again.")
  })

  it('locked in: the two, and where the answer comes, with no gold', () => {
    expect(lockedWords(['Bo', 'Maja'], true)).toEqual({ head: 'Locked in: Bo and Maja.', line: 'The answer comes up on the TV.' })
    expect(lockedWords(['Bo', 'Maja'], false).line).toBe('The answer comes up soon.')
  })

  it('in the picture: sit it out with a straight face', () => {
    expect(IN_PICTURE).toEqual({
      head: 'This one is you.',
      line: "Keep a straight face. You sit this one out: nobody scores on a picture they're in.",
    })
  })

  it("time's up without a lock, with the database's words when a lock came too late", () => {
    expect(timeUpWords()).toEqual({ head: "Time's up.", line: 'No guess from you this time.' })
    expect(timeUpWords('Too late, answers are closed.').line).toBe('Too late, answers are closed. No guess from you this time.')
  })

  it('a late joiner (no view yet) gets the picker, as any voter', () => {
    const late = readView(null)
    expect(late).toBeNull()
    expect(askingCase({ inPicture: late?.inPicture === true, lockedIn: false, sending: false, over: false })).toBe('picking')
  })
})

describe('the reveal', () => {
  const picture = { n: 4, revealed: { people: ['bo', 'maja'] } }

  it('each outcome, from the view’s hits', () => {
    expect(outcomeFor(picture, 'me', view({ hits: { 4: 2 } }), null)).toBe('both')
    expect(outcomeFor(picture, 'me', view({ hits: { 4: 1 } }), null)).toBe('one')
    expect(outcomeFor(picture, 'me', view({ hits: { 4: 0 } }), null)).toBe('none')
    expect(outcomeFor(picture, 'me', view(), null)).toBe('noGuess')
    expect(outcomeFor(picture, 'bo', view({ inPicture: true }), null)).toBe('you')
  })

  it('from your own lock when the view has not caught up, and no guess for a late joiner', () => {
    expect(outcomeFor(picture, 'me', null, ['bo', 'maja'])).toBe('both')
    expect(outcomeFor(picture, 'me', view(), ['bo', 'ida'])).toBe('one')
    expect(outcomeFor(picture, 'me', null, ['ana', 'ida'])).toBe('none')
    expect(outcomeFor(picture, 'me', null, null)).toBe('noGuess')
    // The two in it score nothing, even with a lock.
    expect(outcomeFor(picture, 'maja', null, ['bo', 'ida'])).toBe('you')
  })

  it('heads, points and the one-line outcome', () => {
    const heads = (['both', 'one', 'none', 'noGuess', 'you'] as Outcome[]).map(outcomeHead)
    expect(heads).toEqual(['You got both.', 'You got one of the two.', 'Not this time.', 'No guess this time.', 'That was you.'])
    expect((['both', 'one', 'none', 'noGuess', 'you'] as Outcome[]).map((o) => outcomePoints(o, RULES))).toEqual([3, 1, 0, 0, 0])
    expect(outcomeLine('both', 3)).toBe('You got both (+3).')
    expect(outcomeLine('one', 1)).toBe('You got one of the two (+1).')
    expect(outcomeLine('none', 0)).toBe('Not this time.')
    expect(outcomeLine('you', 0)).toBe('That was you.')
  })

  it('once over, while still live', () => {
    expect(doneWords('Who is fused?')).toEqual({ head: 'Who is fused? is over.', line: null })
  })
})

describe('the section card, while another game holds the main card', () => {
  const pubOf = (scene: FixtureScene) => {
    const s = fixtureSnapshot(scene, 'phone')
    const game = s.games.find((g) => g.game_type === 'fusion')!
    return readPublic(game.public_state) as FusionPublicState
  }

  it('says where the round is, phase by phase', () => {
    expect(cardLine(null, null, null, null)).toBe('Getting the pictures ready…')
    expect(cardLine(pubOf('fusion-lobby'), null, null, null)).toBe('Starts on the TV soon')
    expect(cardLine(pubOf('fusion-showing'), null, null, null)).toBe('Showing on the TV')
    expect(cardLine({ ...pubOf('fusion-wall'), pictures: pubOf('fusion-lobby').pictures }, null, null, null)).toBe(
      '12 pictures. The guessing starts soon.',
    )
    expect(cardLine(pubOf('fusion-wall'), view({ points: 4 }), null, null)).toBe('3 of 12 revealed. You have 4 points.')
    const asking = pubOf('fusion-asking')
    expect(cardLine(asking, null, 'picking', null)).toBe('Guess #4 now')
    expect(cardLine(asking, null, 'locked', null)).toBe('Locked in on #4')
    expect(cardLine(asking, null, 'timeUp', null)).toBe("Time's up on #4")
    expect(cardLine(pubOf('fusion-asking-you'), null, 'inPicture', null)).toBe('#6 is on. You sit this one out.')
    const reveal = pubOf('fusion-reveal')
    expect(cardLine(reveal, null, null, { names: ['Bo', 'Maja'], outcome: 'both', points: 3 })).toBe('#4 was Bo and Maja. You got both (+3).')
    expect(cardLine(reveal, null, null, { names: ['you', 'Maja'], outcome: 'you', points: 0 })).toBe('#4 was you and Maja.')
  })
})

describe('the result card', () => {
  it('the winner, alone or tied', () => {
    expect(resultWords({ title: 'Fusion', winners: [], meWon: true, points: 9, both: 3, revealed: 12, total: 12, rank: 1 })).toEqual({
      kind: 'won',
      head: 'You have the sharpest eye.',
      line: "9 points, both people right on 3 pictures. You're the face detective.",
      tie: null,
    })
    expect(resultWords({ title: 'Fusion', winners: ['Ana'], meWon: true, points: 9, both: 0, revealed: 12, total: 12, rank: 1 })).toEqual({
      kind: 'won',
      head: 'You share the sharpest eye.',
      line: "9 points. You're a face detective.",
      tie: 'A tie with Ana.',
    })
  })

  it('who had it, and how you did', () => {
    expect(resultWords({ title: 'Fusion', winners: ['Ana'], meWon: false, points: 4, both: 1, revealed: 12, total: 12, rank: 4 })).toEqual({
      kind: 'other',
      head: 'Ana had the sharpest eye',
      scored: 'You scored 4 points',
      detail: "Both people right on 1 of 12 pictures. You're 4th of the face detectives.",
    })
    expect(resultWords({ title: 'Fusion', winners: ['Ana', 'Bo'], meWon: false, points: 0, both: 0, revealed: 10, total: 12, rank: null })).toEqual({
      kind: 'other',
      head: 'Ana and Bo had the sharpest eyes',
      scored: 'No points for you this time',
      detail: 'Both people right on 0 of the 10 revealed.',
    })
    expect(resultWords({ title: 'Fusion', winners: ['Ana'], meWon: false, points: 0, both: 0, revealed: 0, total: 12, rank: null }).kind).toBe('other')
    expect(resultWords({ title: 'Fusion', winners: ['Ana'], meWon: false, points: 0, both: 0, revealed: 0, total: 12, rank: null })).toMatchObject({
      detail: 'No pictures were revealed.',
    })
  })

  it('nobody scored', () => {
    expect(resultWords({ title: 'Fusion', winners: [], meWon: false, points: 0, both: 0, revealed: 3, total: 12, rank: null })).toEqual({
      kind: 'nobody',
      head: 'Fusion is over. Nobody scored this time.',
      scored: null,
    })
  })
})

describe('the words', () => {
  it('have no exclamation marks and no dashes', () => {
    const all = [
      ...Object.values(lobbyWords(true, RULES)),
      ...Object.values(showingWords('#3')),
      ...Object.values(wallWords(12, 12, true)),
      pickLine([], { kind: 'none' }),
      pickLine(['A', 'B'], { kind: 'none' }),
      ...Object.values(lockedWords(['A', 'B'], true)),
      ...Object.values(IN_PICTURE),
      ...Object.values(timeUpWords()),
      ...(['both', 'one', 'none', 'noGuess', 'you'] as Outcome[]).map((o) => outcomeLine(o, 2)),
    ].filter((line): line is string => typeof line === 'string')
    for (const line of all) {
      expect(line).not.toMatch(/[!\u2013\u2014]/)
    }
  })
})
