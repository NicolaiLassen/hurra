// The host control room and the recap preview render every fixture scene
// (src/lib/fixtures.ts, docs/engine-v2.md 5.11) without throwing, with the
// words the host needs. Rendered to static HTML under Node: no effects run, so
// this checks what the screens read while they render.
import { createElement, type ReactNode } from 'react'
import { prerender } from 'react-dom/static'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { addSummary, freeNameDescription, guestListLine, keptNote, presenceLine, removePlayerDescription, someNames } from '@/components/host/guestListWords'
import RecapPreview from '@/components/host/RecapPreview'
import { gameLogic } from '@/games/logic'
import { knockedOutIds } from '@/games/registry'
import { FIXTURE_EXPECTED_NAMES, FIXTURE_NOW, FIXTURE_SCENES, fixtureRecapDoc, fixtureSettings, fixtureSnapshot, type FixtureScene } from '@/lib/fixtures'
import { buildRecapDoc } from '@/lib/recap'
import { recordedRawRecap } from '@/lib/recap.recorded'
import type { Snapshot } from '@/lib/types'
import { LiveSessionProvider } from '@/lib/useLive'
import { ControlRoomGate } from '@/pages/host/HostSession'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
// The join card and the dialogs build links from the page's address.
vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' } })

async function markup(node: ReactNode, at = '/'): Promise<string> {
  const errors: unknown[] = []
  const { prelude } = await prerender(createElement(MemoryRouter, { initialEntries: [at] }, node), { onError: (error) => void errors.push(error) })
  if (errors.length > 0) throw errors[0]
  return new Response(prelude).text()
}

