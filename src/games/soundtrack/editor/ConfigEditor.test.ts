// Lydspor's settings editor rendered to static HTML under Node (no effects
// run): empty, and with the sample settings as cards, the game's problems
// under the song they are about.
import { createElement, type ComponentType } from 'react'
import { prerender } from 'react-dom/static'
import { describe, expect, it } from 'vitest'
import ConfigEditor from '@/games/soundtrack/ConfigEditor'
import { sampleSettings } from '@/games/soundtrack/samples'
import { fixtureSnapshot } from '@/lib/fixtures'

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
})
