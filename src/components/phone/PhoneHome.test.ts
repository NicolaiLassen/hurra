// The phone home over every fixture scene (src/lib/fixtures.ts, docs/engine-v2.md
// 5.11), as Sofie's phone reads it: which card is main and what it says, On
// the TV, the sections of background games, the result card, "Your night",
// the one gold step, and the notices for a guest who is no longer in the
// party. Rendered to static HTML under Node: no effects run, so this checks
// what the page shows on its first render of each snapshot.
import { createElement, type ReactElement } from 'react'
import { prerender } from 'react-dom/static'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { FixtureMode } from '@/components/phone/calls'
import { GenericPlayerCard, GenericResult } from '@/components/phone/GenericCards'
import PhoneHome from '@/components/phone/PhoneHome'
import { clockTime } from '@/components/phone/text'
import { FIXTURE_NOW, FIXTURE_PLAYER_ID, FIXTURE_SESSION_ID, fixtureRecapDoc, fixtureSnapshot, type FixtureScene } from '@/lib/fixtures'
import type { RecapDoc } from '@/lib/recap'
import type { Snapshot } from '@/lib/types'
import { LiveSessionProvider } from '@/lib/useLive'
import { freedNameOf } from '@/pages/joinScreen'

/** Reports the join page's router state: what a freed phone's join page reads its name from. */
function JoinStateProbe({ onState }: { onState: (state: unknown) => void }) {
  onState(useLocation().state)
  return null
}

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

  it('Participant fusion on the stage: the lobby and the suspense of a picture asked send eyes to the TV', async () => {
    const lobby = await phone('fusion-lobby')
    expect(lobby).toContain('Who is fused? On the TV')
    expect(lobby).toContain('Two guests, one face. Watch the TV.')
    expect(lobby).toContain('1 point for each right person, plus 1 for both.')
    const start = await phone('fusion-start')
    expect(start).toContain('Who is fused? 12 pictures')
    expect(start).toContain('The guessing starts soon. Watch the TV.')
    // A picture asked, while the TV shows which one it is: no picture and no picker yet.
    const hop = await phoneMarkup('fusion-hop')
    expect(plain(hop)).toContain('Who is fused? Picture 4 of 12')
    expect(plain(hop)).toContain('Look at the TV. The next picture is on its way. Then pick the two in it.')
    expect(hop).not.toContain('data-name-tile')
    expect(hop).not.toContain('fixture/fusion-4')
  })

  it('fusion on the wall: what comes next, your place and your guesses, newest first', async () => {
    const wall = await phone('fusion-wall')
    expect(wall).toContain('Who is fused? 3 of 12 revealed')
    expect(wall).toContain('The next picture is coming up. Watch the TV.')
    expect(wall).toContain('You have 4 points, 1st of the face detectives so far.')
    // #3 is of Zelda, on the guest list, who never joined: her name comes from the picture.
    expect(wall).toContain('Your guesses #3 Ana and Zelda Not this time. #2 Freja and Oscar You got one of the two (+1). #1 Mads and Ida You got both (+3).')
    expect(await phone('fusion-crown')).toContain('That was the last picture. The face detective is crowned soon.')
  })

  it('fusion while a picture is asked: names only to pick from, never your own, two picked, then Lock in', async () => {
    const html = await phoneMarkup('fusion-asking')
    const text = plain(html)
    expect(text).toContain('Who is fused? Picture 4 of 12')
    expect(text).toContain('#4 Who is in it? 18 s left')
    expect(text).toContain('Pick two names, then lock in. Only your first lock counts.')
    // The names the guess offers, A to Z, Sofie's own left out: everyone here, and the names in the pictures
    // nobody joined with (Tilde, Zelda). Quentin, on the guest list in no picture, is not one. 13 names: no search.
    const tiles = [...html.matchAll(/data-name-tile=""[^>]*>(.*?)<\/button>/g)].map(([, inner]) => plain(inner).trim())
    expect(tiles).toEqual(['Ana', 'Bo', 'Clara', 'Emil', 'Freja', 'Ida', 'Lars', 'Mads', 'Maja', 'Noah', 'Oscar', 'Tilde', 'Zelda'])
    // Names only: no token and no photo on a tile.
    const picker = html.slice(html.indexOf('aria-label="Names"'), html.indexOf('data-lock-bar'))
    expect(picker).not.toMatch(/<img|data-avatar|data-slot="avatar"/)
    expect(text).not.toContain('Not here yet')
    expect(text).not.toContain('Find a name')
    expect(text).toContain('Pick two Lock in')
    // Who is in it is nowhere on the phone before its reveal.
    expect(text).not.toMatch(/Bo and Maja|Maja and Bo/)
  })

  it('fusion asked: locked in, by name; the two in the picture get the same picker and words as anyone, without their own name', async () => {
    const locked = await phone('fusion-asking-locked')
    expect(locked).toContain('Locked in: Bo and Maja. The answer comes up on the TV.')
    const youHtml = await phoneMarkup('fusion-asking-you')
    const you = plain(youHtml)
    expect(you).toContain('#6 Who is in it?')
    expect(you).not.toContain('This one is you')
    expect(you).toContain('Pick two names, then lock in.')
    expect(you).toContain('Pick two Lock in')
    const tiles = [...youHtml.matchAll(/data-name-tile=""[^>]*>(.*?)<\/button>/g)].map(([, inner]) => plain(inner).trim())
    expect(tiles).not.toContain('Sofie')
    expect(tiles).toContain('Emil')
  })

  it('fusion revealed: what you got, who it was, your two picks and your place', async () => {
    const both = await phone('fusion-reveal')
    expect(both).toContain('Who is fused? Picture 4 of 12')
    // Your result first, then the picture with its label chip, the two people on their own photos named on
    // paper chips, how the room did, and your picks (tokens name their guests too, so those names read twice).
    // 9 voters: Bo and Maja, in it, guessed too.
    expect(both).toContain('You got both. +3 points #4 It was Bo Maja 3 of 9 got both, 4 got one. Your guess Bo Bo Right Maja Maja Right')
    expect(both).toContain('You have 7 points, 1st of the face detectives so far.')
    expect(await phone('fusion-reveal-one')).toContain('You got one of the two. +1 point')
    expect(await phone('fusion-reveal-one')).toContain('Not in it')
    expect(await phone('fusion-reveal-none')).toContain('Not this time.')
    const missed = await phone('fusion-reveal-missed')
    expect(missed).toContain('No guess this time.')
    expect(missed).not.toContain('Your guess')
    // Sofie is in #6: she guessed like anyone (Emil right, and one not in it). She has no own photo there, so her token names her.
    const you = await phone('fusion-reveal-you')
    expect(you).toContain('You got one of the two. +1 point')
    expect(you).toContain('#6 It was Emil Sofie')
    expect(you).toContain('Your guess Emil Emil Right Noah Noah Not in it')
    for (const scene of ['fusion-reveal', 'fusion-reveal-one', 'fusion-reveal-none', 'fusion-reveal-missed', 'fusion-reveal-you'] as const) {
      expect(await phone(scene), scene).not.toContain('!')
    }
  })

  it('fusion over: the result card; a round from before the update reads as the lobby', async () => {
    const final = await phone('fusion-final')
    expect(final).toContain('Emil had the sharpest eye')
    // 14: Sofie scored on #6, the picture she is in, like anyone.
    expect(final).toContain('You scored 14 points')
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
    const fusion = ['fusion-lobby', 'fusion-start', 'fusion-wall', 'fusion-reveal', 'fusion-reveal-you', 'fusion-crown', 'fusion-final', 'fusion-legacy'] as const
    for (const scene of ['lobby', 'quiz-reveal', 'quiz-leaderboard', 'final', ...fusion] as const) {
      const html = await phoneMarkup(scene)
      expect(goldButtons(html), scene).toEqual(['Show my code S9F4X'])
      expect(html, scene).not.toMatch(/data-slot="badge" data-variant="default"/)
    }
    // While a fusion picture is asked, Lock in is the one gold step and Show my code steps aside,
    // for the two in the picture too; once locked in, and while the TV shows which picture it is, nothing is gold.
    expect(goldButtons(await phoneMarkup('fusion-asking'))).toEqual(['Lock in'])
    expect(goldButtons(await phoneMarkup('fusion-asking-you'))).toEqual(['Lock in'])
    expect(goldButtons(await phoneMarkup('fusion-asking-locked'))).toEqual([])
    expect(goldButtons(await phoneMarkup('fusion-hop'))).toEqual([])
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

  it('a guest whose name the host freed: no notice, straight back to Who are you? with the name (snapshot.freed)', async () => {
    const freed = { ...fixtureSnapshot('removed', 'phone'), freed: true }
    const html = await phoneMarkup(freed)
    // The phone home renders only the redirect to the join page (react-router's Navigate draws nothing).
    expect(plain(html).trim()).toBe('')
    expect(html).not.toContain('no longer in')
    const followed: string[] = []
    const join = createElement(JoinStateProbe, { onState: (state: unknown) => followed.push(freedNameOf(state) ?? 'none') })
    await markupOf(
      createElement(
        MemoryRouter,
        { initialEntries: [{ pathname: '/join/HURRA30', state: { freed: 'Sofie' } }] },
        createElement(Routes, null, createElement(Route, { path: '/join/:joinCode', element: join })),
      ),
    )
    expect(followed).toEqual(['Sofie'])
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
