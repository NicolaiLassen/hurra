// Every registered game's screens render every fixture scene (src/lib/fixtures.ts,
// docs/engine-v2.md 5.11) on the screens that show them, without throwing. The
// phone, TV and host pages build against these fixtures, so a game view that
// can't read them would break those pages. Rendered to static HTML under Node:
// no effects run, so this checks what a view reads while it renders.
import { createElement, type ComponentType } from 'react'
import { prerender } from 'react-dom/static'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { gameModules } from '@/games/registry'
import type { GameModule } from '@/games/types'
import { FIXTURE_EXPECTED_NAMES, FIXTURE_NOW, FIXTURE_PLAYER_ID, FIXTURE_SCENES, fixtureSnapshot } from '@/lib/fixtures'
import { guestsOf } from '@/lib/guestList'
import type { SessionGame, Snapshot } from '@/lib/types'

// TV views size their tiles from the root font size while they render.
vi.stubGlobal('document', { documentElement: {} })
vi.stubGlobal('getComputedStyle', () => ({ fontSize: '16px' }))

/** Renders to HTML inside a router, as the pages do, waiting for lazy views; rejects with the first render error. */
async function render(view: ComponentType<never> | undefined, props: Record<string, unknown>): Promise<string> {
  if (!view) return ''
  const errors: unknown[] = []
  const { prelude } = await prerender(createElement(MemoryRouter, null, createElement(view, props as never)), { onError: (error) => void errors.push(error) })
  if (errors.length > 0) throw errors[0]
  return new Response(prelude).text()
}

const component = (c: unknown) => c as ComponentType<never> | undefined

function screenProps(snapshot: Snapshot, game: SessionGame) {
  return {
    session: snapshot.session!,
    game,
    players: snapshot.players,
    publicState: game.public_state,
    prompts: snapshot.prompts.filter((p) => p.game_id === game.id),
    serverNow: () => FIXTURE_NOW,
    mediaUrl: (path: string) => `/media/${path}`,
  }
}

const gamesOf = (snapshot: Snapshot, module: GameModule) =>
  snapshot.games.filter((g) => g.game_type === module.logic.type && g.public_state !== null)

describe.each(FIXTURE_SCENES.filter((scene) => scene !== 'removed'))('the %s fixture', (scene) => {
  const phone = fixtureSnapshot(scene, 'phone')
  const tv = fixtureSnapshot(scene, 'tv')
  const host = fixtureSnapshot(scene, 'host')

  describe.each(gameModules.map((m) => [m.logic.type, m] as const))('%s', (_, module) => {
    it('renders on the phone: the view and compact card while live, the result once finished', async () => {
      const player = phone.players.find((p) => p.id === FIXTURE_PLAYER_ID)!
      for (const game of gamesOf(phone, module)) {
        const view = phone.me?.views[game.id] ?? null
        if (game.status === 'active') {
          const props = {
            ...screenProps(phone, game),
            player,
            view,
            myAnswers: phone.me?.answers[game.id] ?? {},
            onStage: phone.session?.spotlight_game_id === game.id,
            act: async () => {},
            submit: async () => ({ accepted: true, answer: { choice: ['0'] }, at: FIXTURE_NOW, ms: 0 }),
            open: () => {},
          }
          await expect(render(component(module.PlayerView), props)).resolves.toBeTypeOf('string')
          await expect(render(component(module.PlayerCard), props)).resolves.toBeTypeOf('string')
        } else {
          const props = { session: phone.session, game, player, players: phone.players, publicState: game.public_state, view, gamePoints: phone.game_points[game.id] ?? {} }
          await expect(render(component(module.ResultView), props)).resolves.toBeTypeOf('string')
        }
      }
    })

    it('renders on the TV: the stage view, the final screen and the rail card', async () => {
      for (const game of gamesOf(tv, module)) {
        const gamePoints = tv.game_points[game.id] ?? {}
        const tallies = tv.tallies[game.id] ?? {}
        const props = {
          ...screenProps(tv, game),
          scores: tv.standings,
          gamePoints,
          tallies,
          feed: tv.feed.filter((item) => item.game_id === game.id),
          finished: game.status === 'finished',
        }
        await expect(render(component(module.TvView), props)).resolves.toBeTypeOf('string')
        if (game.status === 'finished') await expect(render(component(module.FinalTvView), props)).resolves.toBeTypeOf('string')
        const status = { game, players: tv.players, publicState: game.public_state, gamePoints, tallies, serverNow: () => FIXTURE_NOW }
        await expect(render(component(module.TvStatus), status)).resolves.toBeTypeOf('string')
      }
    })

    it('renders on the host page while live', async () => {
      for (const game of gamesOf(host, module).filter((g) => g.status === 'active')) {
        const held = host.states?.[game.id]
        const props = {
          ...screenProps(host, game),
          state: held?.state ?? null,
          config: held?.config ?? null,
          tallies: host.tallies[game.id] ?? {},
          gamePoints: host.game_points[game.id] ?? {},
          // The whole guest list, with the four still expected.
          guests: guestsOf(host),
          act: async () => {},
        }
        await expect(render(component(module.HostView), props)).resolves.toBeTypeOf('string')
      }
    })
  })
})

describe.each(gameModules.map((m) => [m.logic.type, m] as const))('%s settings editor', (_, module) => {
  it('renders the default settings', async () => {
    const host = fixtureSnapshot('lobby', 'host')
    const game = host.games.find((g) => g.game_type === module.logic.type) ?? host.games[0]
    const props = {
      config: module.logic.defaultConfig,
      onChange: () => {},
      session: host.session,
      game,
      players: host.players,
      guests: guestsOf(host),
      media: { upload: async () => 'media/x.jpg', url: (path: string) => path },
    }
    await expect(render(component(module.ConfigEditor), props)).resolves.toBeTypeOf('string')
  })
})

describe('fusion settings editor', () => {
  const host = fixtureSnapshot('lobby', 'host')
  const fusion = gameModules.find((m) => m.logic.type === 'fusion')!
  const game = host.games.find((g) => g.game_type === 'fusion')!
  const guests = guestsOf(host)
  const zelda = guests.find((g) => g.name === FIXTURE_EXPECTED_NAMES[0])!
  const ana = guests.find((g) => g.name === 'Ana')!
  const props = (people: [string, string]) => ({
    config: { ...(fusion.logic.defaultConfig as Record<string, unknown>), pictures: [{ label: '', people }] },
    onChange: () => {},
    session: host.session,
    game,
    players: host.players,
    guests,
    media: { upload: async () => 'media/x.jpg', url: (path: string) => path },
  })

  it('renders pictures that name a guest still expected, before anyone joined', async () => {
    expect(zelda.joined).toBe(false)
    // The pickers fill their menus in a browser only, so the names listed can't be read from static HTML.
    for (const players of [host.players, []]) {
      const html = await render(component(fusion.ConfigEditor), { ...props([ana.id, zelda.id]), players })
      expect(html).toContain('Who is in it, each with their own photo?')
      expect(html).toContain('aria-label="First person in picture 1"')
      expect(html).not.toContain('Pick two different people')
      expect(html).not.toContain('Pick the second person')
    }
  })
})
