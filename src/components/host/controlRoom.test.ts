// The host control room and the recap preview render every fixture scene
// (src/lib/fixtures.ts, docs/engine-v2.md 5.11) without throwing, with the
// words the host needs. Rendered to static HTML under Node: no effects run, so
// this checks what the screens read while they render.
import { createElement, type ReactNode } from 'react'
import { prerender } from 'react-dom/static'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { addSummary, freeNameDescription, guestListLine, someNames } from '@/components/host/guestListWords'
import RecapPreview from '@/components/host/RecapPreview'
import { gameLogic } from '@/games/logic'
import { knockedOutIds } from '@/games/registry'
import { FIXTURE_EXPECTED_NAMES, FIXTURE_SCENES, fixtureRecapDoc, fixtureSnapshot, type FixtureScene } from '@/lib/fixtures'
import { buildRecapDoc } from '@/lib/recap'
import { recordedRawRecap } from '@/lib/recap.recorded'
import type { Snapshot } from '@/lib/types'
import { LiveSessionProvider } from '@/lib/useLive'
import { ControlRoomGate } from '@/pages/host/HostSession'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
// The join card and the dialogs build links from the page's address.
vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' } })

async function markup(node: ReactNode): Promise<string> {
  const errors: unknown[] = []
  const { prelude } = await prerender(createElement(MemoryRouter, null, node), { onError: (error) => void errors.push(error) })
  if (errors.length > 0) throw errors[0]
  return new Response(prelude).text()
}

async function html(node: ReactNode): Promise<string> {
  // Plain text, so assertions read like the screen.
  return (await markup(node))
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
}

function controlRoom(scene: FixtureScene) {
  return controlRoomOf(fixtureSnapshot(scene, 'host'))
}

