import { describe, expect, it } from 'vitest'
import { createGameContext } from '../core/context'
import { GameError } from '../core/Game'
import { seededRandom, testInfo } from '../core/testing'
import { EliminationGame, type EliminationConfig, type EliminationState, type Method } from './logic'

const game = new EliminationGame()
const config: EliminationConfig = {
  tasks: ['sing', 'dance', 'ribbit', 'high five'],
  pointsPerTag: 1,
  pointsPerCatch: 1,
}

function start(players = ['ana', 'bo', 'cy', 'dee'], overrides = {}) {
  const info = testInfo(config, players, overrides)
  const { ctx, effects } = createGameContext(info, seededRandom())
  return { info, state: game.setup(ctx), effects }
}

function act(state: EliminationState, method: Method, by: string, target: string, overrides = {}) {
  const info = testInfo(config, state.playerIds, overrides)
  const { ctx, effects } = createGameContext(info, seededRandom())
  return { info, state: game.handleAction(state, game.parseAction({ type: method, target }), by, ctx), effects }
}

const tag = (state: EliminationState, by: string, target: string, overrides = {}) =>
  act(state, 'tag', by, target, overrides)
const katch = (state: EliminationState, by: string, target: string, overrides = {}) =>
  act(state, 'catch', by, target, overrides)

