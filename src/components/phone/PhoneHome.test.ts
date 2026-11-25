// The phone home over every fixture scene (src/lib/fixtures.ts, docs/engine-v2.md
// 5.11), as Sofie's phone reads it: which card is main and what it says, On
// the TV, the sections of background games, the result card, "Your night",
// the one gold step, and the notices for a guest who is no longer in the
// party. Rendered to static HTML under Node: no effects run, so this checks
// what the page shows on its first render of each snapshot.
import { createElement, type ReactElement } from 'react'
import { prerender } from 'react-dom/static'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { FixtureMode } from '@/components/phone/calls'
import { GenericPlayerCard, GenericResult } from '@/components/phone/GenericCards'
import PhoneHome from '@/components/phone/PhoneHome'
import { clockTime } from '@/components/phone/text'
import { FIXTURE_NOW, FIXTURE_PLAYER_ID, FIXTURE_SESSION_ID, fixtureRecapDoc, fixtureSnapshot, type FixtureScene } from '@/lib/fixtures'
import type { RecapDoc } from '@/lib/recap'
import type { Snapshot } from '@/lib/types'
import { LiveSessionProvider } from '@/lib/useLive'

// No network here: the provider renders the fixture, and nothing calls the client while rendering.
vi.mock('@/lib/supabase', () => ({ supabase: {} }))

const ENTITIES: Record<string, string> = { '&#x27;': "'", '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' }

/** Some static HTML. */
async function markupOf(tree: ReactElement): Promise<string> {
  const errors: unknown[] = []
  const { prelude } = await prerender(tree, { onError: (error) => void errors.push(error) })
  if (errors.length > 0) throw errors[0]
  return new Response(prelude).text()
}

/** Plain text from markup, one space between elements. */
const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&quot;|&amp;|&lt;|&gt;|&nbsp;/g, (entity) => ENTITIES[entity])
    .replace(/\s+/g, ' ')

/** The text of some static HTML, one space between elements. */
const textOf = async (tree: ReactElement) => plain(await markupOf(tree))

