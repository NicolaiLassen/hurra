// Participant fusion's words on a guest's phone (spec 6.3), phase by phase and
// case by case: the wait while the TV shows which picture it is, a voter, a
// lock, the two in the picture (who guess like anyone), time's up, a late
// joiner with no view yet, and each reveal outcome. Then the section card and
// the result card, rendered from the fixture scenes as Sofie's phone gets them.
import { createElement, type ComponentType } from 'react'
import { prerender } from 'react-dom/static'
import { describe, expect, it } from 'vitest'
import PlayerCard from '@/games/fusion/PlayerCard'
import {
  askingCase,
  barNames,
  cardLine,
  doneWords,
  lobbyWords,
  lockedWords,
  outcomeFor,
  outcomeHead,
  outcomeLine,
  outcomePoints,
  pickLine,
  placeParts,
  resultWords,
  TILE_NAME_CHARS,
  tileNameLines,
  timeUpWords,
  waitWords,
  wallWords,
  type Outcome,
  type Part,
} from '@/games/fusion/phoneLines'
import ResultView from '@/games/fusion/ResultView'
import { readPublic, readView, type FusionPlayerView, type FusionPublicState, type FusionRules } from '@/games/fusion/shapes'
import { FIXTURE_NOW, FIXTURE_PLAYER_ID, fixtureSnapshot, type FixtureScene } from '@/lib/fixtures'

const RULES: FusionRules = { seconds: 30, perPerson: 1, bothBonus: 1 }
const view = (over: Partial<FusionPlayerView> = {}): FusionPlayerView => ({ points: 0, rank: null, hits: {}, ...over })
const text = (parts: Part[] | null) => parts?.map((part) => part.text).join('') ?? null