describe('setup', () => {
  it('deals every player a different task and one life', () => {
    const { state, effects } = start()
    expect(Object.keys(state.tasks).sort()).toEqual(['ana', 'bo', 'cy', 'dee'])
    expect(new Set(Object.values(state.tasks)).size).toBe(4)
    expect(effects.announcements).toHaveLength(1)
  })

  it('repeats tasks when there are more players than tasks', () => {
    const { state } = start(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(Object.values(state.tasks).every((task) => config.tasks.includes(task))).toBe(true)
  })

  it('needs two players and at least one task', () => {
    expect(() => start(['solo'])).toThrow(GameError)
    const info = testInfo({ ...config, tasks: [' '] }, ['a', 'b'])
    expect(() => game.setup(createGameContext(info).ctx)).toThrow('Add at least one task')
  })
})

describe('tagging (they did your task)', () => {
  it('knocks the target out and hands their task to the tagger', () => {
    const { state } = start()
    const { state: next, effects } = tag(state, 'ana', 'bo')

    expect(next.tasks.ana).toBe(state.tasks.bo)
    expect(next.tasks).not.toHaveProperty('bo')
    expect(next.knockouts).toEqual([{ by: 'ana', target: 'bo', method: 'tag', task: state.tasks.ana, at: 1_000 }])
    expect(effects.profiles).toEqual({ ana: { tags: 1 } })
    expect(effects.announcements[0]).toMatchObject({ icon: 'sword', sound: 'slash' })
    expect(effects.announcements[0]).toMatchObject({ message: 'ana got bo', detail: `“${state.tasks.ana}”` })
    expect(effects.announcements[0].to).toBeUndefined()
    // The two players involved each get their own moment, with a sound on their phone.
    expect(effects.announcements.slice(1)).toEqual([
      expect.objectContaining({ to: ['ana'], sound: 'coin' }),
      expect.objectContaining({ to: ['bo'], sound: 'sad', icon: 'skull' }),
    ])
  })

  it('adds to tags from earlier rounds on the profile', () => {
    const { state } = start()
    const players = ['ana', 'bo', 'cy', 'dee'].map((id) => ({
      id,
      name: id,
      profile: id === 'ana' ? { elimination: { tags: 2 } } : {},
    }))
    expect(tag(state, 'ana', 'bo', { players }).effects.profiles.ana).toEqual({ tags: 3 })
  })
})

describe('catching (they tried their task on you)', () => {
  it('knocks the target out while the catcher keeps their own task', () => {
    const { state } = start()
    const { state: next, effects } = katch(state, 'cy', 'dee')

    expect(next.tasks.cy).toBe(state.tasks.cy)
    expect(next.tasks).not.toHaveProperty('dee')
    expect(next.knockouts).toEqual([{ by: 'cy', target: 'dee', method: 'catch', task: state.tasks.dee, at: 1_000 }])
    expect(effects.profiles).toEqual({ cy: { catches: 1 } })
    expect(effects.announcements[0]).toMatchObject({
      message: 'cy caught dee',
      detail: `Trying “${state.tasks.dee}”`,
      icon: 'detective',
      sound: 'gotcha',
    })
    expect(effects.announcements.map((a) => a.to)).toEqual([undefined, ['cy'], ['dee']])
  })

  it('tells the caught player what happened', () => {
    const { state } = start()
    const { state: next } = katch(state, 'cy', 'dee')
    expect(game.playerView(next, 'dee')).toEqual({
      status: 'out',
      by: 'cy',
      method: 'catch',
      task: state.tasks.dee,
      knockouts: 0,
    })
  })
})

describe('scoring', () => {
  it('scores tags and catches with their own points', () => {
    const { state } = start()
    const after = katch(tag(state, 'ana', 'bo').state, 'ana', 'cy')
    expect(game.scores(after.state, after.info)).toEqual({ ana: 2 })
    const custom = testInfo({ ...config, pointsPerTag: 3, pointsPerCatch: 5 }, state.playerIds)
    expect(game.scores(after.state, custom)).toEqual({ ana: 8 })
  })
})

describe('rules', () => {
  it('rejects moves that break them', () => {
    const { state } = start()
    const afterBo = tag(state, 'ana', 'bo').state
    expect(() => tag(state, 'ana', 'ana')).toThrow("That's your own code")
    expect(() => katch(afterBo, 'cy', 'bo')).toThrow('bo is already out')
    expect(() => katch(afterBo, 'bo', 'cy')).toThrow("You're out")
    const withLatecomer = { ...state, playerIds: state.playerIds }
    expect(() =>
      act(withLatecomer, 'tag', 'late', 'ana', { players: [{ id: 'late', name: 'late', profile: {} }] }),
    ).toThrow('You joined after this game started')
    expect(() => game.parseAction({ type: 'steal' })).toThrow(GameError)
  })

  it('crowns the last one standing, whichever way they got there', () => {
    const { state } = start(['ana', 'bo'])
    const { state: end, effects } = katch(state, 'bo', 'ana')

    expect(game.publicState(end).winner).toBe('bo')
    expect(game.playerView(end, 'bo')).toEqual({ status: 'winner', knockouts: 1 })
    expect(effects.profiles.bo).toEqual({ catches: 1, wins: 1 })
    expect(effects.announcements.at(-2)).toMatchObject({ sound: 'fanfare', icon: 'crown' })
    expect(effects.announcements.at(-2)?.message).toContain('last one standing')
    expect(effects.announcements.at(-1)?.to).toEqual(['bo'])
    expect(() => tag(end, 'bo', 'ana')).toThrow('The game is over')
  })
})

describe('ending', () => {
  it('announces how it stood when the host ends it early', () => {
    const { state } = start()
    const info = testInfo(config, state.playerIds)
    const { ctx, effects } = createGameContext(info, seededRandom())
    expect(game.onEnd(state, ctx)).toBe(state)
    expect(effects.announcements).toEqual([
      expect.objectContaining({ message: 'Last one standing is over', detail: '4 still standing' }),
    ])
  })

  it('stays quiet when there is already a winner', () => {
    const { state } = start(['ana', 'bo'])
    const end = tag(state, 'ana', 'bo').state
    const { ctx, effects } = createGameContext(testInfo(config, end.playerIds), seededRandom())
    game.onEnd(end, ctx)
    expect(effects.announcements).toEqual([])
  })
})

describe('what players and the TV can see', () => {
  it('only ever shows a player their own live task', () => {
    const { state } = start(['ana', 'bo', 'cy', 'dee', 'eve'])
    const { state: next } = katch(tag(state, 'ana', 'bo').state, 'cy', 'dee')
    const liveTasks = Object.entries(next.tasks)

    // Everyone sees the public state (it's on the TV): no live task may be in it.
    const publicJson = JSON.stringify(game.publicState(next))
    for (const [, task] of liveTasks) expect(publicJson).not.toContain(task)

    // A player who is out may see the task that got them (they just lived through
    // it), even if someone else still holds the same one; nothing else.
    for (const id of next.playerIds) {
      const json = JSON.stringify(game.playerView(next, id))
      const theirKnockout = next.knockouts.find((k) => k.target === id)?.task
      for (const [owner, task] of liveTasks) {
        if (owner !== id && task !== theirKnockout) expect(json).not.toContain(task)
      }
    }
  })

  it('never puts a task in a personal announcement', () => {
    const { state } = start()
    const tasks = new Set(Object.values(state.tasks))
    const personal = [tag(state, 'ana', 'bo'), katch(state, 'cy', 'dee')]
      .flatMap(({ effects }) => effects.announcements)
      .filter((a) => a.to)
    expect(personal.length).toBeGreaterThan(0)
    for (const a of personal) for (const task of tasks) expect(`${a.message} ${a.detail ?? ''}`).not.toContain(task)
  })

  it('keeps a shared task out of announcements while someone still holds it', () => {
    // Six players, four tasks: some tasks are dealt twice.
    const { state } = start(['a', 'b', 'c', 'd', 'e', 'f'])
    const [first, second] = Object.entries(state.tasks).filter(
      ([, task], _, all) => all.filter(([, t]) => t === task).length > 1,
    )
    const catcher = state.playerIds.find((id) => id !== first[0] && id !== second[0])!
    const { state: next, effects } = katch(state, catcher, first[0])
    expect(effects.announcements[0]).toMatchObject({ message: `${catcher} caught ${first[0]}`, detail: 'Caught in the act' })
    expect(game.publicState(next).feed[0].task).toBeNull()
  })

  it('gives the TV who is left, who got whom and the top hunters', () => {
    const { state } = start()
    const { state: next } = katch(tag(state, 'ana', 'bo').state, 'ana', 'cy')
    const view = game.publicState(next)
    expect(view.alive.sort()).toEqual(['ana', 'dee'])
    expect(view.out.sort()).toEqual(['bo', 'cy'])
    expect(view.outBy).toEqual({ bo: { by: 'ana', method: 'tag' }, cy: { by: 'ana', method: 'catch' } })
    expect(view.knockoutCounts).toEqual({ ana: 2 })
  })

  it('shows latecomers as spectators', () => {
    expect(game.playerView(start().state, 'newcomer')).toEqual({ status: 'spectator' })
  })
})
