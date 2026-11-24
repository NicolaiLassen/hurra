// The phone's standings card: the top three, then the guest with their
// neighbours; and a guest a live game knocked out wears the pink stripe with
// the word Out beside a name at full strength.
import { createElement } from 'react'
import { prerender } from 'react-dom/static'
import { describe, expect, it } from 'vitest'
import Standings from '@/components/Standings'
import type { ScoreRow } from '@/lib/types'

const names = ['Ana', 'Bo', 'Clara', 'Dee', 'Emil', 'Frida', 'Gus', 'Hans', 'Ida', 'Jon']
const rows: ScoreRow[] = names.map((name, i) => ({ player_id: name.toLowerCase(), name, code: name, points: 20 - i * 2, profile: {} }))

async function html(props: Parameters<typeof Standings>[0]): Promise<string> {
  const { prelude } = await prerender(createElement(Standings, props))
  return (await new Response(prelude).text()).replaceAll('<!-- -->', '')
}

/** One guest's row, from its <li> to the next. */
function rowOf(markup: string, name: string): string {
  const start = markup.lastIndexOf('<li', markup.indexOf(`>${name}<`, markup.indexOf('<ol')))
  const end = markup.indexOf('</li>', start)
  return markup.slice(start, end)
}

describe('the standings card', () => {
  it('shows the top three, then you and your neighbours', async () => {
    const markup = await html({ rows, playerId: 'gus' })
    const shown = names.filter((name) => markup.includes(`>${name}<`) || markup.includes(`>${name} <`))
    expect(shown).toEqual(['Ana', 'Bo', 'Clara', 'Frida', 'Gus', 'Hans'])
    expect(markup).toContain('7th')
  })

  it('marks a knocked-out guest Out: the stripe on the token, the word in pink, the name at full strength', async () => {
    const markup = await html({ rows, playerId: 'gus', out: new Set(['bo', 'hans']) })
    for (const name of ['Bo', 'Hans']) {
      const row = rowOf(markup, name)
      expect(row, name).toContain('data-stripe=""')
      expect(row, name).toMatch(new RegExp(`>${name}</span><span class="[^"]*\\btext-pink\\b[^"]*">Out</span>`))
    }
    for (const name of ['Ana', 'Gus']) {
      expect(rowOf(markup, name), name).not.toContain('data-stripe')
      expect(rowOf(markup, name), name).not.toContain('>Out<')
    }
    expect(markup).not.toMatch(/line-through|grayscale/)
  })
})
