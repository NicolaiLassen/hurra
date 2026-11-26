// Lydspor on Sofie's phone over every fixture scene (src/lib/fixtures.ts),
// through the real phone home: what each phase says, the typed fields'
// keyboard settings, one gold step at most, and the result card. Rendered
// to static HTML under Node: no effects run, so this checks each first render.
import { createElement, type ComponentType, type ReactElement } from 'react'
import { prerender } from 'react-dom/static'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { FixtureMode } from '@/components/phone/calls'
import PhoneHome from '@/components/phone/PhoneHome'
import PlayerView from '@/games/soundtrack/PlayerView'
import ResultView from '@/games/soundtrack/ResultView'
import { FIXTURE_PLAYER_ID, FIXTURE_SESSION_ID, fixtureRecapDoc, fixtureSnapshot, type FixtureScene } from '@/lib/fixtures'
import type { SessionGame } from '@/lib/types'
import { LiveSessionProvider } from '@/lib/useLive'

// No network here: the provider renders the fixture; photos get a plain public URL.
vi.mock('@/lib/supabase', () => ({
  supabase: { storage: { from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `/media/${path}` } }) }) } },
}))

const ENTITIES: Record<string, string> = { '&#x27;': "'", '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' }

async function markupOf(tree: ReactElement): Promise<string> {
  const errors: unknown[] = []
  const { prelude } = await prerender(tree, { onError: (error) => void errors.push(error) })
  if (errors.length > 0) throw errors[0]
  return new Response(prelude).text()
}

/** Plain text: React's text separators dropped, one space between elements. */
const plain = (html: string) =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&quot;|&amp;|&lt;|&gt;|&nbsp;/g, (entity) => ENTITIES[entity])
    .replace(/\s+/g, ' ')

/** A view with loose props: the fixtures carry plain JSON, as the phone gets it. */
const loose = (view: unknown) => view as ComponentType<Record<string, unknown>>

const goldButtons = (html: string) =>
  [...html.matchAll(/<button data-slot="button" data-variant="default"[^>]*>(.*?)<\/button>/g)].map(([, inner]) => plain(inner).trim())

/** The phone home over a Lydspor scene, as Sofie's phone shows it. */
function phoneMarkup(scene: FixtureScene) {
  const lobby = fixtureSnapshot('lobby', 'phone')
  const home = createElement(PhoneHome, { party: lobby.session!, player: { id: FIXTURE_PLAYER_ID, name: 'Sofie' }, fixtureRecap: fixtureRecapDoc() })
  const live = createElement(LiveSessionProvider, {
    sessionId: FIXTURE_SESSION_ID,
    screen: 'phone',
    playerId: FIXTURE_PLAYER_ID,
    fixture: fixtureSnapshot(scene, 'phone'),
    children: home,
  })
  return markupOf(createElement(MemoryRouter, { initialEntries: ['/play/HURRA30'] }, createElement(FixtureMode.Provider, { value: true }, live)))
}

/** Lydspor's own card: from its strap to the next section. */
function lydsporCard(html: string): string {
  const start = html.indexOf('LYDSPOR') >= 0 ? html.indexOf('Lydspor') : 0
  const end = html.indexOf('tonight', start)
  return plain(html.slice(Math.max(0, start), end > start ? end : undefined))
}

const SCENES = ['lobby', 'playing', 'last-call', 'locked', 'reveal', 'standings', 'final'] as const

