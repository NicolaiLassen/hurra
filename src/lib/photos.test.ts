// Guest photos on every screen (docs/guest-photos.md, 4.4 and 8.1): the index
// Avatar reads, the provider's size rule and first render, and what a phone
// says when a photo couldn't be saved.
import { createElement, type ReactElement } from 'react'
import { prerender } from 'react-dom/static'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Avatar from '@/components/Avatar'
import { GameCallError } from '@/lib/gameApi'
import { UNREADABLE_PHOTO } from '@/lib/media'
import { NO_PHOTOS, onlyAllowed, photoFor, photoIndex, photoKey } from '@/lib/photoIndex'
import { isDrawablePhoto, MAX_PHOTO_SIDE, photoErrorMessage, PlayerPhotosProvider } from '@/lib/photos'
import type { Player } from '@/lib/types'

// The provider only asks the client's storage for public URLs.
vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: { from: (bucket: string) => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://photos.test/${bucket}/${path}` } }) }) },
  },
}))

const SESSION = '5e551011-0000-4000-8000-000000000001'
const idOf = (n: number) => `0b1ec7ed-0000-4000-8000-00000000000${n}`
const pathOf = (n: number, version = 1) => `${SESSION}/${idOf(n)}/c0ffee00-0000-4000-8000-00000000000${version}.jpg`
const urlOf = (path: string) => `url:${path}`

function player(n: number, name: string, photo: string | null = null): Player {
  return { id: idOf(n), name, code: `CODE${n}`, profile: {}, created_at: n, photo }
}

const ana = player(1, 'Ana', pathOf(1))
const bo = player(2, 'Bo')
const cy = player(3, 'Cy', pathOf(3))

describe('photoKey', () => {
  it('is empty without players, or without photos', () => {
    expect(photoKey(undefined)).toBe('')
    expect(photoKey([])).toBe('')
    expect(photoKey([bo, { ...ana, photo: null }, { ...cy, photo: undefined }])).toBe('')
  })

  it('changes with a photo, and with the name of a player who has one', () => {
    const key = photoKey([ana, bo, cy])
    expect(key).toBe(`${ana.id}\t${ana.photo}\tAna\n${cy.id}\t${cy.photo}\tCy`)
    expect(photoKey([ana, bo, { ...cy, photo: pathOf(3, 2) }])).not.toBe(key)
    expect(photoKey([ana, bo, { ...cy, photo: null }])).not.toBe(key)
    expect(photoKey([ana, { ...bo, photo: pathOf(2) }, cy])).not.toBe(key)
    expect(photoKey([{ ...ana, name: 'Ana B' }, bo, cy])).not.toBe(key)
  })

  it('stays the same for everything else: points, badges, a rename or a newcomer without a photo', () => {
    const key = photoKey([ana, bo, cy])
    expect(photoKey([{ ...ana, profile: { quiz: { wins: 1 } }, code: 'OTHER' }, bo, cy])).toBe(key)
    expect(photoKey([ana, { ...bo, name: 'Bo B' }, cy])).toBe(key)
    expect(photoKey([ana, bo, cy, player(4, 'Dan')])).toBe(key)
  })
})

describe('photoIndex and photoFor', () => {
  const index = photoIndex(photoKey([ana, bo, cy]), urlOf)

  it('makes each photo URL once per player, by id and by name', () => {
    expect(index.byId).toEqual(new Map([[ana.id, urlOf(pathOf(1))], [cy.id, urlOf(pathOf(3))]]))
    expect(index.byName).toEqual(new Map([['Ana', urlOf(pathOf(1))], ['Cy', urlOf(pathOf(3))]]))
    expect(photoIndex('', urlOf)).toBe(NO_PHOTOS)
  })

  it('finds a player by id first: an id without a photo gives none, not the name\'s', () => {
    expect(photoFor(index, ana.id)).toBe(urlOf(pathOf(1)))
    expect(photoFor(index, ana.id, 'Someone else')).toBe(urlOf(pathOf(1)))
    expect(photoFor(index, bo.id, 'Ana')).toBeNull()
    expect(photoFor(index, idOf(9), 'Ana')).toBeNull()
  })

  it('else by the exact name, and nothing for a name that matches nobody', () => {
    expect(photoFor(index, undefined, 'Cy')).toBe(urlOf(pathOf(3)))
    expect(photoFor(index, undefined, 'cy')).toBeNull()
    expect(photoFor(index, undefined, 'Cy ')).toBeNull()
    expect(photoFor(index, undefined, 'Bo')).toBeNull()
    expect(photoFor(index, undefined, 'Ida')).toBeNull()
    expect(photoFor(index)).toBeNull()
    expect(photoFor(NO_PHOTOS, ana.id, 'Ana')).toBeNull()
  })

  it('finds a guest named "A guest" or "Someone" by id, never by that name', () => {
    const guest = player(5, 'A guest', pathOf(5))
    const someone = player(6, 'Someone', pathOf(6))
    const withPlaceholders = photoIndex(photoKey([guest, someone]), urlOf)
    expect(photoFor(withPlaceholders, guest.id)).toBe(urlOf(pathOf(5)))
    expect(photoFor(withPlaceholders, someone.id)).toBe(urlOf(pathOf(6)))
    expect(photoFor(withPlaceholders, undefined, 'A guest')).toBeNull()
    expect(photoFor(withPlaceholders, undefined, 'Someone')).toBeNull()
  })

  it('leaves a name two players share out of the name map', () => {
    const twins = photoIndex(photoKey([ana, { ...cy, name: 'Ana' }]), urlOf)
    expect(photoFor(twins, undefined, 'Ana')).toBeNull()
    expect(photoFor(twins, cy.id)).toBe(urlOf(pathOf(3)))
  })

  it('onlyAllowed keeps only the measured photos, by id and by name', () => {
    const measured = onlyAllowed(index, new Set([urlOf(pathOf(3))]))
    expect(photoFor(measured, ana.id)).toBeNull()
    expect(photoFor(measured, undefined, 'Ana')).toBeNull()
    expect(photoFor(measured, cy.id)).toBe(urlOf(pathOf(3)))
    expect(photoFor(measured, undefined, 'Cy')).toBe(urlOf(pathOf(3)))
    expect(onlyAllowed(index, new Set())).toEqual(NO_PHOTOS)
  })
})