async function html(node: ReactNode, at?: string): Promise<string> {
  // Plain text, so assertions read like the screen.
  return (await markup(node, at))
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
    expect(text).toContain(`Here (${snapshot.players.length})`)
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

describe('the guests', () => {
  it('lists everyone in one list, Not yet on top, with how many are here', async () => {
    const text = await controlRoom('lobby')
    expect(text).toContain('Guests')
    expect(text).toContain('Add guests')
    expect(text).toContain('12 of 16 here')
    expect(text).toContain('Not yet (4)')
    expect(text).toContain('Here (12)')
    expect(text).not.toContain('Players (')
    expect(text.indexOf('Not yet (4)')).toBeLessThan(text.indexOf('Here (12)'))
    // Each group by name, the Danish way.
    expect(text.indexOf('Quentin')).toBeLessThan(text.indexOf('Zelda'))
    expect(text.indexOf('Zelda')).toBeLessThan(text.indexOf('Here (12)'))
    expect(text.indexOf(' Ana ', text.indexOf('Here (12)'))).toBeLessThan(text.indexOf(' Sofie ', text.indexOf('Here (12)')))
    // A bad paste is undone in one step.
    expect(text).toContain('Remove everyone not here yet…')
    const raw = await controlRoomOf(fixtureSnapshot('lobby', 'host'), markup)
    for (const name of FIXTURE_EXPECTED_NAMES) expect(raw).toContain(`aria-label="More actions for ${name}"`)
    // Every guest is in the list once: one menu each.
    expect(raw.split('aria-label="More actions for Ana"').length - 1).toBe(1)
  })

  it('marks every guest Here or Not yet in words, and the one who typed their name', async () => {
    const text = await controlRoom('lobby')
    // The marks, not the groups' headings ("Not yet (4)").
    expect(text.match(/ Not yet (?!\()/g)).toHaveLength(4)
    expect(text.match(/ Here (?!\()/g)).toHaveLength(12)
    expect(text).toMatch(/Oscar Here 0 Typed their name/)
    expect(text.split('Typed their name').length - 1).toBe(1)
  })

  it('moves a guest to Here as they join', async () => {
    const lobby = fixtureSnapshot('lobby', 'host')
    const zelda = lobby.guests!.find((g) => g.name === 'Zelda')!
    const joined = {
      ...lobby,
      guests: lobby.guests!.map((g) => (g.id === zelda.id ? { ...g, joined_at: FIXTURE_NOW } : g)),
      standings: [...lobby.standings, { player_id: zelda.id, name: 'Zelda', code: 'Z1Z2Z', points: 0, profile: {} }],
    }
    const text = await controlRoomOf(joined)
    expect(text).toContain('13 of 16 here')
    expect(text).toContain('Not yet (3)')
    expect(text).toContain('Here (13)')
    expect(text.indexOf('Zelda')).toBeGreaterThan(text.indexOf('Here (13)'))
  })

  it('keeps every action on the rows: give points, rename, move, free the name and remove; rename and remove from the list', async () => {
    const raw = await controlRoomOf(fixtureSnapshot('lobby', 'host'), markup)
    // A guest who is here opens the award page from their name.
    const ana = fixtureSnapshot('lobby', 'host').standings.find((r) => r.name === 'Ana')!
    expect(raw).toContain(`href="/p/${ana.code}"`)
  })

  it('invites the host to add guests when the list is empty, and says when everyone is here', async () => {
    const lobby = fixtureSnapshot('lobby', 'host')
    const empty = await controlRoomOf({ ...lobby, players: [], standings: [], guests: [] })
    expect(empty).toContain('Nobody here yet')
    expect(empty).toContain('Add the guests you invited. When they join, they tap their name instead of typing it')
    expect(empty).not.toContain('Not yet (')
    // Everyone joined, most of them by taking a listed name.
    const joined = lobby.guests!.filter((g) => g.joined_at !== null)
    const everyone = await controlRoomOf({ ...lobby, guests: joined })
    expect(everyone).toContain('All 12 here')
    expect(everyone).not.toContain('Not yet (')
    // Guests who typed their names, and nobody listed: the invitation, and no guest marked as typed.
    const typed = await controlRoomOf({ ...lobby, guests: joined.map((g) => ({ ...g, created_at: g.joined_at! })) })
    expect(typed).toContain('12 here')
    expect(typed).toContain('Add the guests you invited.')
    expect(typed).not.toContain('Typed their name')
  })

  it('has a search from 9 names', async () => {
    const lobby = fixtureSnapshot('lobby', 'host')
    const more = ['Astrid', 'Bjørn', 'Cornelia', 'Dagny', 'Elias'].map((name, i) => ({ id: `extra-${i}`, name, joined_at: null, created_at: 0 }))
    expect(await controlRoomOf(lobby, markup)).toContain('placeholder="Find a guest"')
    const few = { ...lobby, standings: lobby.standings.slice(0, 2), players: lobby.players.slice(0, 2), guests: lobby.guests!.filter((g) => g.joined_at === null) }
    expect(await controlRoomOf(few, markup)).not.toContain('placeholder="Find a guest"')
    const text = await controlRoomOf({ ...lobby, guests: [...lobby.guests!, ...more] })
    expect(text).toContain('Not yet (9)')
    expect(text).toContain('12 of 21 here')
  })

  it('has no Add guests and no Remove everyone not here yet once the party is archived', async () => {
    const text = await controlRoom('archived')
    expect(text).toContain('Guests')
    expect(text).not.toContain('Add guests')
    expect(text).not.toContain('Remove everyone not here yet')
  })

  it('lists the players as here on a database without a guest list', async () => {
    const lobby = fixtureSnapshot('lobby', 'host')
    const text = await controlRoomOf({ ...lobby, guests: undefined })
    expect(text).toContain('12 here')
    expect(text).toContain('Here (12)')
    expect(text).not.toContain('Add guests')
    expect(text).not.toContain('Not yet')
  })

  it('words the count in its states, and invites while nobody is listed', () => {
    expect(presenceLine({ here: 0, expected: 0, total: 0, listed: 0 })).toBe('Nobody here yet')
    expect(presenceLine({ here: 14, expected: 8, total: 22, listed: 21 })).toBe('14 of 22 here')
    expect(presenceLine({ here: 0, expected: 4, total: 4, listed: 4 })).toBe('0 of 4 here')
    expect(presenceLine({ here: 24, expected: 0, total: 24, listed: 20 })).toBe('All 24 here')
    expect(presenceLine({ here: 5, expected: 0, total: 5, listed: 0 })).toBe('5 here')
    // The list helps guests join and shows who is here; games take typed names, with the list as suggestions.
    expect(guestListLine({ listed: 0 })).toBe(
      'Add the guests you invited. When they join, they tap their name instead of typing it, and this list shows who is here. ' +
        'Games that name people take typed names, with these names as suggestions.',
    )
    expect(guestListLine({ listed: 3 })).toBeNull()
  })

  it('says what Add guests did: added, already on the list, repeated in the paste, too long', () => {
    expect(addSummary({ added: [{ id: '1', name: 'Zelda' }], skipped: [] })).toEqual({
      title: 'Added Zelda',
      description: undefined,
      added: true,
      tooLong: [],
      repeated: [],
    })
    const long = 'Signe-Lykke Kjærsgaard Østergaard Holmgaard'
    expect(
      addSummary({
        added: [...Array.from({ length: 11 }, (_, i) => ({ id: String(i), name: `Guest ${i}` })), { id: 'm', name: 'Mads' }],
        skipped: [
          { name: 'Ana', reason: 'taken' },
          { name: 'mads', reason: 'repeat' },
          { name: long, reason: 'too_long' },
        ],
      }),
    ).toEqual({
      title: 'Added 12 guests',
      description: 'Already on the list: Ana. Mads was on more than one line: added once. Over 40 characters: 1 name.',
      added: true,
      tooLong: [long],
      // Kept in the field, as the list has it, in case they are two people.
      repeated: ['Mads'],
    })
    // A repeat of a name already on the list is only "already on the list".
    expect(addSummary({ added: [], skipped: [{ name: 'Ana', reason: 'taken' }, { name: 'ana', reason: 'repeat' }] })).toEqual({
      title: 'Everyone you added is already on the list',
      added: false,
      tooLong: [],
      repeated: [],
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
    ).toBe('Already on the list: Ana. Søren and Zelda were on more than one line: added once.')
    expect(someNames(['Ana', 'Bo', 'Mads', 'Sofie', 'Freja', 'Lars', 'Emil'])).toBe('Ana, Bo, Mads, Sofie, Freja and 2 more')
  })

  it('says why names stay in the Add guests field', () => {
    expect(keptNote({ tooLong: 0, repeated: ['Mads'], over: 0 })).toEqual([
      "Mads was on more than one line, so the list has one Mads. If they are two people, add a last name or an initial to the one here and add it again. If not, you're done.",
    ])
    expect(keptNote({ tooLong: 2, repeated: ['Mads', 'Bo'], over: 3 })).toEqual([
      "Mads and Bo were each on more than one line, so the list has each of them once. If any are two people, add a last name or an initial to the one here and add it again. If not, you're done.",
      'These are over 40 characters. Shorten them and add them again.',
      'These are the names after the first 100. Add them now.',
    ])
    expect(keptNote({ tooLong: 1, repeated: [], over: 0 })).toEqual(['This name is over 40 characters. Shorten it and add it again.'])
  })

  it('builds the Free the name confirm from what applies', () => {
    const plain = 'Ana goes back on the guest list as not here yet, and the phone that has the name asks Who are you? again.'
    expect(freeNameDescription({ name: 'Ana', points: 0, joiningOpen: true })).toBe(plain)
    expect(freeNameDescription({ name: 'Ana', points: 5, joiningOpen: true })).toBe(`${plain} The 5 points it earned as Ana go with it.`)
    expect(freeNameDescription({ name: 'Ana', points: 1, joiningOpen: false })).toBe(
      `${plain} The 1 point it earned as Ana goes with it. Joining is closed: open it so they can pick their name.`,
    )
    // A name the guest typed goes on the list for the first time, and may be another spelling of a listed one.
    expect(freeNameDescription({ name: 'Mads H', points: 0, joiningOpen: true, typed: true })).toBe(
      'Mads H goes on the guest list as not here yet, and the phone that has the name asks Who are you? again. ' +
        'Another spelling of a name on the list? Free it and take Mads H off the list.',
    )
  })

  it('builds the Remove confirm: the guest list and settings lose them, and Free the name for a wrong name', () => {
    const lead = 'Their points go with them, and the games running now carry on without them.'
    const move = 'On a new phone? Move them instead: their points stay.'
    const list = 'Ana also leaves the guest list.'
    expect(removePlayerDescription({ name: 'Ana', listed: true, canFree: true })).toBe(
      `${lead} ${list} Took the wrong name? Free the name instead: it stays on the list. ${move}`,
    )
    expect(removePlayerDescription({ name: 'Ana', listed: false, canFree: true })).toBe(`${lead} ${list} ${move}`)
    // A database without the guest list: the words from before.
    expect(removePlayerDescription({ name: 'Ana', listed: false, canFree: false })).toBe(`${lead} ${move}`)
  })
})

describe('the games’ settings in the control room', () => {
  /** The room with the scene's own game settings, as the fixture page reads them, at an address in the room. */
  function roomWithSettings(scene: FixtureScene, render: (node: ReactNode) => Promise<string>) {
    const snapshot = fixtureSnapshot(scene, 'host')
    return render(
      createElement(LiveSessionProvider, {
        sessionId: snapshot.session!.id,
        screen: 'host',
        fixture: snapshot,
        children: createElement(ControlRoomGate, { live: false, settings: fixtureSettings(scene) }),
      }),
    )
  }
  /** The gold buttons on the screen: the default Button variant, unless disabled (then it is a plain overlay bar). */
  const goldButtons = (raw: string) => raw.match(/<button(?![^>]*disabled="")[^>]*data-variant="default"/g)?.length ?? 0
  /** The markup before the hidden room: what the settings page shows. */
  const pageOf = (raw: string) => raw.slice(0, raw.search(/<main class="[^"]*hidden/))
  const idOf = (scene: FixtureScene, title: string) => fixtureSnapshot(scene, 'host').games.find((g) => g.title === title)!.id

  it('says under each game whether it is ready, and puts Set up in place of the Start of those that are not', async () => {
    const text = await roomWithSettings('setup', html)
    expect(text).toContain('12 tasks for 16 guests, so some get the same task')
    expect(text).toContain('Not ready: 6 of 8 songs ready: 2 need a photo')
    expect(text).toContain('Not ready: 6 of 8 pictures ready: 2 need two names')
    expect(text).toContain('Ready: 10 questions ready, 20 s each')
    expect(text).toContain('Nothing to set up')
    expect(text.split(' Set up ').length - 1).toBe(2)
    // Settings beside the Start of the two ready games with settings; the in-person round has none.
    expect(text.split(' Settings ').length - 1).toBe(2)
    expect(text).toContain('Start in the background')
  })

  it('has one gold step: Set up on the first game not ready while no TV is paired, not Pair a TV', async () => {
    const raw = await roomWithSettings('setup', markup)
    expect(goldButtons(raw)).toBe(1)
    expect(raw).toMatch(/data-slot="button" data-variant="default"[^>]*data-settings-for="[^"]+"[^>]*aria-label="Set up Lydspor"/)
    expect(raw).toContain('No TV paired yet')
  })

  it('starts the first game with its gold Start once everything is set up and a TV is paired', async () => {
    const raw = await roomWithSettings('setup-ready', markup)
    // Fusion's #7 is of Tilde, who is on no list: counted, as the editor flags it, but never holding the game back.
    const text = await roomWithSettings('setup-ready', html)
    expect(text).toContain('Ready: 8 pictures, all with two names. 1 name matches nobody here or on the guest list. Own photos (optional): 14 of 16')
    expect(goldButtons(raw)).toBe(2) // the split Start's two halves
    expect(raw).not.toContain('aria-label="Set up')
    expect(raw).toMatch(/aria-label="Start Last one standing"[^]*?data-variant="default"/)
  })

  it('gives each game a Settings button in the row, never only in its menu', async () => {
    const raw = await roomWithSettings('lobby', markup)
    for (const title of ['Last one standing', 'Quiz', 'Who is fused?']) expect(raw).toContain(`aria-label="Settings of ${title}"`)
  })

  it('opens a game’s settings as a page of its own, with its name, readiness, Cancel and Save, the room kept underneath', async () => {
    const at = `/host/s/x?fixture=setup&settings=${idOf('setup', 'Who is fused?')}`
    const raw = await roomWithSettings('setup', (node) => markup(node, at))
    const text = await roomWithSettings('setup', (node) => html(node, at))
    expect(text).toContain('Who is fused?')
    expect(text).toContain('Participant fusion settings')
    expect(text).toContain('6 of 8 pictures ready: 2 need two names')
    expect(text).toContain('Cancel')
    expect(text).toContain('Pictures (8)')
    expect(raw).toContain('aria-label="Back to the room"')
    // Nothing changed yet, so nothing on the page is gold: Save waits for a change.
    expect(goldButtons(pageOf(raw))).toBe(0)
    expect(pageOf(raw)).toMatch(/<button[^>]*disabled=""[^>]*>Save<\/button>/)
    // The room is still there, hidden, so it comes back where the host left it.
    expect(raw).toMatch(/<main class="[^"]*hidden/)
  })

  it('opens Lydspor, the quiz and Last one standing on their own settings', async () => {
    for (const [title, words] of [
      ['Lydspor', 'Songs (8 of 12)'],
      ['Quiz', 'Which planet is known as the red planet?'],
      ['Last one standing', 'Tasks (12)'],
    ] as const) {
      const at = `/host/s/x?settings=${idOf('setup', title)}`
      const text = await roomWithSettings('setup', (node) => html(node, at))
      expect(text, title).toContain(words)
      expect(await roomWithSettings('setup', (node) => markup(node, at)), title).toContain('aria-label="Back to the room"')
    }
  })

  it('puts Reset to the 60 default tasks on top of Last one standing’s settings while its saved list is shorter', async () => {
    // The scene's saved list has 12 tasks: its row says the default list's size.
    const room = await roomWithSettings('setup', html)
    expect(room).toContain('12 tasks for 16 guests, so some get the same task; the default list has 60')
    const at = `/host/s/x?settings=${idOf('setup', 'Last one standing')}`
    const text = await roomWithSettings('setup', (node) => html(node, at))
    const raw = await roomWithSettings('setup', (node) => markup(node, at))
    expect(text).toContain('This game has 12 saved tasks. The default list has 60 party moments')
    expect(text).toContain('Reset to the 60 default tasks')
    // One reset: the note's button, never also the small link beside the count.
    expect(text).not.toContain('Reset to the default tasks')
    expect(raw.replace(/<!-- -->/g, '')).toMatch(/<button[^>]*data-variant="secondary"[^>]*>(?:(?!<\/button>)[^])*Reset to the 60 default tasks/)
    // Quiet, so the page's Save stays its one gold step.
    expect(goldButtons(pageOf(raw))).toBe(0)
  })

  it('stays in the room for a game that is live or gone', async () => {
    const live = fixtureSnapshot('background', 'host').games.find((g) => g.status === 'active')!
    const text = await roomWithSettings('background', (node) => html(node, `/host/s/x?settings=${live.id}`))
    expect(text).toContain('On the TV now')
    expect(text).not.toContain('Cancel')
    const gone = await roomWithSettings('setup', (node) => html(node, '/host/s/x?settings=no-such-game'))
    expect(gone).toContain('On the TV now')
  })

  it('gives the gold to the game on the TV: the quiz’s Reveal now, with the darts round beside it quiet until darts is on the TV', async () => {
    /** Gold buttons and gold links (a Button asChild), each with its words. */
    const goldSteps = (raw: string) =>
      [...raw.matchAll(/<(button|a)\b(?![^>]*disabled="")[^>]*data-variant="default"[^>]*>([^]*?)<\/\1>/g)].map((m) => m[2].replace(/<[^>]+>/g, '').trim())
    const scanLink = (raw: string, scene: FixtureScene) => raw.match(new RegExp(`<a[^>]*href="/host/scan\\?game=${idOf(scene, 'Darts')}"[^>]*>`))?.[0] ?? ''

    const beside = await roomWithSettings('background', markup)
    expect(goldSteps(beside)).toEqual(['Reveal now'])
    // Darts runs in the background, so its card starts closed: its Scan a player waits behind the caret.
    expect(scanLink(beside, 'background')).toBe('')
    expect(beside).toContain('aria-label="Show the controls of Darts"')
    expect(beside).toContain('aria-label="Show the controls of Last one standing"')
    expect(beside).toContain('aria-label="Hide the controls of Quiz"')

    const onTv = await roomWithSettings('in-person', markup)
    expect(goldSteps(onTv)).toEqual(['Scan a player'])
    expect(scanLink(onTv, 'in-person')).toContain('data-variant="default"')
  })

  it('gives fusion on the TV one gold step at each step of its round: Ask #1 from the lobby, never a showing', async () => {
    const goldSteps = (raw: string) =>
      [...raw.matchAll(/<(button|a)\b(?![^>]*disabled="")[^>]*data-variant="default"[^>]*>([^]*?)<\/\1>/g)].map((m) => m[2].replace(/<[^>]+>/g, '').trim())
    const steps: Partial<Record<FixtureScene, string[]>> = {
      'fusion-lobby': ['Ask #1'],
      'fusion-start': ['Ask #1'],
      'fusion-wall': ['Ask #4'],
      'fusion-hop': ['Reveal now'],
      'fusion-asking': ['Reveal now'],
      'fusion-reveal': ['Back to the wall'],
      'fusion-crown': ['Crown the face detective'],
    }
    for (const [scene, gold] of Object.entries(steps) as [FixtureScene, string[]][]) {
      const raw = await roomWithSettings(scene, markup)
      expect(goldSteps(raw), scene).toEqual(gold)
    }
    const lobby = await roomWithSettings('fusion-lobby', html)
    expect(lobby).not.toMatch(/Start the showing|Skip to the wall/)
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
