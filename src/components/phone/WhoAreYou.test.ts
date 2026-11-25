// Who are you? and You're Ana? as static HTML (docs/guest-list.md, 6.2 and
// 6.3): the words, the Danish order, the search from 9 names, the notes, and
// that the list has no gold button (the rows are the action).
import { createElement, type ReactElement } from 'react'
import { prerender } from 'react-dom/static'
import { describe, expect, it } from 'vitest'
import { ConfirmName, JoinNote, WhoAreYou } from '@/components/phone/WhoAreYou'
import { WarningIcon } from '@phosphor-icons/react'

async function markupOf(tree: ReactElement): Promise<string> {
  const { prelude } = await prerender(tree)
  return new Response(prelude).text()
}
const ENTITIES: Record<string, string> = { '&#x27;': "'", '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>' }
const plain = (html: string) =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&quot;|&amp;|&lt;|&gt;/g, (entity) => ENTITIES[entity])
    .replace(/\s+/g, ' ')
    .trim()
const goldButtons = (html: string) => [...html.matchAll(/data-variant="default"/g)].length
/** Each row's name, as it reads (the token beside it is aria-hidden). */
const rows = (html: string) =>
  [...html.matchAll(/<li><button type="button"[^>]*>.*?<span class="min-w-0 truncate[^"]*">(.*?)<\/span><\/button><\/li>/g)].map(([, inner]) =>
    plain(inner),
  )

const list = (names: string[], query = '', notes?: ReactElement) =>
  markupOf(
    createElement(WhoAreYou, {
      party: { name: 'Birthday party' },
      names,
      notes,
      query,
      onQuery: () => {},
      onChoose: () => {},
      onNotOnList: () => {},
      onClaimCode: () => {},
    }),
  )

describe('Who are you?', () => {
  it('lists the free names the Danish way as rows, with the way out for a guest not on the list, and no gold button', async () => {
    const html = await list(['Åse', 'Zelda', 'bo', 'Ana', 'Ørn'])
    const text = plain(html)
    expect(text).toContain("You're joining Birthday party")
    expect(text).toContain('Who are you? Tap your name.')
    expect(rows(html)).toEqual(['Ana', 'bo', 'Zelda', 'Ørn', 'Åse'])
    expect(text).toContain("I'm not on the list")
    expect(text).toContain('Got a code from the host?')
    expect(goldButtons(html)).toBe(0)
    // Under 9 names, no search.
    expect(html).not.toContain('Find your name')
  })

  it('has a search from 9 names that folds names as the Players search does, and says when nobody matches', async () => {
    const names = ['Ana', 'Bo', 'Søren', 'Mads', 'Sofie', 'Freja', 'Lars', 'Ida', 'Emil']
    const html = await list(names, 'soren')
    expect(html).toContain('placeholder="Find your name"')
    expect(html).toContain('aria-label="Find your name"')
    expect(html).toContain('type="search"')
    expect(rows(html)).toEqual(['Søren'])
    const none = plain(await list(names, ' Zel '))
    expect(none).toContain('Nobody called “Zel” on the list.')
  })

  it('shows its notes at the top, above the heading', async () => {
    const text = plain(await list(['Ana', 'Bo'], '', createElement(JoinNote, { icon: WarningIcon, children: 'Someone just took Ana.' })))
    expect(text.indexOf('Someone just took Ana.')).toBeLessThan(text.indexOf('Who are you?'))
  })
})

describe("You're Ana?", () => {
  it('asks with the token big, says what the name is for, and offers the one gold step and a way back', async () => {
    const html = await markupOf(createElement(ConfirmName, { name: 'Ana', onConfirm: async () => null, onBack: () => {} }))
    const text = plain(html)
    expect(text).toContain("You're Ana?")
    expect(text).toContain('Everyone sees you as Ana tonight: on the TV, in the games and in the standings.')
    expect(text).toContain("Yes, I'm Ana")
    expect(text).toContain('No, go back')
    expect(goldButtons(html)).toBe(1)
    expect(html).toContain('size-32')
  })
})