describe('the size rule of the measuring', () => {
  it('draws a photo whose sides are both between 1 and 640 px', () => {
    expect(MAX_PHOTO_SIDE).toBe(640)
    expect(isDrawablePhoto(1, 1)).toBe(true)
    expect(isDrawablePhoto(320, 320)).toBe(true)
    expect(isDrawablePhoto(640, 640)).toBe(true)
    expect(isDrawablePhoto(640, 1)).toBe(true)
  })

  it('never draws an empty picture, or one too big for the app to have made', () => {
    expect(isDrawablePhoto(0, 320)).toBe(false)
    expect(isDrawablePhoto(320, 0)).toBe(false)
    expect(isDrawablePhoto(641, 320)).toBe(false)
    expect(isDrawablePhoto(320, 641)).toBe(false)
    expect(isDrawablePhoto(20_000, 20_000)).toBe(false)
  })
})

describe('photoErrorMessage', () => {
  const connection = "Couldn't save your photo. Check your connection and try again."
  const generic = "Couldn't save your photo. Try again."

  it('a photo this browser could not read', () => {
    expect(photoErrorMessage(new Error(UNREADABLE_PHOTO))).toBe("This photo can't be read here. Try another one, or take a selfie.")
  })

  it('no answer, or an answer too late: the connection', () => {
    expect(photoErrorMessage(new GameCallError("Couldn't reach the party. Check your connection and try again.", 0, 'unavailable'))).toBe(connection)
  })

  it('a file over the bucket limit, the throttle a second time, an archived party', () => {
    expect(photoErrorMessage(new GameCallError('The object exceeded the maximum allowed size', 413, '413'))).toBe('That photo is too big. Try another one.')
    expect(photoErrorMessage(new GameCallError('Wait a moment before changing your photo again', 429, 'too_soon'))).toBe('Wait a moment, then try again.')
    expect(photoErrorMessage(new GameCallError('This party is over', 409, 'archived'))).toBe('This party is over')
  })

  it('anything else: try again', () => {
    for (const [status, code] of [
      [403, '403'],
      [415, '415'],
      [403, 'not_your_player'],
      [400, 'bad_path'],
      [409, 'not_uploaded'],
      [415, 'bad_file'],
    ] as const) {
      expect(photoErrorMessage(new GameCallError('refused', status, code))).toBe(generic)
    }
    expect(photoErrorMessage(new Error('Something else'))).toBe(generic)
    expect(photoErrorMessage('a string')).toBe(generic)
  })
})

describe('PlayerPhotosProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function html(tree: ReactElement): Promise<string> {
    const errors: unknown[] = []
    const { prelude } = await prerender(tree, { onError: (error) => void errors.push(error) })
    if (errors.length > 0) throw errors[0]
    return new Response(prelude).text()
  }
  const faces = (players: Player[]) =>
    html(
      createElement(PlayerPhotosProvider, {
        players,
        children: players.map((p) => createElement(Avatar, { key: p.id, name: p.name, playerId: p.id })),
      }),
    )

  it('gives Avatar no photo before it has measured it: the first render shows initials', async () => {
    const markup = await faces([ana, bo, cy])
    expect(markup).not.toContain('<img')
    expect(markup).toContain('>A<')
  })

  it('draws no made-up faces under Node, nor in a browser without ?photos', async () => {
    expect(await faces([ana, bo])).not.toContain('<img')
    vi.stubGlobal('window', { location: { search: '?fixture=lobby' } })
    expect(await faces([ana, bo])).not.toContain('<img')
  })

  it('draws a face for every player with ?photos in a dev build, for the fixture scenes', async () => {
    vi.stubGlobal('window', { location: { search: '?fixture=lobby&photos' } })
    const markup = await faces([ana, bo, player(5, 'A guest')])
    expect(markup.match(/<img [^>]*src="data:image\/svg\+xml,/g)).toHaveLength(3)
  })
})
