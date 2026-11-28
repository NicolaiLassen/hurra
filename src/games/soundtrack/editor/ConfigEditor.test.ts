// Lydspor's settings editor rendered to static HTML under Node (no effects
// run): empty, and with the sample settings as cards, the game's problems
// under the song they are about.
import { createElement, type ComponentType } from 'react'
import { prerender } from 'react-dom/static'
import { describe, expect, it } from 'vitest'
import ConfigEditor from '@/games/soundtrack/ConfigEditor'
import { sampleSettings } from '@/games/soundtrack/samples'
import { FIXTURE_EXPECTED_NAMES, fixtureSnapshot } from '@/lib/fixtures'
import { guestsOf } from '@/lib/guestList'

async function render(view: ComponentType<never>, props: Record<string, unknown>): Promise<string> {
  const errors: unknown[] = []
  const { prelude } = await prerender(createElement(view, props as never), { onError: (error) => void errors.push(error) })
  if (errors.length > 0) throw errors[0]
  return new Response(prelude).text()
}

const gold = (html: string) => (html.match(/data-slot="button" data-variant="default"/g) ?? []).length
const text = (html: string) =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')

describe("Lydspor's settings editor", () => {
  const editorProps = (config: unknown) => {
    const host = fixtureSnapshot('lobby', 'host')
    return {
      config,
      onChange: () => {},
      session: host.session,
      game: host.games[0],
      players: host.players,
      guests: guestsOf(host),
      media: { upload: async () => 'a/b/c.jpg', url: (path: string) => `/media/${path}` },
    }
  }

  it('starts empty with a way to add the first song', async () => {
    const shown = text(await render(ConfigEditor as ComponentType<never>, editorProps({})))
    expect(shown).toContain('Songs (0 of 12)')
    expect(shown).toContain('Add the first song')
  })

  it('shows a card per song with its fields, and the problems under the song they are about', async () => {
    const cast = { players: fixtureSnapshot('lobby', 'host').players }
    const settings = sampleSettings(cast)
    settings.songs[2] = { ...settings.songs[2], photo: '' }
    const html = await render(ConfigEditor as ComponentType<never>, editorProps(settings))
    const shown = text(html)
    expect(shown).toContain('Songs (8 of 12)')
    expect(html.match(/aria-label="Song \d+"/g)).toHaveLength(8)
    expect(html).toContain('value="Paper Lanterns"')
    expect(shown).toContain('Also accept for the title')
    expect(shown).toContain('Song 3 needs its photo')
    expect(shown).toContain('Fix this before you start Lydspor')
    expect(shown).toContain('Extra photos (4 of 4)')
    // The hook start as m:ss.
    expect(html).toContain('value="0:48"')
    // Save settings is the gold step of the settings: the editor itself has none.
    expect(gold(html)).toBe(0)
  })

  it('shows both switches off and no moment fields by default', async () => {
    const settings = sampleSettings({ players: fixtureSnapshot('lobby', 'host').players })
    const html = await render(ConfigEditor as ComponentType<never>, editorProps(settings))
    const shown = text(html)
    expect(shown).toContain('Guests type the moment')
    expect(shown).toContain('AI checks typed answers')
    expect(html.match(/type="checkbox"[^>]*checked/g) ?? []).toHaveLength(0)
    expect(shown).not.toContain('Other moments that count')
    expect(shown).not.toContain('(optional)')
    expect(shown).toContain('Caption at the reveal, with the year')
    expect(shown).not.toContain('Show the extra photos')
    expect(shown).toContain('Mix the upload order')
  })

  it('with typed moments on, asks each song for its moment, makes the caption optional and folds the extra photos away', async () => {
    const settings = { ...sampleSettings({ players: fixtureSnapshot('lobby', 'host').players }, true), aiCheck: true }
    settings.songs[1] = { ...settings.songs[1], moment: '' }
    const html = await render(ConfigEditor as ComponentType<never>, editorProps(settings))
    const shown = text(html)
    expect(html.match(/type="checkbox"[^>]*checked/g) ?? []).toHaveLength(2)
    expect(html.match(/<label[^>]*>Moment<\/label>/g)).toHaveLength(8)
    expect(html).toContain('value="Roskilde Festival 2015, first time camping"')
    expect(html).toContain('value="Roskilde 2015"')
    expect(shown).toContain('Other moments that count')
    expect(shown).toContain('Caption at the reveal, with the year (optional)')
    expect(shown).toContain('Song 2 needs its moment')
    // The extra photos are kept, folded away.
    expect(shown).toContain('Extra photos (4 of 4)')
    expect(shown).toContain('Show the extra photos')
    expect(shown).not.toContain('Mix the upload order')
    expect(gold(html)).toBe(0)
  })

  it("takes typed names for who sits out, shows an id saved before names as its guest's name, and asks nothing about who is in a photo", async () => {
    const host = fixtureSnapshot('lobby', 'host')
    const guests = guestsOf(host)
    const ulrik = guests.find((g) => g.name === FIXTURE_EXPECTED_NAMES[3])!
    const ana = guests.find((g) => g.name === 'Ana')!
    expect([ulrik.joined, ana.joined]).toEqual([false, true])
    const settings = sampleSettings({ players: host.players })
    // Saved before 26 November: who was in song 1's photo (ignored now), and Ulrik by his id.
    settings.songs[0] = { ...settings.songs[0], ...{ inPhoto: [ana.id] } }
    settings.sitOut = [ulrik.id, 'Ana', 'Bodil']
    const shown = text(await render(ConfigEditor as ComponentType<never>, editorProps(settings)))
    // Each chip: the token (which names its guest too), the name and how it stands: Ana joined, Ulrik is listed, Bodil nowhere yet.
    expect(shown).toContain("Doesn't play this game Ulrik Ulrik (not here yet) Ana Ana Bodil Bodil (not on the list) Add someone")
    expect(shown).not.toContain("Who's in this photo")
    expect(shown).not.toContain('own average')
    expect(shown).not.toContain('A guest who left')
    // With nobody on the list and nobody here yet, names can still be typed: each is on no list, and an old id names nobody.
    const empty = text(await render(ConfigEditor as ComponentType<never>, { ...editorProps(settings), guests: [], players: [] }))
    expect(empty).toContain("Doesn't play this game A guest who left Ana Ana (not on the list) Bodil Bodil (not on the list) Add someone")
  })
})
