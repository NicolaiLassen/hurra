// The control room's TV sound effects volume (docs/engine-v2.md, 7.3), rendered
// to static HTML under Node like the control room's own tests: no effects run,
// so this checks what the control shows for the party's setting.
import { createElement, type ReactNode } from 'react'
import { prerender } from 'react-dom/static'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { soundVolumeLabel, soundVolumeToast } from '@/components/host/scene'
import TvSoundControl from '@/components/host/TvSoundControl'
import { fixtureSnapshot, type FixtureScene } from '@/lib/fixtures'
import type { Snapshot } from '@/lib/types'
import { LiveSessionProvider } from '@/lib/useLive'
import { ControlRoomGate } from '@/pages/host/HostSession'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
// The join card and the dialogs build links from the page's address.
vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' } })

function party(scene: FixtureScene, volume: unknown): Snapshot {
  const s = fixtureSnapshot(scene, 'host')
  return { ...s, session: { ...s.session!, sound_volume: volume as number } }
}

async function markup(snapshot: Snapshot, node: ReactNode): Promise<string> {
  const errors: unknown[] = []
  const tree = createElement(LiveSessionProvider, { sessionId: snapshot.session!.id, screen: 'host', fixture: snapshot, children: node })
  const { prelude } = await prerender(createElement(MemoryRouter, null, tree), { onError: (error) => void errors.push(error) })
  if (errors.length > 0) throw errors[0]
  return new Response(prelude).text()
}

const text = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

/**
 * The slider on screen: the level beside its name, how far the range is filled,
 * and what a screen reader hears on the thumb (its name and value text). Radix
 * draws the thumb itself only in a browser, so its position isn't checked here.
 */
function slider(html: string) {
  const name = html.match(/role="slider"[^>]*aria-labelledby="([^"]+)"/)?.[1]
  return {
    level: text(html).match(/TV sound effects (Off|\d+%)/)?.[1],
    filled: 100 - Number(html.match(/data-slot="slider-range"[^>]*style="left:0%;right:([\d.]+)%"/)?.[1]),
    thumbName: name ? text(html.match(new RegExp(`id="${name}">([^<]*)<`))?.[1] ?? '').trim() : undefined,
    valueText: html.match(/role="slider"[^>]*aria-valuetext="([^"]*)"/)?.[1],
  }
}

function control(volume: unknown) {
  const snapshot = party('lobby', volume)
  return markup(snapshot, createElement(TvSoundControl, { sessionId: snapshot.session!.id, volume, tvOpen: true }))
}

describe('the TV sound effects control', () => {
  it("shows the party's level beside its name, with the slider filled to it", async () => {
    const html = await control(50)
    expect(slider(html)).toEqual({ level: '50%', filled: 50, thumbName: 'TV sound effects', valueText: '50%' })
    expect(html).toContain('role="slider" aria-valuemin="0" aria-valuemax="100"')
    expect(text(html)).toContain('Phones keep their own volume.')
  })

  it('reads Off at 0, and 100% for a new party or a snapshot from before the setting', async () => {
    expect(slider(await control(0))).toMatchObject({ level: 'Off', filled: 0, valueText: 'Off' })
    expect(slider(await control(100))).toMatchObject({ level: '100%', filled: 100, valueText: '100%' })
    expect(slider(await control(undefined))).toMatchObject({ level: '100%', filled: 100, valueText: '100%' })
  })

  it('shows any level, not only the round ones', async () => {
    expect(slider(await control(35))).toMatchObject({ level: '35%', filled: 35, valueText: '35%' })
  })

  it('sits in the control room\'s "On the TV now", at the party\'s level', async () => {
    const snapshot = party('background', 25)
    const html = await markup(snapshot, createElement(ControlRoomGate, { live: false }))
    expect(text(html)).toContain('On the TV now')
    expect(slider(html)).toMatchObject({ level: '25%', filled: 25, thumbName: 'TV sound effects' })
  })
})

describe('its words', () => {
  it('names each level and says what a change did', () => {
    expect([0, 5, 35, 100].map(soundVolumeLabel)).toEqual(['Off', '5%', '35%', '100%'])
    expect(soundVolumeToast(0)).toBe('TV sound effects off')
    expect(soundVolumeToast(75)).toBe('TV sound effects at 75%')
  })
})
