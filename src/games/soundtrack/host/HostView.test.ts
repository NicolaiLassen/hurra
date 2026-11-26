// Lydspor's host card on the sample rounds, rendered to static HTML under
// Node (no effects run): one gold step at a time, no title on the host phone
// before the lock, the close answers at a reveal, and the top 5.
import { createElement, type ComponentType } from 'react'
import { prerender } from 'react-dom/static'
import { describe, expect, it } from 'vitest'
import HostView from '@/games/soundtrack/HostView'
import { SAMPLE_SONGS } from '@/games/soundtrack/samples'
import { FIXTURE_NOW, fixtureSnapshot } from '@/lib/fixtures'

async function render(view: ComponentType<never>, props: Record<string, unknown>): Promise<string> {
  const errors: unknown[] = []
  const { prelude } = await prerender(createElement(view, props as never), { onError: (error) => void errors.push(error) })
  if (errors.length > 0) throw errors[0]
  return new Response(prelude).text()
}

async function hostCard(scene: string) {
  const host = fixtureSnapshot(`soundtrack-${scene}` as Parameters<typeof fixtureSnapshot>[0], 'host')
  const game = host.games.find((g) => g.game_type === 'soundtrack')!
  const held = host.states![game.id]
  return render(HostView as ComponentType<never>, {
    session: host.session,
    game,
    players: host.players,
    publicState: game.public_state,
    prompts: host.prompts.filter((p) => p.game_id === game.id),
    serverNow: () => FIXTURE_NOW,
    mediaUrl: (path: string) => `/media/${path}`,
    state: held.state,
    config: held.config,
    tallies: host.tallies[game.id] ?? {},
    gamePoints: host.game_points[game.id] ?? {},
    act: async () => {},
  })
}

const gold = (html: string) => (html.match(/data-slot="button" data-variant="default"/g) ?? []).length
const text = (html: string) =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')

describe("Lydspor's host card", () => {
  it.each([
    ['lobby', 'Play song 1'],
    ['playing', 'Play song 6'],
    ['locked', 'Reveal song 1'],
    ['reveal', 'Reveal song 2'],
    ['standings', 'Reveal song 5'],
  ])('has one gold step in the %s scene: %s', async (scene, step) => {
    const html = await hostCard(scene)
    expect(gold(html)).toBe(1)
    expect(text(html)).toContain(step)
  })

  it('has no gold step while the last call counts down, and offers more time', async () => {
    const html = await hostCard('last-call')
    expect(gold(html)).toBe(0)
    expect(text(html)).toContain('More time (+30 s) 2 left')
  })

  it.each(['lobby', 'playing', 'last-call'])('names no title or singer in the %s scene: the host phone is out in the room', async (scene) => {
    const shown = text(await hostCard(scene))
    for (const song of SAMPLE_SONGS) {
      expect(shown).not.toContain(song.title)
      expect(shown).not.toContain(song.singer)
    }
  })

  it('counts the song playing on the cue card', async () => {
    expect(text(await hostCard('playing'))).toMatch(/\d+ of \d+ typed a title, \d+ a singer, \d+ a photo\./)
  })

  it('lists the close answers at a reveal, the accepted one with Undo, the rest with Accept', async () => {
    const shown = text(await hostCard('reveal'))
    expect(shown).toContain('Close answers, song 1')
    expect(shown).toContain('“Papir Lanterner” 2 guests 3 letters off Accepted Undo')
    expect(shown).toContain('“Myra Holmes” 1 guest 3 letters off Accept')
    expect(shown).toMatch(/Other answers \(\d+\)/)
    expect(shown).toMatch(/Counted already \(\d+ spellings?\)/)
  })

  it('shows the top 5 the TV shows, above the last close answers', async () => {
    const shown = text(await hostCard('standings'))
    expect(shown.indexOf('Lydspor’s top 5 on the TV')).toBeGreaterThan(-1)
    expect(shown.indexOf('Lydspor’s top 5 on the TV')).toBeLessThan(shown.indexOf('Close answers, song 4'))
  })
})