describe('Lydspor on the phone', () => {
  it('lobby: whose songs, where to look, the four rules and the points', async () => {
    const text = plain(await phoneMarkup('soundtrack-lobby'))
    expect(text).toContain('8 songs')
    expect(text).toMatch(/Eight songs from \S+’s life\./)
    expect(text).toContain('Look at the TV. Song 1 starts soon.')
    expect(text).toContain('A song plays. Type its title and who sings it , then tap its event in the photos.')
    expect(text).toContain('Close spelling counts. Change any song until the last call.')
    expect(text).toContain('Each photo fits one song. Some photos fit none.')
    expect(text).toContain('No points for speed. No music apps, please.')
    expect(text).toContain('Event +2 Title +1 Singer +1')
  })

  it('song 5 playing: Now playing with both fields and the wall, the board counted on its tab', async () => {
    const html = await phoneMarkup('soundtrack-playing')
    const text = plain(html)
    expect(text).toContain('Song 5 of 8')
    expect(text).toContain('Now playing')
    // "Your board", or "Board" under 380 px: both are in the markup, one shown by width.
    expect(text).toContain('Your board Board 11 of 15')
    expect(text).toContain('Name song 5.')
    expect(text).toContain('1 Title')
    expect(text).toContain('2 Who sings it')
    expect(text).toContain('Which photo is song 5 from?')
    // The wall: twelve lettered photos, those on other songs naming the swap before the tap.
    expect(html.match(/aria-label="Photo [A-L]/g)).toHaveLength(12)
    expect(html.match(/swap with song \d/g)?.length).toBe(4)
  })

  it('types with autocorrect and spellcheck off, capitalised words, Next then Done, 60 characters', async () => {
    const html = await phoneMarkup('soundtrack-playing')
    for (const [part, key] of [
      ['title', 'next'],
      ['singer', 'done'],
    ] as const) {
      const input = new RegExp(`<input[^>]*name="lydspor-s5-${part}"[^>]*>`).exec(html)?.[0] ?? ''
      expect(input, part).toContain('type="text"')
      expect(input, part).toContain('inputMode="text"')
      expect(input, part).toContain('autoCapitalize="words"')
      expect(input, part).toContain('autoCorrect="off"')
      expect(input, part).toContain('autoComplete="off"')
      expect(input, part).toContain('spellCheck="false"')
      expect(input, part).toContain('maxLength="60"')
      expect(input, part).toContain(`enterKeyHint="${key}"`)
    }
  })

  it('last call: the seconds, the missing parts as one-tap rows, and the board', async () => {
    const text = plain(await phoneMarkup('soundtrack-last-call'))
    expect(text).toContain('Last call')
    expect(text).toContain('seconds left to change anything. Then your answers lock.')
    expect(text).toContain('Song 3: who sings it?')
    expect(text).toContain('Song 7: which event?')
    expect(text).toContain('Papir Lanterner')
    expect(text).not.toContain('Now playing')
  })

  it('locked: how many were answered and the board as it locked', async () => {
    const html = await phoneMarkup('soundtrack-locked')
    const text = plain(html)
    expect(text).toContain('Your answers are locked.')
    expect(text).toMatch(/\d+ of 24 answered\. Up first: song 1\. \S+ reveals the songs in order and tells each story\./)
    expect(text).toContain('No answer')
    // Read-only: no field, and no cell to tap.
    expect(html).not.toContain('<input')
    expect(html).not.toMatch(/aria-label="Song \d: (title|singer)/)
  })

  it('reveal 1: the story first, then what Sofie typed, the accepted close title, and what she has next', async () => {
    const text = plain(await phoneMarkup('soundtrack-reveal'))
    expect(text).toContain('Reveal 1 of 8')
    expect(text).toMatch(/\S+ tells the story\. Look at the TV\./)
    expect(text).toContain('Song 1: 3 of 4 points.')
    expect(text).toContain('You typed “Papir Lanterner” . Close, the host accepted it.')
    expect(text).toContain('You typed “Coldwave” .')
    expect(text).toMatch(/Song 2 is next\. You have photo [A-L], “Seven ferries” and “Coldwave” \./)
  })

  it('the top 5 after reveal 4: song 4 scores for her like any song, whoever is in its photo', async () => {
    const text = plain(await phoneMarkup('soundtrack-standings'))
    expect(text).toContain('Lydspor’s top 5 is on the TV.')
    expect(text).toContain('Song 4: 4 of 4 points.')
    expect(text).not.toContain('in the photo')
    expect(text).not.toContain('own average')
  })

  it('the end: the result card with the payout on the night board', async () => {
    const text = plain(await phoneMarkup('soundtrack-final'))
    expect(text).toMatch(/You placed \d+(st|nd|rd|th) in Lydspor with \d+ Lydspor points\./)
    expect(text).toMatch(/\+\d+ on the night board/)
  })

  it('has one gold step at most, Show my code, and no exclamation mark or dash in its words', async () => {
    for (const scene of SCENES) {
      const html = await phoneMarkup(`soundtrack-${scene}`)
      expect(goldButtons(html), scene).toEqual(['Show my code S9F4X'])
      const card = lydsporCard(html)
      expect(card, scene).not.toMatch(/[!\u2013\u2014]/)
    }
  })
})

describe('Lydspor for a guest sitting out, or with no answers', () => {
  const snapshot = fixtureSnapshot('soundtrack-playing', 'phone')
  const game = snapshot.games.find((g) => g.game_type === 'soundtrack') as SessionGame
  const player = snapshot.players.find((p) => p.id === FIXTURE_PLAYER_ID)!

  it('sits out in every phase', async () => {
    const props = {
      session: snapshot.session!,
      game,
      players: snapshot.players,
      publicState: game.public_state,
      prompts: [],
      serverNow: () => snapshot.now,
      mediaUrl: (path: string) => `/media/${path}`,
      player,
      view: { sittingOut: true, mine: null, songs: [], points: 0, rank: null, final: null },
      myAnswers: {},
      onStage: true,
      act: async () => {},
      submit: async () => ({ accepted: true as const, answer: { text: 'x' }, at: 0, ms: 0 }),
    }
    const text = plain(await markupOf(createElement(loose(PlayerView), props)))
    expect(text).toContain('You sit this one out.')
    expect(text).toContain('Enjoy the show.')
    expect(text).not.toContain('Name song')
  })

  it('the result card: sat out, nothing answered, or a winner', async () => {
    const base = { session: snapshot.session!, game: { ...game, status: 'finished', winners: [snapshot.players[0].id] } as SessionGame, player, players: snapshot.players, publicState: game.public_state, gamePoints: {} }
    expect(plain(await markupOf(createElement(loose(ResultView), { ...base, view: { sittingOut: true } })))).toContain('You sat this one out.')
    expect(plain(await markupOf(createElement(loose(ResultView), { ...base, view: null })))).toContain(`Lydspor is over. ${snapshot.players[0].name} won.`)
    const won = plain(
      await markupOf(
        createElement(loose(ResultView), {
          ...base,
          game: { ...base.game, winners: [player.id] },
          view: { sittingOut: false, songs: [], points: 30, rank: 1, final: { points: 30, place: 1, paid: 20 } },
        }),
      ),
    )
    expect(won).toContain('You won Lydspor.')
    expect(won).toContain('30 Lydspor points.')
    expect(won).toContain('+20 on the night board')
  })
})
