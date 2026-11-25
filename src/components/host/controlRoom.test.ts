// The host control room and the recap preview render every fixture scene
// (src/lib/fixtures.ts, docs/engine-v2.md 5.11) without throwing, with the
// words the host needs. Rendered to static HTML under Node: no effects run, so
// this checks what the screens read while they render.
import { createElement, type ReactNode } from 'react'
import { prerender } from 'react-dom/static'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import RecapPreview from '@/components/host/RecapPreview'
import { gameLogic } from '@/games/logic'
import { FIXTURE_SCENES, fixtureRecapDoc, fixtureSnapshot, type FixtureScene } from '@/lib/fixtures'
import { buildRecapDoc } from '@/lib/recap'
import { recordedRawRecap } from '@/lib/recap.recorded'
import { LiveSessionProvider } from '@/lib/useLive'
import { ControlRoomGate } from '@/pages/host/HostSession'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
// The join card and the dialogs build links from the page's address.
vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' } })

async function html(node: ReactNode): Promise<string> {
  const errors: unknown[] = []
  const { prelude } = await prerender(createElement(MemoryRouter, null, node), { onError: (error) => void errors.push(error) })
  if (errors.length > 0) throw errors[0]
  // Plain text, so assertions read like the screen.
  return (await new Response(prelude).text())
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
}

function controlRoom(scene: FixtureScene) {
  const snapshot = fixtureSnapshot(scene, 'host')
  return html(
    createElement(LiveSessionProvider, {
      sessionId: snapshot.session?.id ?? 'removed',
      screen: 'host',
      fixture: snapshot,
      children: createElement(ControlRoomGate, { live: false }),
    }),
  )
}

describe.each(FIXTURE_SCENES.filter((scene) => scene !== 'removed'))('the control room in the %s fixture', (scene) => {
  it('renders the stage, every live game, the program and the guests', async () => {
    const snapshot = fixtureSnapshot(scene, 'host')
    const text = await controlRoom(scene)
    expect(text).toContain('On the TV now')
    expect(text).toContain(snapshot.session!.name)
    expect(text).toContain(`Players (${snapshot.players.length})`)
    for (const game of snapshot.games) expect(text).toContain(game.title)
    const live = snapshot.games.filter((g) => g.status === 'active' && g.archived_at === null)
    if (live.length > 0) expect(text).toContain(`Live now (${live.length})`)
    else expect(text).not.toContain('Live now')
  })
})

describe('the control room', () => {
  it('says which game holds the TV and keeps the others in the background', async () => {
    const text = await controlRoom('background')
    expect(text).toContain('Live on the TV')
    expect(text).toContain('In the background')
    expect(text).toContain('Show on the TV')
    expect(text).toContain('1 TV paired')
  })

  it('counts down a final screen, with Back to standings', async () => {
    const text = await controlRoom('final')
    expect(text).toContain('Final result: Last one standing')
    expect(text).toContain('The TV goes back in 2:20')
    expect(text).toContain('Back to standings')
    expect(text).toContain('Bo won')
  })

  it('offers both ways to start a game that has not run', async () => {
    const text = await controlRoom('lobby')
    // Last one standing runs in the background by default, the quiz takes the TV.
    expect(text).toContain('Start in the background')
    expect(text).toContain('Start on the TV')
    expect(text).toContain('Scan to join')
  })

  it('marks an archived party, and offers its published recap to the TV', async () => {
    const text = await controlRoom('archived')
    expect(text).toContain('This party is archived')
    expect(text).toContain('Final standings')
    expect(text).toContain('Show the recap on the TV')
    expect(text).not.toContain('Close joining')
  })

  it('says the party is not found for a screen that is not a member', async () => {
    expect(await controlRoom('removed')).toContain('Session not found')
  })
})

describe('the recap preview', () => {
  it('renders a recorded night: the headline and numbers, the awards, the race, every chapter, the TV’s slides, the timeline and a guest’s night', async () => {
    const doc = buildRecapDoc(recordedRawRecap, gameLogic)
    const text = await html(createElement(RecapPreview, { doc }))
    expect(text).toContain('Bo leads the night')
    expect(text).toContain(`${doc.numbers.games} games played`)
    expect(text).toContain(`${doc.numbers.guests} guests`)
    expect(text).toContain("The night's awards")
    expect(text).toContain('Won Beer pong')
    expect(text).toContain('Biggest climber')
    expect(text).toContain('The race')
    for (const chapter of doc.chapters) expect(text).toContain(chapter.title)
    expect(text).toContain('Still running')
    expect(text).toContain('On the TV')
    expect(text).toContain('The night in numbers')
    expect(text).toContain('How the night went')
    for (const entry of doc.timeline.slice(0, 8)) expect(text).toContain(entry.text)
    expect(text).toContain('Your night')
    expect(text).toContain(doc.standings[0].name)
  })

  it('renders the fixtures’ published recap', async () => {
    const doc = fixtureRecapDoc()
    const text = await html(createElement(RecapPreview, { doc }))
    for (const chapter of doc.chapters) expect(text).toContain(chapter.title)
    expect(text).toContain('Hurra for Bo, Freja and Maja')
    // The product's one exclamation mark is a game's winner screen; the night's podium has none.
    expect(text).not.toContain('Maja!')
    expect(text).toContain('Top hunter')
  })
})