describe('the lobby and the suspense send eyes to the TV', () => {
  it('the lobby: what the round is, how it scores, and where it starts', () => {
    expect(lobbyWords(true, RULES)).toEqual({
      head: 'Two guests, one face.',
      line: 'Watch the TV.',
      body: 'The pictures come up on the TV one at a time. For each one, pick the two names in it here and lock in. 1 point for each right person, plus 1 for both.',
    })
    expect(lobbyWords(false, { ...RULES, bothBonus: 0 })).toMatchObject({
      line: 'It starts on the TV soon.',
      body: expect.stringMatching(/lock in\. 1 point for each right person\.$/),
    })
  })

  it('a picture asked, while the TV shows which one it is: look at the TV, the picker comes next', () => {
    expect(waitWords(true)).toEqual({ head: 'Look at the TV.', line: 'The next picture is on its way. Then pick the two in it.' })
    expect(waitWords(false).head).toBe('The next picture is coming.')
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
    expect(text(placeParts(view({ points: 3, rank: 4 }), true))).toBe('You have 3 points, 4th of the face detectives so far.')
    expect(placeParts(view({ points: 3, rank: 4 }), true)?.some((part) => part.leader)).toBe(false)
    expect(placeParts(view({ points: 1, rank: 1 }), true)).toEqual([
      { text: 'You have 1 point, ' },
      { text: '1st', leader: true },
      { text: ' of the face detectives so far.' },
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
    expect(pickLine([], { kind: 'none' })).toBe('Pick two names, then lock in. Only your first lock counts.')
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

  it('in the picture: the same picker and the same words as everyone, their lock sent like anyone’s', () => {
    // Nothing says "this one is you" any more: the two in it guess and score like anyone (their own name isn't offered).
    expect(pickLine([], { kind: 'none' })).toBe('Pick two names, then lock in. Only your first lock counts.')
    expect(pickLine(['Mads', 'Ida'], { kind: 'locked', pick: ['Mads', 'Ida'] })).toBe('Locking in Mads and Ida…')
    expect(timeUpWords()).toEqual({ head: "Time's up.", line: 'No guess from you this time.' })
  })

  it("time's up without a lock, with the database's words when a lock came too late", () => {
    expect(timeUpWords()).toEqual({ head: "Time's up.", line: 'No guess from you this time.' })
    expect(timeUpWords('Too late, answers are closed.').line).toBe('Too late, answers are closed. No guess from you this time.')
  })

  it('a late joiner (no view yet) gets the picker, as any voter', () => {
    const late = readView(null)
    expect(late).toBeNull()
    expect(askingCase({ lockedIn: false, sending: false, over: false })).toBe('picking')
  })
})

describe('the reveal', () => {
  const picture = { n: 4, revealed: { names: ['Bo', 'Maja'] as [string, string] } }

  it('each outcome, from the view’s hits, the two in it like anyone', () => {
    expect(outcomeFor(picture, 'Sofie', view({ hits: { 4: 2 } }), null)).toBe('both')
    expect(outcomeFor(picture, 'Sofie', view({ hits: { 4: 1 } }), null)).toBe('one')
    expect(outcomeFor(picture, 'Sofie', view({ hits: { 4: 0 } }), null)).toBe('none')
    expect(outcomeFor(picture, 'Sofie', view(), null)).toBe('noGuess')
    expect(outcomeFor(picture, 'Bo', view({ hits: { 4: 1 } }), null)).toBe('one')
  })

  it('from your own lock when the view has not caught up, names folded, and no guess for a late joiner', () => {
    expect(outcomeFor(picture, 'Sofie', null, ['bo', 'MAJA'])).toBe('both')
    expect(outcomeFor(picture, 'Sofie', view(), ['Bo', 'Ida'])).toBe('one')
    expect(outcomeFor(picture, 'Sofie', null, ['Ana', 'Ida'])).toBe('none')
    expect(outcomeFor(picture, 'Sofie', null, null)).toBe('noGuess')
    // In it: their own name never counts, the other one does.
    expect(outcomeFor(picture, 'Maja', null, ['Bo', 'Ida'])).toBe('one')
    expect(outcomeFor(picture, 'Maja', null, ['Maja', 'Ida'])).toBe('none')
    // In teams (no own name left out): it counts like any other.
    expect(outcomeFor(picture, null, null, ['Maja', 'Ida'])).toBe('one')
    expect(outcomeFor(picture, null, null, ['Maja', 'Bo'])).toBe('both')
  })

  it('heads, points and the one-line outcome', () => {
    const heads = (['both', 'one', 'none', 'noGuess'] as Outcome[]).map(outcomeHead)
    expect(heads).toEqual(['You got both.', 'You got one of the two.', 'Not this time.', 'No guess this time.'])
    expect((['both', 'one', 'none', 'noGuess'] as Outcome[]).map((o) => outcomePoints(o, RULES))).toEqual([3, 1, 0, 0])
    expect(outcomeLine('both', 3)).toBe('You got both (+3).')
    expect(outcomeLine('one', 1)).toBe('You got one of the two (+1).')
    expect(outcomeLine('none', 0)).toBe('Not this time.')
    expect(outcomeLine('noGuess', 0)).toBe('No guess this time.')
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
    expect(cardLine(pubOf('fusion-start'), null, null, null)).toBe('12 pictures. The guessing starts soon.')
    expect(cardLine({ ...pubOf('fusion-wall'), pictures: pubOf('fusion-lobby').pictures }, null, null, null)).toBe(
      '12 pictures. The guessing starts soon.',
    )
    expect(cardLine(pubOf('fusion-wall'), view({ points: 4 }), null, null)).toBe('3 of 12 revealed. You have 4 points.')
    const asking = pubOf('fusion-asking')
    expect(cardLine(asking, null, 'picking', null)).toBe('Guess #4 now')
    expect(cardLine(asking, null, 'locked', null)).toBe('Locked in on #4')
    expect(cardLine(asking, null, 'timeUp', null)).toBe("Time's up on #4")
    expect(cardLine(pubOf('fusion-asking-you'), null, 'picking', null)).toBe('Guess #6 now')
    const reveal = pubOf('fusion-reveal')
    expect(cardLine(reveal, null, null, { names: ['Bo', 'Maja'], outcome: 'both', points: 3 })).toBe('#4 was Bo and Maja. You got both (+3).')
    expect(cardLine(reveal, null, null, { names: ['you', 'Maja'], outcome: 'one', points: 1 })).toBe('#4 was you and Maja. You got one of the two (+1).')
  })

  it('renders over a picture being asked: the row and an outlined Guess with the seconds left', async () => {
    const html = await renderCard('fusion-asking')
    expect(plain(html)).toContain('Guess #4 now')
    expect(html).toMatch(/data-variant="outline"[^>]*>Guess/)
    expect(html).not.toMatch(/data-variant="default"/)
    expect(plain(await renderCard('fusion-asking-locked'))).toContain('Locked in on #4')
    // The two in the picture get the same row and Guess, and guess like anyone.
    const you = await renderCard('fusion-asking-you')
    expect(plain(you)).toContain('Guess #6 now')
    expect(you).toMatch(/data-variant="outline"[^>]*>Guess/)
    expect(plain(await renderCard('fusion-reveal'))).toContain('#4 was Bo and Maja. You got both (+3).')
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

  it('renders the finished round as Sofie’s phone gets it', async () => {
    const s = fixtureSnapshot('fusion-final', 'phone')
    const game = s.games.find((g) => g.game_type === 'fusion')!
    const sofie = s.players.find((p) => p.id === FIXTURE_PLAYER_ID)!
    const props = {
      session: s.session!,
      game,
      player: sofie,
      players: s.players,
      publicState: game.public_state,
      view: s.me?.views[game.id] ?? null,
      gamePoints: s.game_points[game.id] ?? {},
    }
    const html = await render(ResultView as ComponentType<never>, props)
    expect(plain(html)).toContain('Emil had the sharpest eye')
    // 14: one of the two in #6, the picture she is in, scores like any guess.
    expect(plain(html)).toContain("You scored 14 points Both people right on 3 of 12 pictures. You're 2nd of the face detectives.")
  })
})

describe('a name on a picker tile', () => {
  it('breaks after a hyphen or at a space, and stays whole otherwise', () => {
    expect(tileNameLines('Ana')).toEqual(['Ana'])
    expect(tileNameLines('Christoffer')).toEqual(['Christoffer'])
    expect(tileNameLines('Marie-Louise')).toEqual(['Marie-', 'Louise'])
    expect(tileNameLines('Anna  Holm')).toEqual(['Anna', 'Holm'])
    expect(tileNameLines('Anne-Marie Holm')).toEqual(['Anne-', 'Marie Holm'])
    expect(tileNameLines('Bo Marie-Holm')).toEqual(['Bo', 'Marie-Holm'])
    expect(tileNameLines('Ida-')).toEqual(['Ida-'])
  })

  it('steps a line over 8 characters down a size', () => {
    expect(TILE_NAME_CHARS).toBe(8)
    expect('Christoffer'.length).toBeGreaterThan(TILE_NAME_CHARS)
    expect(tileNameLines('Marie-Louise').every((line) => line.length <= TILE_NAME_CHARS)).toBe(true)
  })
})

describe('the words', () => {
  it('have no exclamation marks and no dashes', () => {
    const all = [
      ...Object.values(lobbyWords(true, RULES)),
      ...Object.values(waitWords(true)),
      ...Object.values(waitWords(false)),
      ...Object.values(wallWords(12, 12, true)),
      pickLine([], { kind: 'none' }),
      pickLine(['A', 'B'], { kind: 'none' }),
      ...Object.values(lockedWords(['A', 'B'], true)),
      ...Object.values(timeUpWords()),
      ...(['both', 'one', 'none', 'noGuess'] as Outcome[]).map((o) => outcomeLine(o, 2)),
    ].filter((line): line is string => typeof line === 'string')
    for (const line of all) {
      expect(line).not.toMatch(/[!\u2013\u2014]/)
    }
  })
})

// Rendering ----------------------------------------------------------------------

const ENTITIES: Record<string, string> = { '&#x27;': "'", '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>' }
const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&quot;|&amp;|&lt;|&gt;/g, (entity) => ENTITIES[entity])
    .replace(/\s+/g, ' ')

async function render(view: ComponentType<never>, props: Record<string, unknown>): Promise<string> {
  const errors: unknown[] = []
  const { prelude } = await prerender(createElement(view, props as never), { onError: (error) => void errors.push(error) })
  if (errors.length > 0) throw errors[0]
  return new Response(prelude).text()
}

/** Fusion's section card over a scene, as Sofie's phone would draw it beside another game. */
function renderCard(scene: FixtureScene): Promise<string> {
  const s = fixtureSnapshot(scene, 'phone')
  const game = s.games.find((g) => g.game_type === 'fusion')!
  return render(PlayerCard as ComponentType<never>, {
    session: s.session!,
    game,
    players: s.players,
    player: s.players.find((p) => p.id === FIXTURE_PLAYER_ID)!,
    publicState: game.public_state,
    prompts: s.prompts.filter((p) => p.game_id === game.id),
    serverNow: () => FIXTURE_NOW,
    mediaUrl: (path: string) => `/media/${path}`,
    view: s.me?.views[game.id] ?? null,
    myAnswers: s.me?.answers[game.id] ?? {},
    onStage: false,
    act: async () => {},
    submit: async () => ({ accepted: true, answer: { choice: [] }, at: FIXTURE_NOW, ms: 0 }),
    open: () => {},
  })
}
