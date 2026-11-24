// The phone home over every fixture scene (src/lib/fixtures.ts, docs/engine-v2.md
// 5.11), as Sofie's phone reads it: which card is main and what it says, the
// compact cards of background games, the result card, "Your night", and the
// notices for a guest who is no longer in the party. Rendered to static HTML
// under Node: no effects run, so this checks what the page shows on its first
// render of each snapshot.
import { createElement, type ReactElement } from 'react'
import { prerender } from 'react-dom/static'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { FixtureMode } from '@/components/phone/calls'
import { GenericPlayerCard, GenericResult } from '@/components/phone/GenericCards'
import PhoneHome from '@/components/phone/PhoneHome'
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
  it('lobby: you are in, with the standings and the code bar', async () => {
    const text = await phone('lobby')
    expect(text).toContain("You're in.")
    expect(text).toContain('12 players here')
    expect(text).toContain('Standings')
    expect(text).toContain('Show my code')
    expect(text).not.toContain('Also running')
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

  it('fusion voting off the TV is "Now playing"; locked on the TV is "On the TV"', async () => {
    const voting = await phone('fusion-voting')
    expect(voting).toContain('Who is fused? Live')
    expect(voting).toContain('Vote on the pictures')
    expect(await phone('fusion-locked')).toContain('Who is fused? On the TV')
  })

  it('a finished game: the result card, then waiting for the next game', async () => {
    const text = await phone('final')
    expect(text).toContain('Last one standing Finished')
    // Sofie was tagged by Bo, the last one standing.
    expect(text).toContain("You're out")
    expect(text).toContain('Bo won.')
    expect(text).toContain('Waiting for the next game')
  })

  it('several games: the stage game is main, the background games are compact cards', async () => {
    const text = await phone('background')
    expect(text).toContain('Quiz Question 3 of 10')
    // Sofie has answered the open question.
    expect(text).toContain('Locked in')
    expect(text).toContain('Last one standing')
    expect(text).toContain('Who is fused?')
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
