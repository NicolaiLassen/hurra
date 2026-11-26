import { describe, expect, it, vi } from 'vitest'
import { gameBots } from './bots'
import { botExample, checkGameContract } from './core/contract'
import { GameError } from './core/Game'
import { jsonbRoundTrip } from './core/testing'
import { DEFAULT_TASKS } from './elimination/logic'
import { gameLogic } from './logic'
import { accentOf, gameModules, preloadTvScreens, setupStatusOf, startProblemOf } from './registry'
import type { GameModule } from './types'

/** What a placeholder module's setup says until its game lands (docs/engine-v2.md, 10.4). */
const NOT_READY = "This game isn't ready yet"

it('registers the five games, in order, with their logic, screens and bots', () => {
  expect([...gameLogic.keys()]).toEqual(['in-person', 'elimination', 'quiz', 'fusion', 'soundtrack'])
  expect(gameModules.map((m) => m.logic.type)).toEqual([...gameLogic.keys()])
  expect([...gameBots.keys()]).toEqual([...gameLogic.keys()])
  for (const m of gameModules) expect(m.logic.constructor, m.logic.type).toBe(gameLogic.get(m.logic.type)!.constructor)
})

it("gives only the hunt its pink accent, and nothing for a game the registry doesn't know", () => {
  expect(accentOf('elimination')).toBe('hunt')
  expect(gameModules.filter((m) => m.accent !== undefined).map((m) => m.logic.type)).toEqual(['elimination'])
  expect(accentOf('quiz')).toBeUndefined()
  expect(accentOf('no-such-game')).toBeUndefined()
  expect(accentOf(null)).toBeUndefined()
})

it('asks every game whether its settings are ready, on its defaults, and the in-person round always is', () => {
  const guests = [{ id: 'a', name: 'Ana', joined: true }]
  const lines = Object.fromEntries(gameModules.map((m) => [m.logic.type, setupStatusOf(m.logic.type, null, guests)]))
  expect(lines).toEqual({
    'in-person': { ready: true, line: 'Nothing to set up: you give the points as it plays' },
    elimination: { ready: true, line: `${DEFAULT_TASKS.length} tasks, enough for the one guest` },
    quiz: { ready: false, line: 'No questions yet' },
    fusion: { ready: false, line: 'No pictures yet' },
    soundtrack: { ready: false, line: 'No songs yet' },
  })
  // The saved settings go over the defaults, as the engine merges them at start.
  expect(setupStatusOf('elimination', { tasks: ['Get someone to wave'] }, [])).toEqual({ ready: true, line: '1 task to deal; the default list has 60' })
})

it('shows nothing for a game without the hook, a type it doesn’t know, or a hook that throws', () => {
  const [inPerson] = gameModules
  const without: GameModule = { ...inPerson, setupStatus: undefined }
  const throwing: GameModule = { ...inPerson, ConfigEditor: () => null, setupStatus: () => { throw new Error('unreadable') } }
  expect(setupStatusOf('in-person', null, [], [without])).toBeNull()
  expect(setupStatusOf('in-person', null, [], [throwing])).toBeNull()
  expect(setupStatusOf('no-such-game', null, [])).toBeNull()
  // Not ready, but with no settings to edit: there is nothing the host could set up.
  const stuck: GameModule = { ...inPerson, setupStatus: () => ({ ready: false, line: 'Waiting' }) }
  expect(setupStatusOf('in-person', null, [], [stuck])).toEqual({ ready: true, line: 'Waiting' })
})

it('says what the start would refuse in the game’s own words', () => {
  const quiz = gameModules.find((m) => m.logic.type === 'quiz')!
  expect(startProblemOf(quiz, { questions: [], seconds: 20, pointsPerRight: 1 })).toBe('Add at least one question in the settings')
  const fusion = gameModules.find((m) => m.logic.type === 'fusion')!
  // A picture without its people still starts: the host sets them on the night with Show who.
  expect(startProblemOf(fusion, { ...fusion.logic.defaultConfig as object, pictures: [{ label: '' }] })).toBeNull()
})

it("makes every game's TV screens with lazyScreen, and the TV loads them all as it opens", () => {
  const screens = gameModules.flatMap((m) => [m.TvView, m.FinalTvView].flatMap((view) => (view ? [{ type: m.logic.type, view }] : [])))
  expect(screens).not.toHaveLength(0)
  const preloads = screens.map(({ type, view }) => {
    expect(view.preload, type).toBeTypeOf('function')
    return vi.spyOn(view, 'preload').mockImplementation(() => {})
  })
  preloadTvScreens()
  for (const preload of preloads) expect(preload).toHaveBeenCalledTimes(1)
  for (const preload of preloads) preload.mockRestore()
})

describe.each([...gameLogic.values()].map((logic) => [logic.type, logic] as const))('%s', (type, logic) => {
  it('has a game type the database accepts and a known presentation', () => {
    expect(type).toMatch(/^[a-z][a-z0-9-]{1,39}$/)
    expect([undefined, 'stage', 'background']).toContain(logic.presentation)
  })

  it('ships default settings that survive a strict jsonb round trip', () => {
    expect(jsonbRoundTrip(logic.defaultConfig)).toEqual(logic.defaultConfig)
  })

  it('refuses garbage from phones with a GameError', () => {
    const garbage = [null, 1, 'x', {}, { type: 'nope' }, JSON.parse('{"__proto__": {"type": "tag"}}'), 'x'.repeat(100_000)]
    for (const input of garbage) {
      expect(() => logic.parseAction(input), JSON.stringify(input)?.slice(0, 40)).toThrow(GameError)
      if (logic.parseHostAction) expect(() => logic.parseHostAction!(input)).toThrow(GameError)
    }
  })

  it('keeps its contract over a round its bot plays', (context) => {
    const result = botExample(logic, gameBots.get(type)!)
    if ('refused' in result) {
      // A placeholder module that can't start yet; its game package brings the real one.
      if (result.refused === NOT_READY) return context.skip()
      throw new Error(`${type} won't start with its bot's settings: ${result.refused}`)
    }
    expect(checkGameContract(logic, result.example)).toEqual([])
  })
})
