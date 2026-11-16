// Avatar with guest photos (docs/guest-photos.md, 5 and 8.1), rendered to
// static HTML under Node. This file mocks no Supabase client on purpose:
// every game's views draw Avatar and their tests run with no Supabase
// settings, so if Avatar's imports ever reached the client again, importing
// it here would throw.
import { createElement, type ReactElement } from 'react'
import { prerender } from 'react-dom/static'
import { describe, expect, it } from 'vitest'
import Avatar from '@/components/Avatar'
import { photoIndex, photoKey, PhotosContext } from '@/lib/photoIndex'

const ANA = 'a0000000-0000-4000-8000-000000000001'
const BO = 'a0000000-0000-4000-8000-000000000002'
const ANA_PHOTO = 'https://photos.test/ana.jpg'
const INDEX = photoIndex(
  photoKey([
    { id: ANA, name: 'Ana', photo: 'ana.jpg' },
    { id: BO, name: 'Bo', photo: null },
  ]),
  (path) => `https://photos.test/${path}`,
)

async function html(tree: ReactElement): Promise<string> {
  const errors: unknown[] = []
  const { prelude } = await prerender(tree, { onError: (error) => void errors.push(error) })
  if (errors.length > 0) throw errors[0]
  return new Response(prelude).text()
}

/** An Avatar inside the party's photos, as every live screen draws one. */
const inParty = (props: Parameters<typeof Avatar>[0]) => html(createElement(PhotosContext.Provider, { value: INDEX }, createElement(Avatar, props)))
const img = (markup: string) => markup.match(/<img [^>]*>/)?.[0] ?? null

describe('Avatar', () => {
  it("shows a player's photo by name, over their initials", async () => {
    const markup = await inParty({ name: 'Ana', className: 'size-12' })
    const photo = img(markup)
    expect(photo).toContain(`src="${ANA_PHOTO}"`)
    expect(photo).toContain('rounded-full')
    expect(photo).toContain('pointer-events-none')
    // React writes the attribute as fetchPriority; HTML attribute names are case-insensitive.
    expect(photo).toMatch(/ fetchpriority="low"/i)
    expect(photo).toContain('alt=""')
    // The initials stay in the HTML, under the photo, until it has loaded.
    expect(markup.indexOf('>A<')).toBeGreaterThan(-1)
    expect(markup.indexOf('>A<')).toBeLessThan(markup.indexOf('<img'))
    expect(markup).toMatch(/^<span aria-hidden="true" class="[^"]*\brelative\b[^"]*\boverflow-hidden\b[^"]*\bsize-12\b/)
  })

  it('shows it by playerId whatever name the call site passes', async () => {
    expect(img(await inParty({ name: 'Ana Banana', playerId: ANA }))).toContain(`src="${ANA_PHOTO}"`)
    // By id even when that player has no photo: never the name's.
    expect(img(await inParty({ name: 'Ana', playerId: BO }))).toBeNull()
  })

  it('shows initials and no image for a player without a photo, an unknown name, a placeholder or no provider', async () => {
    for (const name of ['Bo', 'Ida', 'A guest', 'Someone']) {
      const markup = await inParty({ name })
      expect(img(markup)).toBeNull()
      expect(markup).toContain(`>${name === 'A guest' ? 'AG' : name[0].toUpperCase()}<`)
    }
    const alone = await html(createElement(Avatar, { name: 'Ana' }))
    expect(img(alone)).toBeNull()
    expect(alone).toContain('>A<')
  })

  it('takes src over both: the phone\'s own preview, or null for none', async () => {
    expect(img(await inParty({ name: 'Bo', src: 'blob:preview' }))).toContain('src="blob:preview"')
    expect(img(await inParty({ name: 'Ana', playerId: ANA, src: 'blob:preview' }))).toContain('src="blob:preview"')
    const none = await inParty({ name: 'Ana', playerId: ANA, src: null })
    expect(img(none)).toBeNull()
    expect(none).toContain('>A<')
  })
})
