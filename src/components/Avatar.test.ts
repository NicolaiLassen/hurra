// The player token (docs/identity.md) with guest photos (docs/guest-photos.md,
// 5 and 8.1), rendered to static HTML under Node. This file mocks no Supabase
// client on purpose: every game's views draw Avatar and their tests run with
// no Supabase settings, so if Avatar's imports ever reached the client again,
// importing it here would throw.
import { createElement, type ReactElement } from 'react'
import { prerender } from 'react-dom/static'
import { describe, expect, it } from 'vitest'
import Avatar from '@/components/Avatar'
import { GUEST_BG, guestLook, slateSize } from '@/lib/guest'
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
/** The token's own element, its first tag. */
const token = (markup: string) => markup.match(/^<span [^>]*>/)?.[0] ?? ''
const piece = (markup: string) => markup.match(/<svg [^>]*data-piece="(\w+)"[^>]*>/)
const band = (markup: string) => markup.match(/<span [^>]*data-band=""[^>]*>/)?.[0] ?? null
const stripe = (markup: string) => markup.match(/<span [^>]*data-stripe=""[^>]*>/)?.[0] ?? null
/** The slate: its own tag, then its lines (one span each) in group 1. */
const slate = (markup: string) => markup.match(/<span [^>]*data-slate=""[^>]*>((?:<span[^>]*>[^<]*<\/span>)*)<\/span>/)
/** The lines a slate shows, in order. */
const slateText = (markup: string) => Array.from(slate(markup)?.[1].matchAll(/>([^<]+)</g) ?? [], (match) => match[1])

