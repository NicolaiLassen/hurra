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

const STEP = /^(Off|\d+%)$/

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

/** The volume steps on screen: each one's label and whether it is pressed. */
function steps(html: string): [string, boolean][] {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .map(([, attributes, inside]): [string, boolean] => [text(inside).trim(), /aria-pressed="true"/.test(attributes)])
    .filter(([label]) => STEP.test(label))
}

function control(volume: unknown) {
  const snapshot = party('lobby', volume)
  return markup(snapshot, createElement(TvSoundControl, { sessionId: snapshot.session!.id, volume, tvOpen: true }))
}

describe('the TV sound effects control', () => {
  it("offers Off to 100% and presses the party's step", async () => {
    const html = await control(50)
    expect(steps(html)).toEqual([
      ['Off', false],
      ['25%', false],
      ['50%', true],
      ['75%', false],
      ['100%', false],
    ])
    expect(text(html)).toContain('TV sound effects')
    expect(text(html)).toContain('Phones keep their own volume.')
  })

  it('presses Off at 0, and 100% for a new party or a snapshot from before the setting', async () => {
    expect(steps(await control(0)).filter(([, pressed]) => pressed)).toEqual([['Off', true]])
    expect(steps(await control(100)).filter(([, pressed]) => pressed)).toEqual([['100%', true]])
    expect(steps(await control(undefined)).filter(([, pressed]) => pressed)).toEqual([['100%', true]])
  })

  it('says what a volume set some other way is, with no step pressed', async () => {
    const html = await control(60)
    expect(steps(html).some(([, pressed]) => pressed)).toBe(false)
    expect(text(html)).toContain('TV sound effects 60%')
  })

  it('sits in the control room\'s "On the TV now", with the party\'s step pressed', async () => {
    const snapshot = party('background', 25)
    const html = await markup(snapshot, createElement(ControlRoomGate, { live: false }))
    expect(text(html)).toContain('On the TV now')
    expect(steps(html)).toEqual([
      ['Off', false],
      ['25%', true],
      ['50%', false],
      ['75%', false],
      ['100%', false],
    ])
  })
})

describe('its words', () => {
  it('names each step and says what a change did', () => {
    expect([0, 25, 50, 75, 100].map(soundVolumeLabel)).toEqual(['Off', '25%', '50%', '75%', '100%'])
    expect(soundVolumeToast(0)).toBe('TV sound effects off')
    expect(soundVolumeToast(75)).toBe('TV sound effects at 75%')
  })
})
