// The host's control room view of Last one standing, rendered to static HTML
// under Node: with Show tasks off, a knockout's task shows only once nobody
// still holds the same text, exactly as the room's feed does (publicState).
// Tasks repeat when there are more guests than tasks, and the host's phone is
// out in the room.
import { createElement, type ComponentType } from 'react'
import { prerender } from 'react-dom/static'
import { describe, expect, it } from 'vitest'
import { createGameContext } from '@/games/core/context'
import { seededRandom, testInfo } from '@/games/core/testing'
import HostView from '@/games/elimination/HostView'
import { DEFAULT_TASKS, EliminationGame, type EliminationConfig, type EliminationState } from '@/games/elimination/logic'
import type { Player } from '@/lib/types'

const game = new EliminationGame()
const config: EliminationConfig = { tasks: DEFAULT_TASKS, pointsPerTag: 1, pointsPerCatch: 1 }
const whistle = 'Get someone to whistle'

async function html(state: EliminationState, players: Player[]): Promise<string> {
  const errors: unknown[] = []
  const view = createElement(HostView as ComponentType<never>, { players, state } as never)
  const { prelude } = await prerender(view, { onError: (error) => void errors.push(error) })
  if (errors.length > 0) throw errors[0]
  // React marks the seams between adjacent text parts with empty comments.
  return (await new Response(prelude).text()).replaceAll('<!-- -->', '')
}

const asPlayers = (ids: string[]): Player[] => ids.map((id) => ({ id, name: id, code: id.toUpperCase(), profile: {}, created_at: 0 }))

function move(state: EliminationState, ids: string[], by: string, type: 'tag' | 'catch', target: string, seed: number) {
  return game.handleAction(state, { type, target }, by, createGameContext(testInfo(config, ids), seededRandom(seed)).ctx)
}

describe('the host view of Last one standing', () => {
  it('hides a knockout task while someone still holds the same one, and shows it once nobody does', async () => {
    const ids = ['mads', 'bo', 'lea', 'kim']
    let state: EliminationState = {
      tasks: { mads: whistle, bo: 'Get someone to hum a tune', lea: whistle, kim: 'Get someone to give you a high five' },
      playerIds: ids,
      knockouts: [],
    }
    // Mads tags Bo with the task Lea also holds: the room's feed hides it, and so does the host's list.
    state = move(state, ids, 'mads', 'tag', 'bo', 1)
    expect(game.publicState(state, testInfo(config, ids)).feed[0].task).toBeNull()
    const hidden = await html(state, asPlayers(ids))
    expect(hidden).toContain('Show tasks')
    expect(hidden).toContain('mads tagged bo')
    expect(hidden).not.toContain(whistle)
    // Kim catches Lea trying it: nobody holds it any more, so both knockouts show it.
    state = move(state, ids, 'kim', 'catch', 'lea', 2)
    expect(game.publicState(state, testInfo(config, ids)).feed.map((k) => k.task)).toEqual([whistle, whistle])
    expect(await html(state, asPlayers(ids))).toContain(whistle)
  })

  it("hides the tagger's own current task when the tagger and the target were dealt the same one", async () => {
    const ids = ['mads', 'bo', 'kim']
    const dealt: EliminationState = {
      tasks: { mads: whistle, bo: whistle, kim: 'Get someone to hum a tune' },
      playerIds: ids,
      knockouts: [],
    }
    const state = move(dealt, ids, 'mads', 'tag', 'bo', 1)
    expect(state.tasks.mads).toBe(whistle)
    expect(await html(state, asPlayers(ids))).not.toContain(whistle)
  })

  it('still shows a spent task with Show tasks off', async () => {
    const ids = ['mads', 'bo', 'kim']
    const dealt: EliminationState = {
      tasks: { mads: whistle, bo: 'Get someone to hum a tune', kim: 'Get someone to give you a high five' },
      playerIds: ids,
      knockouts: [],
    }
    // Bo's task becomes Mads's, and nobody holds the whistle any more.
    const state = move(dealt, ids, 'mads', 'tag', 'bo', 1)
    expect(Object.values(state.tasks)).not.toContain(whistle)
    expect(await html(state, asPlayers(ids))).toContain(whistle)
  })
})