describe('Avatar', () => {
  it('is a square token with the 14 percent radius, at the size the call site gives it', async () => {
    const markup = await inParty({ name: 'Bo', className: 'size-12 text-lg ring-2 ring-card' })
    const own = token(markup)
    expect(own).toMatch(/aria-hidden="true"/)
    for (const name of ['@container', 'relative', 'overflow-hidden', 'rounded-token', 'size-12', 'ring-2', 'ring-card']) {
      expect(own, name).toMatch(new RegExp(`class="[^"]*(?<=["\\s])${name.replace(/[@-]/g, '\\$&')}(?=[\\s"])`))
    }
    expect(own).not.toContain('rounded-full')
    expect(own).not.toContain('size-10')
  })

  it("shows a player's photo by name, over their colour and piece, with a band in their colour", async () => {
    const markup = await inParty({ name: 'Ana', className: 'size-12' })
    const photo = img(markup)
    expect(photo).toContain(`src="${ANA_PHOTO}"`)
    expect(photo).toContain('object-cover')
    expect(photo).toContain('rounded-[inherit]')
    expect(photo).toContain('pointer-events-none')
    // React writes the attribute as fetchPriority; HTML attribute names are case-insensitive.
    expect(photo).toMatch(/ fetchpriority="low"/i)
    expect(photo).toContain('alt=""')
    // The colour and piece stay in the HTML, under the photo, until it has loaded.
    const { color, piece: kind } = guestLook('Ana')
    expect(token(markup)).toContain(GUEST_BG[color])
    expect(piece(markup)?.[1]).toBe(kind)
    expect(markup.indexOf('data-piece')).toBeLessThan(markup.indexOf('<img'))
    // The band runs along the bottom in the guest's colour, over the photo.
    expect(band(markup)).toMatch(/absolute inset-x-0 bottom-0 h-\[max\(3px,7\.5cqi\)\]/)
    expect(band(markup)).toContain(GUEST_BG[color])
    expect(markup.indexOf('data-band')).toBeGreaterThan(markup.indexOf('<img'))
  })

  it('shows it by playerId whatever name the call site passes', async () => {
    expect(img(await inParty({ name: 'Ana Banana', playerId: ANA }))).toContain(`src="${ANA_PHOTO}"`)
    // By id even when that player has no photo: never the name's.
    expect(img(await inParty({ name: 'Ana', playerId: BO }))).toBeNull()
  })

  it('shows the colour and piece, and no image or band, for a player without a photo, an unknown name or no provider', async () => {
    for (const name of ['Bo', 'Ida', 'Christoffer Bjørnskov']) {
      const markup = await inParty({ name })
      const { color, piece: kind } = guestLook(name)
      expect(img(markup)).toBeNull()
      expect(band(markup)).toBeNull()
      expect(token(markup)).toContain(GUEST_BG[color])
      expect(token(markup)).toContain('text-ink')
      // The piece below 96 px, gone from 96 px up, where the name takes over.
      expect(piece(markup)?.[1]).toBe(kind)
      expect(piece(markup)?.[0]).toContain('size-[62cqi]')
      expect(piece(markup)?.[0]).toContain('@min-[96px]:hidden')
    }
    const alone = await html(createElement(Avatar, { name: 'Ana' }))
    expect(img(alone)).toBeNull()
    expect(piece(alone)?.[1]).toBe(guestLook('Ana').piece)
  })

  it('shows the whole first name from 96 px, fitted in container units, never initials', async () => {
    const christoffer = await inParty({ name: 'Christoffer Bjørnskov' })
    expect(slateText(christoffer)).toEqual(['Christoffer'])
    expect(christoffer).not.toMatch(/>CB</)
    const own = slate(christoffer)?.[0] ?? ''
    expect(own).toMatch(/class="hidden [^"]*@min-\[96px\]:block/)
    expect(own).toContain('font-display')
    expect(own).toContain('font-stretch-62%')
    expect(own).toContain(`font-size:${(slateSize(['Christoffer']) * 100).toFixed(2)}cqi`)

    // A hyphenated name breaks after the hyphen.
    const marieLouise = await inParty({ name: 'Marie-Louise Christensen' })
    expect(slateText(marieLouise)).toEqual(['Marie-', 'Louise'])
    expect(slate(marieLouise)?.[0]).toContain(`font-size:${(slateSize(['Marie-', 'Louise']) * 100).toFixed(2)}cqi`)
  })

  it("shows only a piece for someone who isn't a player, at any size", async () => {
    for (const name of ['A guest', 'Someone']) {
      const markup = await inParty({ name })
      expect(slate(markup)).toBeNull()
      expect(piece(markup)?.[0]).not.toContain('@min-[96px]:hidden')
    }
  })

  it("takes src over both: the phone's own preview, or null for none", async () => {
    expect(img(await inParty({ name: 'Bo', src: 'blob:preview' }))).toContain('src="blob:preview"')
    expect(img(await inParty({ name: 'Ana', playerId: ANA, src: 'blob:preview' }))).toContain('src="blob:preview"')
    const none = await inParty({ name: 'Ana', playerId: ANA, src: null })
    expect(img(none)).toBeNull()
    expect(piece(none)?.[1]).toBe(guestLook('Ana').piece)
  })

  it('lays one pink stripe across a guest who is out, over a dimmed piece or photo, the name at full strength', async () => {
    const plain = await inParty({ name: 'Bo', out: true })
    expect(token(plain)).toContain('data-out=""')
    expect(stripe(plain)).toContain('bg-pink')
    expect(stripe(plain)).toContain('-rotate-45')
    expect(stripe(plain)).toContain('h-[max(4px,10cqi)]')
    expect(plain.split('data-stripe').length - 1).toBe(1)
    expect(piece(plain)?.[0]).toContain('opacity-50')
    expect(slate(plain)?.[0]).not.toContain('opacity')
    // Last, so it lies over everything else.
    expect(plain.indexOf('data-stripe')).toBeGreaterThan(plain.indexOf('data-slate'))

    const photo = await inParty({ name: 'Ana', out: true })
    expect(img(photo)).toContain('brightness-50')
    expect(band(photo)).not.toContain('brightness')
    expect(photo.indexOf('data-stripe')).toBeGreaterThan(photo.indexOf('data-band'))

    const still = await inParty({ name: 'Ana' })
    expect(token(still)).not.toContain('data-out')
    expect(stripe(still)).toBeNull()
    expect(img(still)).not.toContain('brightness')
    expect(piece(still)?.[0]).not.toContain('opacity-50')
  })
})
