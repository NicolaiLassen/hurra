// A latecomer on the screens, from the `latecomer` fixture (Sofie joined after
// the start and was dealt in): her phone shows her task as everyone's does,
// under "You're in."; the TV's band counts her; the host's card says dealing
// in is on, until when, and who came late. Rendered to static HTML under Node:
// no effects run, so the phone's join move isn't sent here (dealMeIn.ts).
import { createElement, type ComponentType } from 'react'
import { prerender } from 'react-dom/static'
import { describe, expect, it } from 'vitest'
import { clockTime } from '@/components/tv/clock'
import HostView from '@/games/elimination/HostView'
import { huntHeading, watchLine } from '@/games/elimination/hunt'
import type { EliminationPublicState, EliminationState } from '@/games/elimination/logic'
import PlayerCard from '@/games/elimination/PlayerCard'
import PlayerView from '@/games/elimination/PlayerView'
import TvStatus from '@/games/elimination/TvStatus'
import { FIXTURE_NOW, FIXTURE_PLAYER_ID, fixtureSnapshot } from '@/lib/fixtures'
import type { Snapshot } from '@/lib/types'

const MIN = 60_000

async function html(view: ComponentType<never>, props: object): Promise<string> {
  const errors: unknown[] = []
  const { prelude } = await prerender(createElement(view, props as never), { onError: (error) => void errors.push(error) })
  if (errors.length > 0) throw errors[0]
  // React marks the seams between adjacent text parts with empty comments; the text alone, tags dropped.
  const markup = (await new Response(prelude).text()).replaceAll('<!-- -->', '')
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replaceAll('&#x27;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
    .replace(/\s+/g, ' ')
}

const hunt = (s: Snapshot) => s.games.find((g) => g.game_type === 'elimination')!

function phoneProps(view: unknown, publicState?: EliminationPublicState) {
  const s = fixtureSnapshot('latecomer', 'phone')
  const game = hunt(s)
  return {
    session: s.session,
    game,
    players: s.players,
    publicState: publicState ?? game.public_state,
    prompts: [],
    serverNow: () => FIXTURE_NOW,
    mediaUrl: (path: string) => path,
    player: s.players.find((p) => p.id === FIXTURE_PLAYER_ID)!,
    view,
    myAnswers: {},
    onStage: false,
    act: async () => {},
    submit: async () => ({ accepted: true }),
    open: () => {},
  }
}

describe('a latecomer dealt in', () => {
  const phone = fixtureSnapshot('latecomer', 'phone')
  const view = phone.me!.views[hunt(phone).id] as { status: string; task: string; late?: true }

  it('sees their task on the phone the way everyone does, under a plain line that they are in', async () => {
    expect(view).toMatchObject({ status: 'alive', late: true })
    for (const screen of [PlayerCard, PlayerView]) {
      const text = await html(screen as ComponentType<never>, phoneProps(view))
      expect(text).toContain("You're in.")
      expect(text).not.toContain('still in.')
      expect(text).toContain('Got someone? Scan their code')
      // The task card, face down like everyone's, and the count with them in it.
      expect(text).toContain('8 of 12 left.')
    }
    expect(phone.feed.find((f) => f.message === "You're in Last one standing")).toMatchObject({ audience: [FIXTURE_PLAYER_ID] })
  })

  it('is in the TV band’s count', async () => {
    const tv = fixtureSnapshot('latecomer', 'tv')
    const game = hunt(tv)
    const props = { game, players: tv.players, publicState: game.public_state, gamePoints: {}, tallies: {}, serverNow: () => FIXTURE_NOW }
    expect(await html(TvStatus as ComponentType<never>, { ...props, variant: 'band' })).toContain('8 of 12 still in')
    expect(await html(TvStatus as ComponentType<never>, { ...props, variant: 'strap' })).toContain('8 of 12 still in')
  })

  it('shows "Dealing you in…" while the phone has no task yet, and why it watches once dealing in has closed', async () => {
    const open = hunt(phone).public_state as EliminationPublicState
    expect(await html(PlayerCard as ComponentType<never>, phoneProps(null))).toContain('Dealing you in…')
    const closed = { ...open, dealIn: false }
    const text = await html(PlayerCard as ComponentType<never>, phoneProps(null, closed))
    expect(text).toContain('You watch this round.')
    expect(text).toContain("Dealing in had closed when you joined. You'll be dealt in next time.")
    // Dealing in is open, but this phone can't be dealt in (a freed name it took): it watches.
    expect(await html(PlayerView as ComponentType<never>, phoneProps({ status: 'spectator' }))).toContain("You'll be dealt in next time.")
  })
})

describe('the words', () => {
  it('say where a latecomer stands, and what happens to a guest with no task', () => {
    expect(huntHeading({ status: 'alive', task: 'x', knockouts: 0, late: true }, null)).toBe("You're in.")
    expect(huntHeading({ status: 'alive', task: 'x', knockouts: 2 }, null)).toBe("You're still in.")
    const open = { alive: [], out: [], winner: null, outBy: {}, knockoutCounts: {}, feed: [], dealIn: true, dealInUntil: null }
    expect(watchLine(open, 0)).toBe("You'll be dealt in next time.")
    expect(watchLine({ ...open, dealInUntil: 10 }, 10)).toBe("Dealing in had closed when you joined. You'll be dealt in next time.")
    expect(watchLine(open, 0, true)).toBe("Couldn't deal you in. Check your connection and try again.")
  })
})

describe('the host’s card', () => {
  const host = fixtureSnapshot('latecomer', 'host')
  const game = hunt(host)
  const held = host.states![game.id]
  const state = held.state as EliminationState
  const render = (s: EliminationState, now = FIXTURE_NOW) =>
    html(HostView as ComponentType<never>, {
      players: host.players,
      state: s,
      config: held.config,
      serverNow: () => now,
      act: async () => {},
      publicState: game.public_state,
    })

  it('says dealing in is on, until when, and who came late, with Close dealing in', async () => {
    const text = await render(state)
    expect(text).toContain('Deal in latecomers: on')
    expect(text).toContain(`A guest who joins gets a task until ${clockTime(state.dealInUntil!)}.`)
    expect(text).toContain('1 dealt in late so far.')
    expect(text).toContain('Sofie dealt in late')
    expect(text).toContain('Close dealing in')
    expect(text).toContain('8 of 12 still in')
  })

  it('says when it closed, by itself or by the switch, with Open dealing in', async () => {
    const byItself = await render(state, state.dealInUntil! + MIN)
    expect(byItself).toContain('Deal in latecomers: off')
    expect(byItself).toContain(`Closed by itself at ${clockTime(state.dealInUntil!)}. A guest who joins now watches this round.`)
    expect(byItself).toContain('Open dealing in')
    const bySwitch = await render({ ...state, dealIn: false, dealInUntil: null })
    expect(bySwitch).toContain('Closed. A guest who joins now watches this round.')
    expect(await render({ ...state, dealInUntil: null })).toContain('A guest who joins gets a task until you close it.')
  })
})