/** The section headings (h2) in order, as text. */
const headings = (html: string) => [...html.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map(([, inner]) => plain(inner).trim())

/** The gold buttons (Button's default variant: the one next step on a screen), as text. */
const goldButtons = (html: string) =>
  [...html.matchAll(/<button data-slot="button" data-variant="default"[^>]*>(.*?)<\/button>/g)].map(([, inner]) => plain(inner).trim())

/** The phone home over a fixture scene (or any snapshot), as Sofie's phone shows it. */
async function phone(scene: FixtureScene | Snapshot, url = '/play/HURRA30', recap: RecapDoc | null = fixtureRecapDoc()): Promise<string> {
  return plain(await phoneMarkup(scene, url, recap))
}

async function phoneMarkup(scene: FixtureScene | Snapshot, url = '/play/HURRA30', recap: RecapDoc | null = fixtureRecapDoc()): Promise<string> {
  const lobby = fixtureSnapshot('lobby', 'phone')
  const home = createElement(PhoneHome, {
    party: lobby.session!,
    player: { id: FIXTURE_PLAYER_ID, name: 'Sofie' },
    fixtureRecap: recap,
  })
  const live = createElement(LiveSessionProvider, {
    sessionId: FIXTURE_SESSION_ID,
    screen: 'phone',
    playerId: FIXTURE_PLAYER_ID,
    fixture: typeof scene === 'string' ? fixtureSnapshot(scene, 'phone') : scene,
    children: home,
  })
  return markupOf(createElement(MemoryRouter, { initialEntries: [url] }, createElement(FixtureMode.Provider, { value: true }, live)))
}

describe('the phone home', () => {
  it('lobby: you are in, your place, On the TV, the standings and the code bar', async () => {
    const text = await phone('lobby')
    expect(text).toContain("You're in.")
    expect(text).toContain('12 players here')
    expect(text).toContain('Standings')
    expect(text).toContain('Show my code')
    // On the TV: Now, then the games still to come in the host's running order.
    expect(text).toContain('On the TV Now The night so far Next Last one standing Later Quiz Then 1 more')
    // Your place leads, On the TV follows, the standings sit below them.
    expect(text.indexOf('Sofie , tonight')).toBeLessThan(text.indexOf('On the TV'))
    expect(text.indexOf('On the TV')).toBeLessThan(text.indexOf('Standings'))
  })

  it('a quiz question on the TV: letters only, with the question number on the strap', async () => {
    const html = await phoneMarkup('quiz-question')
    const text = plain(html)
    // The quiz's own strap words (phoneStrap), where the strap said "On the TV" before it had them.
    expect(text).toContain('Quiz Question 3 of 10')
    expect(text).toContain('The question is on the TV.')
    // The quiz opens its prompts with `final`, so the first tap counts, and the phone says so.
    expect(text).toContain('Tap the letter of your answer. Your first tap counts.')
    expect(text).toContain('Show the answers here')
    // The question and the answers stay on the TV until this phone asks for them.
    expect(text).not.toContain('What is the capital of Denmark?')
    expect(text).not.toContain('Copenhagen')
    // Four tiles, named by their letters.
    expect([...html.matchAll(/data-answer-tile="" aria-label="([A-D])"/g)].map(([, letter]) => letter)).toEqual(['A', 'B', 'C', 'D'])
    expect(text).not.toContain('Locked in')
    // The code bar steps aside while the timed question is open, so it covers no answer.
    expect(text).not.toContain('Show my code')
  })

  it('the quiz reveal and leaderboard stay on the main card, with the code bar back', async () => {
    const reveal = await phone('quiz-reveal')
    expect(reveal).toContain('Quiz Question 3 of 10')
    // Sofie picked Copenhagen: right, in words and with no exclamation mark.
    expect(reveal).toContain('You got it.')
    expect(reveal).not.toContain('!')
    expect(reveal).toContain('Show my code')
    expect(await phone('quiz-leaderboard')).toContain('Quiz After question 3 of 10')
  })

  it('Participant fusion on the stage: the lobby and the showing send eyes to the TV', async () => {
    const lobby = await phone('fusion-lobby')
    expect(lobby).toContain('Who is fused? On the TV')
    expect(lobby).toContain('Two guests, one face. Watch the TV.')
    expect(lobby).toContain('1 point for each right person, plus 1 for both.')
    const showing = await phone('fusion-showing')
    // The strap without the clock; the picture on show by the database clock (2.5 pictures in).
    expect(showing).toContain('Who is fused? Showing 12 pictures')
    expect(showing).toContain('Look at the TV. Now showing #3.')
  })

  it('fusion on the wall: what comes next, your place and your guesses, newest first', async () => {
    const wall = await phone('fusion-wall')
    expect(wall).toContain('Who is fused? 3 of 12 revealed')
    expect(wall).toContain('The next picture is coming up. Watch the TV.')
    expect(wall).toContain('You have 4 points, 1st of the face detectives so far.')
    expect(wall).toContain('Your guesses #3 Ana and Noah Not this time. #2 Freja and Oscar You got one of the two (+1). #1 Mads and Ida You got both (+3).')
    expect(await phone('fusion-crown')).toContain('That was the last picture. The face detective is crowned soon.')
  })

  it('fusion while a picture is asked: everyone but you to pick from, two picked, then Lock in', async () => {
    const html = await phoneMarkup('fusion-asking')
    const text = plain(html)
    expect(text).toContain('Who is fused? Picture 4 of 12')
    expect(text).toContain('#4 Who is in it? 18 s left')
    expect(text).toContain('Pick two guests, then lock in. Only your first lock counts.')
    // Everyone in the party but Sofie, by name; 11 guests, so no search.
    // Each tile: the token (which names its guest too) and the first name.
    const tiles = [...html.matchAll(/data-guest-tile=""[^>]*>(.*?)<\/button>/g)].map(([, inner]) => plain(inner).trim().split(' ').at(-1))
    expect(tiles).toEqual(['Ana', 'Bo', 'Clara', 'Emil', 'Freja', 'Ida', 'Lars', 'Mads', 'Maja', 'Noah', 'Oscar'])
    expect(text).not.toContain('Find a guest')
    expect(text).toContain('Pick two Lock in')
    // Who is in it is nowhere on the phone before its reveal.
    expect(text).not.toMatch(/Bo and Maja|Maja and Bo/)
  })

  it('fusion asked: locked in, and the two in the picture get the same picker, told it won\'t count', async () => {
    const locked = await phone('fusion-asking-locked')
    expect(locked).toContain('Locked in: Bo and Maja. The answer comes up on the TV.')
    const you = await phone('fusion-asking-you')
    expect(you).toContain('#6 Who is in it?')
    expect(you).toContain("This one is you. Keep a straight face and pick any two: it won't count.")
    expect(you).toContain('Pick two Lock in')
  })

  it('fusion revealed: what you got, who it was, your two picks and your place', async () => {
    const both = await phone('fusion-reveal')
    expect(both).toContain('Who is fused? Picture 4 of 12')
    expect(both).toContain('You got both. +3 points')
    // Tokens name their guests too, so each name reads twice in plain text.
    expect(both).toContain('#4 It was Bo Bo Maja Maja')
    expect(both).toContain('Your guess Bo Bo Right Maja Maja Right')
    expect(both).toContain('You have 7 points, 1st of the face detectives so far.')
    expect(await phone('fusion-reveal-one')).toContain('You got one of the two. +1 point')
    expect(await phone('fusion-reveal-one')).toContain('Not in it')
    expect(await phone('fusion-reveal-none')).toContain('Not this time.')
    const missed = await phone('fusion-reveal-missed')
    expect(missed).toContain('No guess this time.')
    expect(missed).not.toContain('Your guess')
    const you = await phone('fusion-reveal-you')
    expect(you).toContain('That was you.')
    expect(you).toContain('#6 It was Emil Emil Sofie You')
    for (const scene of ['fusion-reveal', 'fusion-reveal-one', 'fusion-reveal-none', 'fusion-reveal-missed', 'fusion-reveal-you'] as const) {
      expect(await phone(scene), scene).not.toContain('!')
    }
  })

  it('fusion over: the result card; a round from before the update reads as the lobby', async () => {
    const final = await phone('fusion-final')
    expect(final).toContain('Emil had the sharpest eye')
    expect(final).toContain('You scored 13 points')
    const legacy = await phone('fusion-legacy')
    expect(legacy).toContain('Who is fused? On the TV')
    expect(legacy).toContain('Two guests, one face. Watch the TV.')
  })

  it('a finished game: the result card, then waiting for the next game', async () => {
    const text = await phone('final')
    expect(text).toContain('Last one standing Finished')
    // Sofie was tagged by Bo, the last one standing.
    expect(text).toContain("You're out")
    expect(text).toContain('Bo won.')
    expect(text).toContain('Waiting for the next game')
  })

  it('several games: the stage game is main, then each background game in its own section, oldest start first', async () => {
    const snapshot = fixtureSnapshot('background', 'phone')
    const html = await phoneMarkup(snapshot)
    const text = plain(html)
    expect(text).toContain('Quiz Question 3 of 10')
    // Sofie has answered the open question.
    expect(text).toContain('Locked in')
    // Each game running underneath has its own section, headed by its tab: the
    // quiz on the main card, then Last one standing (started first), then the darts.
    expect(headings(html)).toEqual(['Quiz', 'Last one standing', 'Darts'])
    expect(text.indexOf('Sofie , tonight')).toBeLessThan(text.indexOf('Last one standing'))
    expect(text.indexOf('Last one standing')).toBeLessThan(text.indexOf('Darts'))
    expect(text.indexOf('Darts')).toBeLessThan(text.indexOf('Standings'))
    // The hunt's section: where Sofie stands, how many are left and the latest knockout at its time.
    const hunt = snapshot.games.find((g) => g.game_type === 'elimination')!
    const [latest] = (hunt.public_state as { feed: { at: number }[] }).feed
    expect(text).toContain(`Last one standing Who is left You're still in. 8 of 12 left. Mads got Oscar at ${clockTime(latest.at)}.`)
    expect(text).toContain('Your secret task')
    expect(text).toContain('Got someone? Scan their code')
  })

  it("has one gold step at most: Show my code, never a game's button or a Live chip", async () => {
    const fusion = ['fusion-lobby', 'fusion-showing', 'fusion-wall', 'fusion-reveal', 'fusion-reveal-you', 'fusion-crown', 'fusion-final', 'fusion-legacy'] as const
    for (const scene of ['lobby', 'quiz-reveal', 'quiz-leaderboard', 'final', ...fusion] as const) {
      const html = await phoneMarkup(scene)
      expect(goldButtons(html), scene).toEqual(['Show my code S9F4X'])
      expect(html, scene).not.toMatch(/data-slot="badge" data-variant="default"/)
    }
    // While a fusion picture is asked, Lock in is the one gold step and Show my code steps aside,
    // for the two in the picture too (their lock stays on the phone); once locked in, nothing is gold.
    expect(goldButtons(await phoneMarkup('fusion-asking'))).toEqual(['Lock in'])
    expect(goldButtons(await phoneMarkup('fusion-asking-you'))).toEqual(['Lock in'])
    expect(goldButtons(await phoneMarkup('fusion-asking-locked'))).toEqual([])
    // While the quiz's timed question is open, the code bar steps aside: no gold button at all,
    // and the hunt's Scan stays outlined.
    const background = await phoneMarkup('background')
    expect(goldButtons(background)).toEqual([])
    expect(background).not.toMatch(/data-slot="badge" data-variant="default"/)
  })

  it('a removed guest: no longer in the party, with Join again', async () => {
    const text = await phone('removed')
    expect(text).toContain("You're no longer in Birthday party")
    expect(text).toContain('Join again')
    expect(text).not.toContain('Show my code')
  })

  it('a guest whose player moved to another phone: the moved notice, also after a sleep (snapshot.moved)', async () => {
    const text = await phone({ ...fixtureSnapshot('removed', 'phone'), moved: true })
    expect(text).toContain('Your player moved to another phone')
    expect(text).not.toContain("You're no longer in")
  })

  it('the party is over: that is a wrap, Your night from the published recap, no code bar', async () => {
    const text = await phone('archived')
    expect(text).toContain("That's a wrap.")
    expect(text).toContain('Here is your night.')
    expect(text).toContain('Your night')
    expect(text).toContain('Points by game')
    expect(text).not.toContain('Show my code')
    expect(text).not.toContain('Also running')
  })

  it('no "Your night" for a guest the published recap does not know', async () => {
    const recap = fixtureRecapDoc()
    const others = Object.fromEntries(Object.entries(recap.players).filter(([id]) => id !== FIXTURE_PLAYER_ID))
    const text = await phone('archived', undefined, { ...recap, players: others })
    expect(text).toContain("That's a wrap.")
    expect(text).not.toContain('Your night')
    expect(text).not.toContain('Here is your night.')
  })

  it('a game that finished while another holds the main card is a Finished lately row', async () => {
    // The final scene's finished Last one standing, with a quiz started after it.
    const final = fixtureSnapshot('final', 'phone')
    const snapshot: Snapshot = {
      ...final,
      session: { ...final.session!, spotlight_game_id: null },
      games: final.games.map((g) => (g.game_type === 'quiz' ? { ...g, status: 'active', started_at: FIXTURE_NOW - 10_000, public_state: null } : g)),
    }
    const text = await phone(snapshot)
    expect(text).toContain('Quiz Since')
    expect(text).toContain('Finished lately')
    expect(text).toContain('Bo won Last one standing')
    expect(text).not.toContain('Waiting for the next game')
  })
})

describe('the generic cards, for games without their own', () => {
  const players = fixtureSnapshot('lobby', 'phone').players
  const sofie = players.find((p) => p.id === FIXTURE_PLAYER_ID)!
  const bo = players.find((p) => p.name === 'Bo')!
  const final = fixtureSnapshot('final', 'phone')
  const game = { ...final.games[0], title: 'Bingo', game_type: 'bingo' }
  const result = (winners: string[], gamePoints: Record<string, number>) =>
    textOf(
      createElement(GenericResult, {
        session: final.session!,
        game: { ...game, winners },
        player: sofie,
        players,
        publicState: null,
        view: null,
        gamePoints,
      }),
    )

  it('a result: who won and what you scored', async () => {
    expect(await result([bo.id], { [sofie.id]: 3 })).toContain('Bo won You scored 3 points.')
    expect(await result([sofie.id, bo.id], {})).toContain("You and Bo won You didn't score in this one.")
    expect(await result([], { [sofie.id]: 1 })).toContain('Bingo is over You scored 1 point.')
  })

  it('a compact card: the title, Live and a way in', async () => {
    const text = await textOf(createElement(GenericPlayerCard, { game: { ...game, status: 'active' }, open: () => {} }))
    expect(text).toContain('Bingo Open to play Live')
  })
})
