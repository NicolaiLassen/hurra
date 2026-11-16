// Knocked-out guests in Last one standing (docs/identity.md, The player token):
// their token wears the pink stripe, and the word Out sits in pink by a name
// that stays at full strength, never struck through or greyed out. On the TV
// the word is at the floor, 28 px. Rendered to static HTML under Node; the
// TV's tiles size themselves from their box, so the measure is stubbed: a
// roomy stage, or a narrow one for the one-line tiles.
import { createElement, type ComponentType } from 'react'
import { prerender } from 'react-dom/static'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EliminationPublicState } from '@/games/elimination/logic'
import TvView from '@/games/elimination/TvView'
import WhoIsLeft from '@/games/elimination/WhoIsLeft'
import type { Player } from '@/lib/types'

const ROOMY = { width: 1200, height: 700 }
const board = vi.hoisted(() => ({ width: 1200, height: 700 }))
vi.mock('@/lib/useElementSize', () => ({ useElementSize: () => [() => {}, board] }))
afterEach(() => void Object.assign(board, ROOMY))
vi.stubGlobal('document', { documentElement: {} })
vi.stubGlobal('getComputedStyle', () => ({ fontSize: '16px' }))

const players: Player[] = ['Ana', 'Bo', 'Clara', 'Dee'].map((name) => ({ id: name.toLowerCase(), name, code: name.toUpperCase(), profile: {}, created_at: 0 }))
const publicState: EliminationPublicState = {
  alive: ['ana', 'bo'],
  out: ['clara', 'dee'],
  winner: null,
  outBy: { clara: { by: 'ana', method: 'tag' }, dee: { by: 'bo', method: 'catch' } },
  knockoutCounts: { ana: 1, bo: 1 },
  feed: [
    { by: 'bo', target: 'dee', method: 'catch', task: null, at: 2 },
    { by: 'ana', target: 'clara', method: 'tag', task: 'Get someone to hum a tune', at: 1 },
  ],
}

async function html(view: ComponentType<never>, props: object): Promise<string> {
  const errors: unknown[] = []
  const { prelude } = await prerender(createElement(view, props as never), { onError: (error) => void errors.push(error) })
  if (errors.length > 0) throw errors[0]
  // React marks the seams between adjacent text parts with empty comments.
  return (await new Response(prelude).text()).replaceAll('<!-- -->', '')
}

/** Each guest's stretch of the markup, from their token (the tag with Avatar's own classes) up to the next guest's token. */
function byGuest(markup: string, labels: readonly string[]): Record<string, string> {
  const starts = labels.map((label) => markup.lastIndexOf('<span', markup.lastIndexOf('class="@container', markup.indexOf(`>${label}<`))))
  return Object.fromEntries(labels.map((label, i) => [label, markup.slice(starts[i], starts[i + 1] ?? markup.length)]))
}

/** Out right after the name, on its line: the phone, and the TV's one-line tiles. */
const besideName = (label: string) => new RegExp(`>${label}</span><span class="[^"]*\\btext-pink\\b[^"]*">Out</span>`)
/** Out leading the line under the name: the TV's bigger tiles, where the name keeps its whole line. */
const underName = (label: string) => new RegExp(`>${label}</span></p><p [^>]*><span class="[^"]*\\btext-pink\\b[^"]*">Out</span>`)
/** The word at the TV's floor. */
const AT_THE_FLOOR = /<span class="[^"]*\btext-tv-floor\b[^"]*">Out<\/span>/

/** The guests still in carry nothing; the ones out wear the stripe, and the word Out where `word` says. */
function expectMarked(markup: string, still: readonly string[], out: readonly string[], word = besideName) {
  const guests = byGuest(markup, [...still, ...out])
  for (const label of out) {
    expect(guests[label], label).toContain('data-out=""')
    expect(guests[label], label).toContain('data-stripe=""')
    expect(guests[label], label).toMatch(word(label))
  }
  for (const label of still) {
    expect(guests[label], label).not.toContain('data-out')
    expect(guests[label], label).not.toContain('>Out<')
  }
  // Never struck through or greyed out: the only thing at half strength is an out guest's piece.
  expect(markup).not.toMatch(/line-through|grayscale/)
  const dimmed = markup.match(/class="[^"]*\bopacity-50\b[^"]*"/g) ?? []
  const pieces = markup.match(/data-piece="\w+" class="[^"]*\bopacity-50\b[^"]*"/g) ?? []
  expect(dimmed).toHaveLength(out.length)
  expect(pieces).toHaveLength(out.length)
}

describe('a knocked-out guest in Last one standing', () => {
  it('wears the stripe and the word Out on the phone, the name at full strength', async () => {
    const markup = await html(WhoIsLeft as ComponentType<never>, { players, publicState, meId: 'ana' })
    expectMarked(markup, ['You', 'Bo'], ['Clara', 'Dee'])
  })

  it('wears the stripe and the word Out on the TV, the name at full strength', async () => {
    const markup = await html(TvView as ComponentType<never>, { players, publicState, finished: false })
    // The tiles: still in first, then out, latest first. The top hunters come after them.
    const tiles = markup.slice(markup.indexOf('<ul class="grid content-start"'), markup.indexOf('Top hunters'))
    expect(tiles.length).toBeGreaterThan(0)
    expectMarked(tiles, ['Ana', 'Bo'], ['Dee', 'Clara'], underName)
    expect(tiles.match(new RegExp(AT_THE_FLOOR, 'g'))).toHaveLength(2)
  })

  it("sits beside the name on the TV's one-line tiles, at the floor", async () => {
    // Too narrow for the bigger tiles: the one-line ones, two columns of two.
    Object.assign(board, { width: 400, height: 100 })
    const markup = await html(TvView as ComponentType<never>, { players, publicState, finished: false })
    const tiles = markup.slice(markup.indexOf('<ul class="grid content-start"'), markup.indexOf('Top hunters'))
    expect(tiles).toContain('h-10 ')
    expectMarked(tiles, ['Ana', 'Bo'], ['Dee', 'Clara'])
    expect(tiles.match(new RegExp(AT_THE_FLOOR, 'g'))).toHaveLength(2)
  })
})
