import { describe, expect, it } from 'vitest'
import { botExample, botSight, checkGameContract, type ContractExample } from '../core/contract'
import { createGameContext } from '../core/context'
import { GameError, type GamePlayer, type RecapRound } from '../core/Game'
import { ProbeGame } from '../core/probe'
import { simulateParty, type FakeParty } from '../core/simulate'
import { jsonbRoundTrip, seededRandom, testInfo } from '../core/testing'
import { bot, KNOCKOUT_CHANCE } from './bot'
import {
  DEFAULT_TASKS,
  EliminationGame,
  standing,
  winnerOf,
  type EliminationConfig,
  type EliminationPlayerView,
  type EliminationPublicState,
  type EliminationState,
  type Method,
} from './logic'

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

/** Info for a state with these players in the party (default: everyone dealt in). */
const infoFor = (state: EliminationState, present: string[] = state.playerIds) => testInfo(config, present)

/** A context as the engine runs member hooks: actor system, the party as it is now. */
function systemContext(present: string[]) {
  return createGameContext(testInfo(config, present), seededRandom(), { actor: { kind: 'system' } })
}

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

  it('runs in the background beside the game on the TV', () => {
    expect(game.presentation).toBe('background')
  })
})

describe('settings', () => {
  it('cleans the tasks and keeps only its own settings', () => {
    expect(game.parseConfig({ tasks: ['  sing ', '', ' ', 'dance'], pointsPerTag: 2, pointsPerCatch: 0, extra: 1 })).toEqual({
      tasks: ['sing', 'dance'],
      pointsPerTag: 2,
      pointsPerCatch: 0,
    })
    expect(game.parseConfig({ ...game.defaultConfig })).toEqual(game.defaultConfig)
  })

  it('takes up to 200 tasks of up to 200 characters, counting an emoji as one', () => {
    const tasks = Array.from({ length: 200 }, (_, i) => `Get someone to say ${i}`)
    expect(game.parseConfig({ ...config, tasks }).tasks).toHaveLength(200)
    // A guest's emoji: 400 UTF-16 units, 200 characters as Postgres counts them.
    const emoji = '\u{1F389}'.repeat(200)
    expect(game.parseConfig({ ...config, tasks: [emoji] }).tasks).toEqual([emoji])
  })

  it("refuses settings it can't play, with words the host can act on", () => {
    const refuses = (input: Record<string, unknown>, message: string) => {
      expect(() => game.parseConfig({ ...config, ...input }), JSON.stringify(input).slice(0, 60)).toThrow(GameError)
      expect(() => game.parseConfig({ ...config, ...input })).toThrow(message)
    }
    refuses({ tasks: [] }, 'Add at least one task in the settings')
    refuses({ tasks: ['  ', ''] }, 'Add at least one task in the settings')
    refuses({ tasks: 'sing' }, 'The tasks must be a list of texts')
    refuses({ tasks: ['sing', 3] }, 'The tasks must be a list of texts')
    refuses({ tasks: Array.from({ length: 201 }, (_, i) => `task ${i}`) }, 'Use at most 200 tasks (there are 201)')
    // Numbered as the settings list shows them, empty rows included.
    refuses({ tasks: ['sing', '', 'x'.repeat(201)] }, 'Task 3 is longer than 200 characters')
    for (const points of [1.5, -1, 101, '2', null, undefined]) {
      refuses({ pointsPerTag: points }, 'Points per tag must be a whole number from 0 to 100')
      refuses({ pointsPerCatch: points }, 'Points per catch must be a whole number from 0 to 100')
    }
  })

  it('ships default settings the game accepts', () => {
    expect(game.parseConfig(jsonbRoundTrip({ ...game.defaultConfig }))).toEqual({
      tasks: DEFAULT_TASKS,
      pointsPerTag: 1,
      pointsPerCatch: 1,
    })
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
    const { state: next, info } = katch(state, 'cy', 'dee')
    expect(game.playerView(next, 'dee', info)).toEqual({
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
    expect(() => game.parseAction({ type: 'tag', target: '' })).toThrow(GameError)
    expect(() => game.parseAction({ type: 'tag', target: 'x'.repeat(101) })).toThrow(GameError)
  })

  it('crowns the last one standing, whichever way they got there', () => {
    const { state } = start(['ana', 'bo'])
    const { state: end, effects, info } = katch(state, 'bo', 'ana')

    expect(game.publicState(end, info).winner).toBe('bo')
    expect(game.playerView(end, 'bo', info)).toEqual({ status: 'winner', knockouts: 1 })
    expect(effects.profiles.bo).toEqual({ catches: 1, wins: 1 })
    expect(effects.announcements.at(-2)).toMatchObject({ sound: 'fanfare', icon: 'crown' })
    expect(effects.announcements.at(-2)?.message).toContain('last one standing')
    expect(effects.announcements.at(-1)?.to).toEqual(['bo'])
    expect(() => tag(end, 'bo', 'ana')).toThrow('The game is over')
  })

  it('refuses a knockout of someone who left the party', () => {
    const { state } = start()
    // bo was removed: the party no longer has him (or his name).
    const present = { players: ['ana', 'cy', 'dee'].map((id) => ({ id, name: id, profile: {} })) }
    expect(() => tag(state, 'ana', 'bo', present)).toThrow('That player left the party')
    expect(() => tag(state, 'ana', 'stranger')).toThrow("That code isn't from this party")
  })
})

describe('the winner moment', () => {
  it("banners the winner on the TV even while another game holds the stage, and nothing else", () => {
    const { state } = start(['ana', 'bo', 'cy'])
    const first = tag(state, 'ana', 'bo')
    expect(first.effects.announcements.some((a) => a.interrupt)).toBe(false)
    const { effects } = katch(first.state, 'ana', 'cy')
    expect(effects.announcements.filter((a) => a.interrupt)).toEqual([
      { message: 'ana is the last one standing!', detail: '2 knockouts', icon: 'crown', sound: 'fanfare', interrupt: true },
    ])
    // The winner's own moment is theirs alone (the TV never shows targeted ones).
    expect(effects.announcements.at(-1)).toEqual({
      message: "You're the last one standing!",
      detail: '2 knockouts',
      to: ['ana'],
      icon: 'crown',
      sound: 'fanfare',
    })
  })
})

describe('players who leave the party', () => {
  it("drops a standing player's task and the round goes on", () => {
    const { state } = start()
    const { ctx, effects } = systemContext(['ana', 'cy', 'dee'])
    const next = game.onPlayerLeave(state, 'bo', ctx)
    expect(next.tasks).not.toHaveProperty('bo')
    expect(next.playerIds).toEqual(state.playerIds)
    expect(effects.announcements).toEqual([])
    expect(game.isFinished(next, testInfo(config, ['ana', 'cy', 'dee']))).toBe(false)
    expect(standing(next, testInfo(config, ['ana', 'cy', 'dee']))).toEqual(['ana', 'cy', 'dee'])
  })

  it('only marks a player already out as gone, and changes nothing for one never dealt in', () => {
    const { state } = start()
    const afterBo = tag(state, 'ana', 'bo').state
    const { ctx, effects } = systemContext(['ana', 'cy', 'dee'])
    expect(game.onPlayerLeave(afterBo, 'bo', ctx)).toEqual({ ...afterBo, left: ['bo'] })
    expect(game.onPlayerLeave(afterBo, 'latecomer', ctx)).toBe(afterBo)
    expect(effects).toMatchObject({ announcements: [], profiles: {} })
  })

  it('crowns the last one standing when a removal leaves one', () => {
    const { state } = start(['ana', 'bo', 'cy'])
    const afterBo = tag(state, 'ana', 'bo').state
    const { ctx, effects } = systemContext(['ana', 'bo'])
    const next = game.onPlayerLeave(afterBo, 'cy', ctx)
    expect(next.tasks).toEqual({ ana: afterBo.tasks.ana })
    expect(effects.profiles).toEqual({ ana: { wins: 1 } })
    expect(effects.announcements).toEqual([
      expect.objectContaining({ message: 'ana is the last one standing!', icon: 'crown', sound: 'fanfare', interrupt: true }),
      expect.objectContaining({ message: "You're the last one standing!", to: ['ana'] }),
    ])
    const info = testInfo(config, ['ana', 'bo'])
    expect(game.isFinished(next, info)).toBe(true)
    expect(game.winners(next, info)).toEqual(['ana'])
  })

  it('crowns once when several leave at the same time', () => {
    const { state } = start(['ana', 'bo', 'cy'])
    // Both left before the next save: the engine runs the hook once per leaver,
    // with the party as it is now (ana alone) in both.
    const { ctx, effects } = systemContext(['ana'])
    const next = game.onPlayerLeave(game.onPlayerLeave(state, 'bo', ctx), 'cy', ctx)
    expect(next.tasks).toEqual({ ana: state.tasks.ana })
    expect(effects.announcements.filter((a) => a.message === 'ana is the last one standing!')).toHaveLength(1)
    expect(effects.profiles).toEqual({ ana: { wins: 1 } })
  })

  it('counts only players still in the party as standing', () => {
    const { state } = start()
    // bo left, and his task is still in the state (as if his hook never ran).
    const info = testInfo(config, ['ana', 'cy', 'dee'])
    expect(standing(state, info)).toEqual(['ana', 'cy', 'dee'])
    expect(game.publicState(state, info).alive).toEqual(['ana', 'cy', 'dee'])
    expect(game.publicState(state, info).out).toEqual(['bo'])
    const afterCy = katch(state, 'ana', 'cy', info).state
    expect(winnerOf(afterCy, info)).toBeNull()
    const afterDee = katch(afterCy, 'ana', 'dee', info)
    expect(winnerOf(afterDee.state, info)).toBe('ana')
    expect(afterDee.effects.announcements.some((a) => a.message === 'ana is the last one standing!')).toBe(true)
  })
})

describe('finishing', () => {
  it('is finished once one is left standing, out of more than one dealt in', () => {
    const { state, info } = start()
    expect(game.isFinished(state, info)).toBe(false)
    const end = katch(tag(tag(state, 'ana', 'bo').state, 'ana', 'cy').state, 'ana', 'dee')
    expect(game.isFinished(end.state, end.info)).toBe(true)
    expect(game.winners(end.state, end.info)).toEqual(['ana'])
    expect(game.winners(state, info)).toEqual([])
    // A deal of one (never started like this) is not a win.
    const solo: EliminationState = { tasks: { ana: 'sing' }, playerIds: ['ana'], knockouts: [] }
    expect(game.isFinished(solo, testInfo(config, ['ana']))).toBe(false)
  })

  it('stays quiet when the game finished itself: the winning move already said it', () => {
    const { state } = start(['ana', 'bo'])
    const end = tag(state, 'ana', 'bo').state
    const { ctx, effects } = createGameContext(testInfo(config, end.playerIds), seededRandom())
    expect(game.onEnd(end, ctx, 'game')).toBe(end)
    expect(effects.announcements).toEqual([])
  })
})

describe('ending', () => {
  it('announces how it stood when the host ends it early', () => {
    const { state } = start()
    const info = testInfo(config, state.playerIds)
    const { ctx, effects } = createGameContext(info, seededRandom())
    expect(game.onEnd(state, ctx, 'host')).toBe(state)
    expect(effects.announcements).toEqual([
      expect.objectContaining({ message: 'Last one standing is over', detail: '4 still standing' }),
    ])
  })

  it('counts only players still in the party when the host ends it', () => {
    const { state } = start()
    const { ctx, effects } = createGameContext(testInfo(config, ['ana', 'cy', 'dee']), seededRandom())
    game.onEnd(state, ctx, 'host')
    expect(effects.announcements[0]).toMatchObject({ detail: '3 still standing', sound: 'gong', icon: 'trophy' })
  })

  it('stays quiet when there is already a winner', () => {
    const { state } = start(['ana', 'bo'])
    const end = tag(state, 'ana', 'bo').state
    const { ctx, effects } = createGameContext(testInfo(config, end.playerIds), seededRandom())
    game.onEnd(end, ctx, 'host')
    expect(effects.announcements).toEqual([])
  })
})

describe('what players and the TV can see', () => {
  it('only ever shows a player their own live task', () => {
    const { state } = start(['ana', 'bo', 'cy', 'dee', 'eve'])
    const { state: next } = katch(tag(state, 'ana', 'bo').state, 'cy', 'dee')
    const liveTasks = Object.entries(next.tasks)
    const info = infoFor(next)

    // Everyone sees the public state (it's on the TV): no live task may be in it.
    const publicJson = JSON.stringify(game.publicState(next, info))
    for (const [, task] of liveTasks) expect(publicJson).not.toContain(task)

    // A player who is out may see the task that got them (they just lived through
    // it), even if someone else still holds the same one; nothing else.
    for (const id of next.playerIds) {
      const json = JSON.stringify(game.playerView(next, id, info))
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
    expect(game.publicState(next, infoFor(next)).feed[0].task).toBeNull()
  })

  it('gives the TV who is left, who got whom and the top hunters', () => {
    const { state } = start()
    const { state: next } = katch(tag(state, 'ana', 'bo').state, 'ana', 'cy')
    const view = game.publicState(next, infoFor(next))
    expect(view.alive.sort()).toEqual(['ana', 'dee'])
    expect(view.out.sort()).toEqual(['bo', 'cy'])
    expect(view.outBy).toEqual({ bo: { by: 'ana', method: 'tag' }, cy: { by: 'ana', method: 'catch' } })
    expect(view.knockoutCounts).toEqual({ ana: 2 })
  })

  it('shows latecomers as spectators', () => {
    const { state, info } = start()
    expect(game.playerView(state, 'newcomer', info)).toEqual({ status: 'spectator' })
  })

  it('keeps who is standing in deal order after a jsonb round trip', () => {
    // jsonb stores object keys shortest first, then bytewise: not the deal order.
    const players = ['zed', 'amy', 'bob-longer', 'c', 'dee']
    const { state } = start(players)
    const stored = jsonbRoundTrip(state)
    expect(Object.keys(stored.tasks)).not.toEqual(players)
    const info = testInfo(config, players)
    expect(game.publicState(stored, info).alive).toEqual(players)
    const afterAmy = jsonbRoundTrip(tag(stored, 'zed', 'amy', { players: info.players }).state)
    expect(game.publicState(afterAmy, info)).toMatchObject({
      alive: ['zed', 'bob-longer', 'c', 'dee'],
      out: ['amy'],
    })
  })
})

describe('recap', () => {
  const names = { ana: 'Ana', bo: 'Bo', cy: 'Cy', dee: 'Dee', eve: 'Eve' }
  const min = 60_000

  function round(state: EliminationState, overrides: Partial<RecapRound<EliminationState, EliminationConfig>> = {}) {
    return {
      gameId: 'g',
      title: 'Last one standing',
      round: 1,
      finished: true,
      startedAt: 0,
      finishedAt: 40 * min,
      finishedBy: 'game',
      config,
      state,
      winners: [],
      players: Object.entries(names).map(([id, name]) => ({ id, name })),
      points: {},
      log: [],
      ...overrides,
    } satisfies RecapRound<EliminationState, EliminationConfig>
  }

  // Ana tags Bo with "sing" (and takes his "dance"); Cy catches Dee trying "sing"
  // (dealt twice); Ana catches Eve trying "ribbit"; Ana tags Cy with "dance" and
  // takes his "high five", the one task left in play.
  const won: EliminationState = {
    tasks: { ana: 'high five' },
    playerIds: ['ana', 'bo', 'cy', 'dee', 'eve'],
    knockouts: [
      { by: 'ana', target: 'bo', method: 'tag', task: 'sing', at: 12 * min + 5_000 },
      { by: 'cy', target: 'dee', method: 'catch', task: 'sing', at: 20 * min },
      { by: 'ana', target: 'eve', method: 'catch', task: 'ribbit', at: 25 * min },
      { by: 'ana', target: 'cy', method: 'tag', task: 'dance', at: 30 * min },
    ],
  }

  it('tells nothing about a round still running', () => {
    expect(game.recap(round(won, { finished: false, finishedAt: null, finishedBy: null }))).toEqual([])
  })

  it('tells the story of a round the game finished', () => {
    expect(game.recap(round(won, { winners: ['ana'] }))).toEqual([
      {
        title: 'Ana was the last one standing',
        detail: '3 knockouts',
        players: ['ana'],
        icon: 'crown',
        tone: 'gold',
        weight: 'headline',
      },
      { title: 'Top hunter: Ana', detail: '3 knockouts', players: ['ana'], icon: 'sword', tone: 'pink', weight: 'highlight' },
      {
        title: 'First out: Bo',
        detail: 'Ana got them 12 minutes in',
        players: ['bo', 'ana'],
        at: 12 * min + 5_000,
        icon: 'skull',
        tone: 'red',
        weight: 'line',
      },
      { title: 'Deadliest task', detail: '“sing” knocked out 2 players', icon: 'target', tone: 'violet', weight: 'line' },
    ])
  })

  it('names nobody as the winner of a round the host ended, and no task still in play', () => {
    // Cy catches Bo and then Dee, both trying "sing", which Ana still holds at the end.
    const ended: EliminationState = {
      tasks: { ana: 'sing', cy: 'dance' },
      playerIds: ['ana', 'bo', 'cy', 'dee'],
      knockouts: [
        { by: 'cy', target: 'bo', method: 'catch', task: 'sing', at: 30_000 },
        { by: 'cy', target: 'dee', method: 'catch', task: 'sing', at: 5 * min },
      ],
    }
    const highlights = game.recap(round(ended, { finishedBy: 'host', winners: [] }))
    expect(highlights.map((h) => h.title)).toEqual(['2 still standing when it ended', 'Top hunter: Cy', 'First out: Bo'])
    expect(highlights[0]).toMatchObject({ detail: 'Ana and Cy', players: ['ana', 'cy'] })
    expect(highlights[2].detail).toBe('Cy caught them in the first minute')
    const json = JSON.stringify(highlights)
    for (const live of Object.values(ended.tasks)) expect(json).not.toContain(live)
  })

  it('names tied top hunters together, in the order they first scored', () => {
    const tied: EliminationState = {
      tasks: { cy: 'x' },
      playerIds: ['ana', 'bo', 'cy', 'dee'],
      knockouts: [
        { by: 'cy', target: 'dee', method: 'catch', task: 'a', at: 1 },
        { by: 'ana', target: 'bo', method: 'catch', task: 'b', at: 2 },
        { by: 'cy', target: 'ana', method: 'catch', task: 'c', at: 3 },
      ],
    }
    const highlights = game.recap(round(tied, { winners: ['cy'] }))
    expect(highlights[1]).toMatchObject({ title: 'Top hunter: Cy', detail: '2 knockouts' })
    const even = { ...tied, knockouts: tied.knockouts.slice(0, 2), tasks: { cy: 'x', ana: 'y' } }
    expect(game.recap(round(even, { finishedBy: 'host' }))[1]).toMatchObject({
      title: 'Top hunters: Cy and Ana',
      detail: '1 knockout each',
      players: ['cy', 'ana'],
    })
  })

  it('names a player who left the party by the name they had', () => {
    const highlights = game.recap(round(won, { winners: ['ana'], players: [{ id: 'ana', name: 'Ana' }] }))
    expect(highlights[2].title).toBe('First out: Someone')
    expect(game.recap(round(won, { winners: ['ana'] }))[2].title).toBe('First out: Bo')
  })

  it("survives a state it doesn't recognise", () => {
    expect(game.recap(round(null as unknown as EliminationState))).toEqual([])
  })
})

/** A party with Last one standing (and a stage game to share the TV with). */
function party(players: number, settings: Record<string, unknown> = { tasks: ['sing', 'dance', 'ribbit', 'hum'] }) {
  const p = simulateParty({ games: [game, new ProbeGame()], players })
  p.addGame('g', 'elimination', 'Last one standing', settings)
  return p
}

function knock(p: FakeParty, by: GamePlayer, target: GamePlayer, type: Method = 'tag') {
  return p.send(p.userOf(by.id), { type: 'action', gameId: 'g', action: { type, target: target.id } })
}

const viewOf = (p: FakeParty, player: GamePlayer) => p.game('g').views[player.id] as EliminationPlayerView
const publicOf = (p: FakeParty) => p.game('g').publicState as EliminationPublicState
const lastOneStanding = (p: FakeParty) => p.feed.filter((f) => f.message.endsWith('is the last one standing!'))

describe('a round in a party', () => {
  it('starts in the background, finishes itself with the last knockout and takes the free stage', () => {
    const p = party(3)
    const [ana, bo, cy] = p.players
    expect(p.send(p.hostUser, { type: 'start', gameId: 'g' }).kind).toBe('commit')
    expect(p.spotlight).toBeNull()

    expect(knock(p, ana, bo).kind).toBe('commit')
    expect(p.game('g').status).toBe('active')
    expect(knock(p, ana, cy, 'catch').kind).toBe('commit')

    expect(p.game('g')).toMatchObject({ status: 'finished', finishedBy: 'game', winners: [ana.id] })
    expect(p.spotlight).toBe('g')
    expect(lastOneStanding(p)).toEqual([
      expect.objectContaining({ message: `${ana.name} is the last one standing!`, audience: null, interrupt: true }),
    ])
    // onEnd stayed quiet: the winning move said it all.
    expect(p.feed.some((f) => f.message === 'Last one standing is over')).toBe(false)
    expect(viewOf(p, ana)).toEqual({ status: 'winner', knockouts: 2 })
    expect(publicOf(p)).toMatchObject({ winner: ana.id, alive: [ana.id] })
    expect(p.log.find((row) => row.kind === 'game.finished')?.data).toMatchObject({ by: 'game', winners: [ana.id] })
    // A finished game takes no more moves.
    expect(knock(p, ana, bo)).toMatchObject({ kind: 'refuse', status: 409, code: 'not_running' })
  })

  it('finishes with one left when the host removes a player', () => {
    const p = party(3)
    const [ana, bo, cy] = p.players
    p.send(p.hostUser, { type: 'start', gameId: 'g' })
    knock(p, ana, bo)
    p.removePlayer(cy.id)
    // The host page syncs every live game right after a removal.
    expect(p.sync('g').kind).toBe('commit')

    expect(p.game('g')).toMatchObject({ status: 'finished', finishedBy: 'game', winners: [ana.id] })
    expect((p.stateOf('g')!.state as EliminationState).tasks).not.toHaveProperty(cy.id)
    expect(lastOneStanding(p)).toEqual([expect.objectContaining({ interrupt: true, sound: 'fanfare' })])
    expect(p.feed.find((f) => f.message === "You're the last one standing!")?.audience).toEqual([ana.id])
    expect(p.players.find((pl) => pl.id === ana.id)?.profile.elimination).toEqual({ tags: 1, wins: 1 })
  })

  it('drops a removed player and crowns the last one standing once, later', () => {
    const p = party(4)
    const [ana, bo, cy, dee] = p.players
    p.send(p.hostUser, { type: 'start', gameId: 'g' })
    p.removePlayer(dee.id)
    p.sync('g')
    expect(p.game('g').status).toBe('active')
    expect(publicOf(p)).toMatchObject({ alive: [ana.id, bo.id, cy.id], out: [] })
    expect(knock(p, ana, dee)).toMatchObject({ kind: 'refuse', status: 400, message: 'That player left the party' })

    knock(p, bo, ana, 'catch')
    knock(p, bo, cy)
    expect(p.game('g')).toMatchObject({ status: 'finished', finishedBy: 'game', winners: [bo.id] })
    expect(lastOneStanding(p)).toHaveLength(1)
  })

  it('gives a freed name taken again nothing from the round: no task, no Out, no knockouts', () => {
    const p = party(3)
    const zelda = p.listGuest('Zelda')
    p.claimGuest(zelda.id)
    const [ana] = p.players
    p.send(p.hostUser, { type: 'start', gameId: 'g' })
    knock(p, zelda, ana)
    expect(p.game('g').scores).toEqual({ [zelda.id]: 1 })
    p.tick(1000)
    p.freeGuest(zelda.id)
    p.sync('g')
    expect(p.game('g').scores).toEqual({})
    expect(publicOf(p).out).toEqual([ana.id])
    p.tick(1000)
    p.claimGuest(zelda.id)
    p.sync('g')
    expect(viewOf(p, zelda)).toEqual({ status: 'spectator' })
    expect(publicOf(p)).toMatchObject({ out: [ana.id], knockoutCounts: {} })
    expect(publicOf(p).outBy).not.toHaveProperty(zelda.id)
    expect(p.game('g').scores).toEqual({})
    expect(knock(p, zelda, p.players[1])).toMatchObject({ kind: 'refuse', message: 'You joined after this game started' })
  })

  it('lets a freed name that was out be taken again without the Out', () => {
    const p = party(3)
    const zelda = p.listGuest('Zelda')
    p.claimGuest(zelda.id)
    const [ana] = p.players
    p.send(p.hostUser, { type: 'start', gameId: 'g' })
    knock(p, ana, zelda, 'catch')
    p.tick(1000)
    p.freeGuest(zelda.id)
    p.tick(1000)
    p.claimGuest(zelda.id)
    p.sync('g')
    expect(publicOf(p).out).toEqual([])
    expect(publicOf(p).outBy).not.toHaveProperty(zelda.id)
    expect(viewOf(p, zelda)).toEqual({ status: 'spectator' })
    expect(p.game('g').scores).toEqual({ [ana.id]: 1 })
  })

  it("lets a joiner watch, and doesn't deal them in", () => {
    const p = party(3)
    p.send(p.hostUser, { type: 'start', gameId: 'g' })
    const late = p.addPlayer('Late')
    p.sync('g')
    expect(viewOf(p, late)).toEqual({ status: 'spectator' })
    expect(knock(p, late, p.players[0])).toMatchObject({ kind: 'refuse', message: 'You joined after this game started' })
  })

  it('says how it stood when the host ends it, and crowns nobody', () => {
    const p = party(4)
    const [ana, bo] = p.players
    p.send(p.hostUser, { type: 'start', gameId: 'g' })
    knock(p, ana, bo)
    p.send(p.hostUser, { type: 'end', gameId: 'g' })
    expect(p.game('g')).toMatchObject({ status: 'finished', finishedBy: 'host', winners: [] })
    expect(p.feed.at(-1)).toMatchObject({ message: 'Last one standing is over', detail: '3 still standing' })
  })

  it("leaves the TV to the game on the stage, start to finish", () => {
    const p = party(3)
    const [ana, bo, cy] = p.players
    p.addGame('quiz', 'probe', 'On the stage', { movesToWin: 50 })
    p.send(p.hostUser, { type: 'start', gameId: 'quiz' })
    p.send(p.hostUser, { type: 'start', gameId: 'g' })
    expect(p.spotlight).toBe('quiz')
    knock(p, ana, bo)
    knock(p, ana, cy)
    expect(p.game('g')).toMatchObject({ status: 'finished', finishedBy: 'game' })
    // The stage stays the quiz's: the winner reaches the TV as an interrupting banner instead.
    expect(p.spotlight).toBe('quiz')
    expect(lastOneStanding(p)[0]).toMatchObject({ interrupt: true })
  })

  it('can be started on the TV when the host asks for it', () => {
    const p = party(3)
    p.send(p.hostUser, { type: 'start', gameId: 'g', stage: true })
    expect(p.spotlight).toBe('g')
  })

  it('tells its story in the recap once it has finished', () => {
    const p = party(3)
    const [ana, bo, cy] = p.players
    p.send(p.hostUser, { type: 'start', gameId: 'g' })
    expect(game.recap(p.recapRounds('g')[0] as RecapRound<EliminationState, EliminationConfig>)).toEqual([])
    p.tick(7 * 60_000)
    knock(p, bo, cy)
    knock(p, bo, ana, 'catch')
    const [round] = p.recapRounds('g') as RecapRound<EliminationState, EliminationConfig>[]
    expect(round.finished).toBe(true)
    expect(game.recap(round).map((h) => h.title)).toEqual([
      `${bo.name} was the last one standing`,
      `Top hunter: ${bo.name}`,
      `First out: ${cy.name}`,
    ])
    expect(game.recap(round)[2].detail).toBe(`${bo.name} got them 7 minutes in`)
  })
})

describe('the contract', () => {
  it('keeps it over a round with knockouts, refusals, a join and a leave', () => {
    // simulateParty makes the same seeded player ids every time: these are the
    // ids checkGameContract's party will have, joiner included.
    const probe = simulateParty({ games: [game], players: 5 })
    const ids = [...probe.players.map((pl) => pl.id), probe.addPlayer('Guest 6').id]
    const example: ContractExample = {
      config: { tasks: ['sing', 'dance'], pointsPerTag: 2, pointsPerCatch: 3 },
      players: 5,
      steps: [
        { kind: 'action', player: 0, action: { type: 'tag', target: ids[1] } },
        { kind: 'action', player: 2, action: { type: 'catch', target: ids[3] } },
        { kind: 'action', player: 0, action: { type: 'tag', target: ids[0] } },
        { kind: 'join' },
        { kind: 'action', player: 5, action: { type: 'tag', target: ids[0] } },
        { kind: 'leave', player: 4 },
        { kind: 'action', player: 0, action: { type: 'tag', target: ids[4] } },
        { kind: 'tick', ms: 60_000 },
        { kind: 'sync' },
        { kind: 'action', player: 2, action: { type: 'tag', target: ids[0] } },
        { kind: 'action', player: 0, action: { type: 'catch', target: ids[2] } },
      ],
    }
    expect(checkGameContract(game, example)).toEqual([])
  })

  it('keeps it over a round its bot plays to the end', () => {
    const result = botExample(game, bot)
    if (!('example' in result)) throw new Error(result.refused)
    expect(result.example.steps.some((s) => s.kind === 'end')).toBe(false) // it finished by itself
    expect(checkGameContract(game, result.example)).toEqual([])
  })
})

describe('the rehearsal bot', () => {
  const sight = (view: EliminationPlayerView | null, random: number, alive = ['me', 'ana', 'bo']) => ({
    playerId: 'me',
    players: ['me', 'ana', 'bo'].map((id) => ({ id, name: id, code: id.toUpperCase() })),
    publicState: { alive, out: [], winner: null, outBy: {}, knockoutCounts: {}, feed: [] },
    view,
    prompts: [],
    myAnswers: {},
    now: 0,
    random: () => random,
  })
  const alive: EliminationPlayerView = { status: 'alive', task: 'sing', knockouts: 0 }

  it('only moves while standing, about once in 20 calls', () => {
    expect(bot.move(sight({ status: 'spectator' }, 0))).toBeNull()
    expect(bot.move(sight({ status: 'out', by: 'ana', method: 'tag', task: 'x', knockouts: 0 }, 0))).toBeNull()
    expect(bot.move(sight(null, 0))).toBeNull()
    expect(bot.move(sight(alive, KNOCKOUT_CHANCE))).toBeNull()
    expect(bot.move(sight(alive, 0))).toEqual({ kind: 'action', action: { type: 'tag', target: 'ana' } })
    expect(bot.move(sight(alive, KNOCKOUT_CHANCE - 0.001))).toMatchObject({ action: { type: 'tag' } })
    // Nobody else standing: nothing to do.
    expect(bot.move(sight(alive, 0, ['me']))).toBeNull()
    expect(bot.hostMove).toBeUndefined()
    expect(bot.settings).toBeUndefined()
  })

  it('plays a round to its end through simulateParty', () => {
    const p = simulateParty({ games: [game], players: 12 })
    p.addGame('g', 'elimination', 'Bot round')
    p.send(p.hostUser, { type: 'start', gameId: 'g' })
    const random = seededRandom(5)
    let moves = 0
    for (let second = 0; second < 600 && p.game('g').status === 'active'; second++) {
      for (const player of p.players) {
        if (p.game('g').status !== 'active') break
        const move = bot.move(botSight(p, 'g', player.id, random))
        if (move?.kind !== 'action') continue
        moves++
        // Every move it makes is one the game takes.
        expect(p.send(p.userOf(player.id), { type: 'action', gameId: 'g', action: move.action }).kind).toBe('commit')
      }
      p.tick(1000)
    }
    expect(moves).toBe(11)
    const result = p.game('g')
    expect(result).toMatchObject({ status: 'finished', finishedBy: 'game' })
    expect(result.winners).toHaveLength(1)
    expect(lastOneStanding(p)).toHaveLength(1)
  })
})