function controlRoomOf(snapshot: Snapshot, render: (node: ReactNode) => Promise<string> = html) {
  return render(
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

  it('marks every guest the live hunt has knocked out with the word Out in the player list', async () => {
    const snapshot = fixtureSnapshot('background', 'host')
    const out = knockedOutIds(snapshot.games)
    expect(out.size).toBeGreaterThan(0)
    const text = await controlRoom('background')
    expect(text.split(' Out ').length - 1).toBe(out.size)
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

describe('the guest list', () => {
  it('lists the guests still expected under the players, with how many are here', async () => {
    const text = await controlRoom('lobby')
    expect(text).toContain('Guest list')
    expect(text).toContain('Add guests')
    expect(text).toContain('12 of 16 here. 4 still expected.')
    expect(text).toContain('Still expected (4)')
    expect(text.indexOf('Players (12)')).toBeLessThan(text.indexOf('Guest list'))
    const raw = await controlRoomOf(fixtureSnapshot('lobby', 'host'), markup)
    for (const name of FIXTURE_EXPECTED_NAMES) expect(raw).toContain(`aria-label="More actions for ${name}"`)
    // Joined guests are in Players only, never repeated on the list: one menu each.
    expect(raw.split('aria-label="More actions for Ana"').length - 1).toBe(1)
  })

  it('invites the host to add guests when the list is empty, and says when everyone is here', async () => {
    const lobby = fixtureSnapshot('lobby', 'host')
    const empty = await controlRoomOf({ ...lobby, players: [], standings: [], guests: [] })
    expect(empty).toContain('Nobody has joined yet.')
    expect(empty).toContain('Add the guests you invited. When they join, they tap their name instead of typing it')
    expect(empty).not.toContain('Still expected')
    const everyone = await controlRoomOf({ ...lobby, guests: lobby.guests!.filter((g) => g.joined_at !== null) })
    expect(everyone).toContain('Everyone on the list is here.')
    expect(everyone).not.toContain('Still expected')
  })

  it('has a search from 9 names still expected', async () => {
    const lobby = fixtureSnapshot('lobby', 'host')
    const more = ['Astrid', 'Bjørn', 'Cornelia', 'Dagny', 'Elias'].map((name, i) => ({ id: `extra-${i}`, name, joined_at: null, created_at: 0 }))
    expect(await controlRoomOf(lobby, markup)).not.toContain('Find a name on the list')
    const listed = { ...lobby, guests: [...lobby.guests!, ...more] }
    expect(await controlRoomOf(listed, markup)).toContain('placeholder="Find a name on the list"')
    const text = await controlRoomOf(listed)
    expect(text).toContain('Still expected (9)')
    expect(text).toContain('12 of 21 here. 9 still expected.')
  })

  it('has no Add guests once the party is archived', async () => {
    const text = await controlRoom('archived')
    expect(text).toContain('Guest list')
    expect(text).not.toContain('Add guests')
  })

  it('is not there on a database without a guest list', async () => {
    const lobby = fixtureSnapshot('lobby', 'host')
    const text = await controlRoomOf({ ...lobby, guests: undefined })
    expect(text).toContain('Players (12)')
    expect(text).not.toContain('Guest list')
  })

  it('words the card line in its three states', () => {
    expect(guestListLine({ here: 0, expected: 0, total: 0 })).toMatch(/^Add the guests you invited\./)
    expect(guestListLine({ here: 12, expected: 18, total: 30 })).toBe('12 of 30 here. 18 still expected.')
    expect(guestListLine({ here: 1, expected: 29, total: 30 })).toBe('1 of 30 here. 29 still expected.')
    expect(guestListLine({ here: 0, expected: 4, total: 4 })).toBe('0 of 4 here. 4 still expected.')
    expect(guestListLine({ here: 24, expected: 0, total: 24 })).toBe('Everyone on the list is here.')
  })

  it('says what Add guests did: added, already on the list, too long', () => {
    expect(addSummary({ added: [{ id: '1', name: 'Zelda' }], skipped: [] })).toEqual({
      title: 'Added Zelda',
      description: undefined,
      added: true,
      tooLong: [],
    })
    const long = 'Signe-Lykke Kjærsgaard Østergaard Holmgaard'
    expect(
      addSummary({
        added: Array.from({ length: 12 }, (_, i) => ({ id: String(i), name: `Guest ${i}` })),
        skipped: [
          { name: 'Ana', reason: 'taken' },
          { name: 'Bo', reason: 'repeat' },
          { name: long, reason: 'too_long' },
        ],
      }),
    ).toEqual({
      title: 'Added 12 guests',
      description: 'Already on the list: Ana and Bo. Over 40 characters: 1 name.',
      added: true,
      tooLong: [long],
    })
    expect(addSummary({ added: [], skipped: [{ name: 'Ana', reason: 'taken' }, { name: 'ana', reason: 'repeat' }] })).toEqual({
      title: 'Everyone you added is already on the list',
      added: false,
      tooLong: [],
    })
    expect(addSummary({ added: [], skipped: [{ name: 'Ana', reason: 'taken' }, { name: long, reason: 'too_long' }] })).toMatchObject({
      title: 'Already on the list: Ana',
      tooLong: [long],
    })
    expect(addSummary({ added: [], skipped: [{ name: long, reason: 'too_long' }] })).toMatchObject({ title: null, tooLong: [long] })
    // A name left out reads as the list has it, a repeat of a name added now too.
    expect(
      addSummary(
        { added: [{ id: '1', name: 'Zelda' }, { id: '2', name: 'Søren' }], skipped: [{ name: 'ana', reason: 'taken' }, { name: 'soren', reason: 'repeat' }, { name: 'ZELDA', reason: 'repeat' }] },
        ['Ana', 'Bo'],
      ).description,
    ).toBe('Already on the list: Ana, Søren and Zelda.')
    expect(someNames(['Ana', 'Bo', 'Mads', 'Sofie', 'Freja', 'Lars', 'Emil'])).toBe('Ana, Bo, Mads, Sofie, Freja and 2 more')
  })

  it('builds the Free the name confirm from what applies', () => {
    const plain = 'Ana goes back on the guest list as still expected, and the phone that has the name asks Who are you? again.'
    expect(freeNameDescription({ name: 'Ana', points: 0, joiningOpen: true })).toBe(plain)
    expect(freeNameDescription({ name: 'Ana', points: 5, joiningOpen: true })).toBe(`${plain} The 5 points it earned as Ana go with it.`)
    expect(freeNameDescription({ name: 'Ana', points: 1, joiningOpen: false })).toBe(
      `${plain} The 1 point it earned as Ana goes with it. Joining is closed: open it so they can pick their name.`,
    )
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
