// The phone header's photo button (docs/guest-photos.md, 6.2 and 8.1): a
// guest's only way to change or remove their photo after joining. Its line
// sits in PhoneHome.tsx, which the night build reworks, so a merge that drops
// it fails here. Rendered to static HTML under Node, as PhoneHome.test.ts does.
import { createElement } from 'react'
import { prerender } from 'react-dom/static'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { FixtureMode } from '@/components/phone/calls'
import PhoneHome from '@/components/phone/PhoneHome'
import { FIXTURE_PLAYER_ID, FIXTURE_SESSION_ID, fixtureSnapshot, type FixtureScene } from '@/lib/fixtures'
import type { Snapshot } from '@/lib/types'
import { LiveSessionProvider } from '@/lib/useLive'

// No network: the provider renders the fixture, and a photo needs only its public URL.
vi.mock('@/lib/supabase', () => ({
  supabase: { storage: { from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://photos.test/${path}` } }) }) } },
}))

const PHOTO = `${FIXTURE_SESSION_ID}/${FIXTURE_PLAYER_ID}/c0ffee00-0000-4000-8000-000000000001.jpg`

/** The phone home over a fixture scene as Sofie's phone shows it, with her photo or without one. */
async function phone(scene: FixtureScene, photo: string | null): Promise<string> {
  const base = fixtureSnapshot(scene, 'phone')
  const snapshot: Snapshot = { ...base, players: base.players.map((p) => (p.id === FIXTURE_PLAYER_ID ? { ...p, photo } : p)) }
  const home = createElement(PhoneHome, { party: fixtureSnapshot('lobby', 'phone').session!, player: { id: FIXTURE_PLAYER_ID, name: 'Sofie' } })
  const live = createElement(LiveSessionProvider, {
    sessionId: FIXTURE_SESSION_ID,
    screen: 'phone',
    playerId: FIXTURE_PLAYER_ID,
    fixture: snapshot,
    children: home,
  })
  const errors: unknown[] = []
  const tree = createElement(MemoryRouter, { initialEntries: ['/play/HURRA30'] }, createElement(FixtureMode.Provider, { value: true }, live))
  const { prelude } = await prerender(tree, { onError: (error) => void errors.push(error) })
  if (errors.length > 0) throw errors[0]
  return new Response(prelude).text()
}

const hasButton = (html: string, label: string) => new RegExp(`<button\\b[^>]*\\baria-label="${label}"`).test(html)

describe('the photo button in the phone header', () => {
  it.each(['lobby', 'quiz-question', 'final'] as const)('%s: "Add a photo" without a photo, "Change your photo" with one', async (scene) => {
    const without = await phone(scene, null)
    expect(hasButton(without, 'Add a photo')).toBe(true)
    expect(hasButton(without, 'Change your photo')).toBe(false)
    const with_ = await phone(scene, PHOTO)
    expect(hasButton(with_, 'Change your photo')).toBe(true)
    expect(hasButton(with_, 'Add a photo')).toBe(false)
  })

  it('once the party is over: no button without a photo, and one to remove it with a photo', async () => {
    const without = await phone('archived', null)
    expect(hasButton(without, 'Add a photo')).toBe(false)
    expect(hasButton(without, 'Change your photo')).toBe(false)
    expect(without).toContain('That&#x27;s a wrap!')
    expect(hasButton(await phone('archived', PHOTO), 'Change your photo')).toBe(true)
  })
})
