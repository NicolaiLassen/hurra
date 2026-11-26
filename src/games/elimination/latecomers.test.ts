// Latecomers in Last one standing: a guest who joins while dealing in is open
// gets the next card from the deck shuffled at the start, never a task someone
// still holds while a free one is left, and a repeat only once the deck is
// used up. Dealing in closes by itself a set time after the start, or at the
// host's switch, which can open it again. A freed name taken again, or anyone
// dealt in before, watches (docs/guest-list.md, 9.4).
import { describe, expect, it } from 'vitest'
import { createGameContext } from '../core/context'
import type { GamePlayer } from '../core/Game'
import { simulateParty, type FakeParty } from '../core/simulate'
import { jsonbRoundTrip, seededRandom, testInfo } from '../core/testing'
import type { Player } from '../../lib/types'
import { bot } from './bot'
import {
  DEFAULT_DEAL_IN_MINUTES,
  DEFAULT_TASKS,
  dealingIn,
  dealingInNow,
  EliminationGame,
  MAX_TASK_LENGTH,
  MAX_TASKS,
  standing,
  winnerOf,
  type EliminationConfig,
  type EliminationPlayerView,
  type EliminationPublicState,
  type EliminationState,
} from './logic'
import { roundRoster } from './roster'

const game = new EliminationGame()
const MIN = 60_000
/** testInfo's clock. */
const T0 = 1_000
const config: EliminationConfig = {
  tasks: ['sing', 'dance', 'ribbit', 'wave', 'hum', 'clap'],
  pointsPerTag: 1,
  pointsPerCatch: 1,
  dealInMinutes: 105,
}

type Options = { now?: number; config?: EliminationConfig; seed?: number }

function context(present: string[], { now = T0, config: cfg = config, seed = 1 }: Options = {}, kind: 'system' | 'host' | 'player' = 'system') {
  const actor = kind === 'player' ? { kind, playerId: present[0] } : { kind }
  return createGameContext(testInfo(cfg, present, { now }), seededRandom(seed), { actor })
}

const asPlayer = (id: string): GamePlayer => ({ id, name: id, profile: {} })

function start(players: string[], options: Options = {}) {
  const { ctx, effects } = context(players, options, 'host')
  return { state: game.setup(ctx), effects }
}

/** The engine's membership step for one joiner: actor system, the party as it is now. */
function join(state: EliminationState, id: string, present: string[], options: Options = {}) {
  const { ctx, effects } = context(present, options)
  return { state: game.onPlayerJoin(state, asPlayer(id), ctx), effects }
}

function tag(state: EliminationState, by: string, target: string, present = state.playerIds) {
  return game.handleAction(state, { type: 'tag', target }, by, context(present, {}, 'host').ctx)
}

function host(state: EliminationState, open: boolean, present: string[], options: Options = {}) {
  const { ctx, effects } = context(present, options, 'host')
  return { state: game.handleHostAction(state, game.parseHostAction({ type: 'dealIn', open }), ctx), effects }
}

const held = (state: EliminationState) => Object.values(state.tasks)

describe('the default tasks', () => {
  it('are a long list, so a party of up to 45 never deals the same task twice', () => {
    expect(DEFAULT_TASKS.length).toBeGreaterThanOrEqual(60)
    expect(DEFAULT_TASKS.length).toBeLessThanOrEqual(MAX_TASKS)
    expect(new Set(DEFAULT_TASKS.map((t) => t.toLowerCase())).size).toBe(DEFAULT_TASKS.length)
  })

  it('read the same way and fit a phone at a glance', () => {
    for (const task of DEFAULT_TASKS) {
      expect(task, task).toMatch(/^Get someone to [a-z]/)
      expect(Array.from(task).length, task).toBeLessThanOrEqual(Math.min(55, MAX_TASK_LENGTH))
      // Curly quotes and apostrophes, never straight ones; no dashes; no full stop at the end.
      expect(task, task).not.toMatch(/['"\u2013\u2014]|\.$/)
    }
  })

  it('name nobody: they ship in the app', () => {
    // A capital after the start is a title or a song, never a guest: Happy Birthday, Disney, Your Majesty, Australia.
    const capitals = DEFAULT_TASKS.flatMap((task) => task.slice('Get someone to '.length).match(/\b[A-Z][a-z]+/g) ?? [])
    expect([...new Set(capitals)].sort()).toEqual(['Australia', 'Birthday', 'Disney', 'Happy', 'Majesty', 'Your'])
  })

  it('need no drink, since nobody has to drink to play', () => {
    for (const task of DEFAULT_TASKS) expect(task, task).not.toMatch(/\b(drink|beer|wine|shot|sip|glass)\b/i)
  })

  it('deal 45 guests 45 different tasks, latecomers included', () => {
    const players = Array.from({ length: 30 }, (_, i) => `p${i}`)
    let { state } = start(players, { config: game.defaultConfig })
    const present = [...players]
    for (let i = 30; i < 45; i++) {
      present.push(`p${i}`)
      state = join(state, `p${i}`, present, { config: game.defaultConfig }).state
    }
    expect(state.playerIds).toHaveLength(45)
    expect(new Set(held(state)).size).toBe(45)
  })
})

describe('the deck', () => {
  it('is the settings shuffled, each text once, with one card dealt per player and dealing in on', () => {
    const { state } = start(['ana', 'bo', 'cy'], { config: { ...config, tasks: ['sing', 'dance', 'sing', ' ribbit ', 'wave'] } })
    expect([...state.deck!].sort()).toEqual(['dance', 'ribbit', 'sing', 'wave'])
    expect(state.dealt).toBe(3)
    expect(state.playerIds.map((id) => state.tasks[id])).toEqual(state.deck!.slice(0, 3))
    expect(state).toMatchObject({ dealIn: true, dealInUntil: T0 + 105 * MIN })
    expect(state.late).toBeUndefined()
  })

  it('stays open until the host closes it when the setting is 0', () => {
    expect(start(['ana', 'bo'], { config: { ...config, dealInMinutes: 0 } }).state).toMatchObject({ dealIn: true, dealInUntil: null })
  })

  it('deals more players than tasks evenly, as before', () => {
    const { state } = start(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], { config: { ...config, tasks: ['sing', 'dance', 'ribbit'] } })
    const counts = new Map<string, number>()
    for (const task of held(state)) counts.set(task, (counts.get(task) ?? 0) + 1)
    expect([...counts.values()].sort()).toEqual([2, 3, 3])
    // Every card taken counts, the repeats too.
    expect(state.dealt).toBe(8)
  })
})

describe('the setting', () => {
  it('takes 0 to 600 whole minutes, and gives settings saved before it the default', () => {
    expect(game.parseConfig({ ...config, dealInMinutes: 0 }).dealInMinutes).toBe(0)
    expect(game.parseConfig({ ...config, dealInMinutes: 600 }).dealInMinutes).toBe(600)
    expect(game.parseConfig({ tasks: ['sing'], pointsPerTag: 1, pointsPerCatch: 1 }).dealInMinutes).toBe(DEFAULT_DEAL_IN_MINUTES)
    expect(game.defaultConfig.dealInMinutes).toBe(105)
    for (const minutes of [1.5, -1, 601, '30', null]) {
      expect(() => game.parseConfig({ ...config, dealInMinutes: minutes })).toThrow('Dealing in must be a whole number of minutes from 0 to 600')
    }
  })
})

describe('a guest who joins while dealing in is open', () => {
  it('gets the top card, one life and their own moment, and is in the count', () => {
    const { state } = start(['ana', 'bo', 'cy'])
    const { state: next, effects } = join(state, 'dee', ['ana', 'bo', 'cy', 'dee'], { now: T0 + 40 * MIN })
    expect(next.tasks.dee).toBe(state.deck![3])
    expect(held(state)).not.toContain(next.tasks.dee)
    expect(next).toMatchObject({ playerIds: ['ana', 'bo', 'cy', 'dee'], dealt: 4, late: ['dee'], deck: state.deck })
    expect(effects.announcements).toEqual([
      { message: "You're in Last one standing", detail: 'Your secret task is on your phone', to: ['dee'], icon: 'megaphone', sound: 'chime' },
    ])
    const info = testInfo(config, ['ana', 'bo', 'cy', 'dee'])
    expect(game.playerView(next, 'dee', info)).toEqual({ status: 'alive', task: next.tasks.dee, knockouts: 0, late: true })
    // Guests dealt in at the start have no mark.
    expect(game.playerView(next, 'ana', info)).toEqual({ status: 'alive', task: next.tasks.ana, knockouts: 0 })
    expect(game.publicState(next, info).alive).toEqual(['ana', 'bo', 'cy', 'dee'])
    expect(standing(next, info)).toHaveLength(4)
  })

  it('two joining in one save get two different cards, neither one someone holds', () => {
    const { state } = start(['ana', 'bo', 'cy'])
    const present = ['ana', 'bo', 'cy', 'dee', 'eve']
    const afterDee = join(state, 'dee', present).state
    const both = join(afterDee, 'eve', present).state
    expect(both.tasks.dee).not.toBe(both.tasks.eve)
    expect(held(state)).not.toContain(both.tasks.dee)
    expect(held(state)).not.toContain(both.tasks.eve)
    expect(both.dealt).toBe(5)
    expect(both.late).toEqual(['dee', 'eve'])
  })

  it('never gets a task a standing player holds while a free one is left, and repeats only once the deck is used up', () => {
    const small = { ...config, tasks: ['sing', 'dance', 'ribbit', 'wave'] }
    const at = { config: small }
    let { state } = start(['ana', 'bo', 'cy'], at)
    const present = ['ana', 'bo', 'cy', 'dee', 'eve', 'fay', 'gus']
    // The last card nobody has seen.
    state = join(state, 'dee', present, at).state
    expect(state.tasks.dee).toBe(state.deck![3])
    expect(state.dealt).toBe(4)
    expect(new Set(held(state)).size).toBe(4)

    // Ana tags Bo: Ana's task is spent (the room saw it) and nobody holds it now.
    const spent = state.tasks.ana
    state = tag(state, 'ana', 'bo', present)
    expect(small.tasks.filter((t) => !held(state).includes(t))).toEqual([spent])
    // The deck is used up: a task nobody holds comes first, even one the room saw.
    state = join(state, 'eve', present, at).state
    expect(state.tasks.eve).toBe(spent)

    // Every task is held now: a repeat, the one held by the fewest, first in deck order.
    state = join(state, 'fay', present, at).state
    expect(state.tasks.fay).toBe(state.deck![0])
    state = join(state, 'gus', present, at).state
    expect(state.tasks.gus).toBe(state.deck![1])
    expect(state.dealt).toBe(7)
  })

  it('prefers a free task nobody saw over one a knockout showed', () => {
    const small = { ...config, tasks: ['sing', 'dance', 'ribbit', 'wave'] }
    const at = { config: small }
    let { state } = start(['ana', 'bo', 'cy', 'dee'], at)
    const shown = state.tasks.ana
    state = tag(state, 'ana', 'bo')
    // Cy leaves the party with a task nobody else ever saw.
    const unseen = state.tasks.cy
    state = game.onPlayerLeave(state, 'cy', context(['ana', 'bo', 'dee'], at).ctx)
    expect(held(state)).not.toContain(unseen)
    expect(held(state)).not.toContain(shown)
    const present = ['ana', 'bo', 'dee', 'eve', 'fay']
    state = join(state, 'eve', present, at).state
    expect(state.tasks.eve).toBe(unseen)
    state = join(state, 'fay', present, at).state
    expect(state.tasks.fay).toBe(shown)
  })

  it('is dealt in by the join move too, which never throws and is a skip when it changes nothing', () => {
    const { state } = start(['ana', 'bo'])
    const move = (s: EliminationState, id: string, present: string[], options: Options = {}) =>
      game.handleAction(s, game.parseAction({ type: 'join' }), id, context(present, options, 'player').ctx)
    const dealt = move(state, 'cy', ['cy', 'ana', 'bo'])
    expect(dealt.tasks.cy).toBe(state.deck![2])
    // Dealt in already, out, gone from the party, after the close, or after a winner: unchanged, never an error.
    expect(move(dealt, 'cy', ['cy', 'ana', 'bo'])).toBe(dealt)
    const afterCy = tag(dealt, 'ana', 'cy')
    expect(move(afterCy, 'cy', ['cy', 'ana', 'bo'])).toBe(afterCy)
    expect(move(state, 'zed', ['ana', 'bo'])).toBe(state)
    expect(move(state, 'cy', ['cy', 'ana', 'bo'], { now: T0 + 105 * MIN })).toBe(state)
    const won = tag(state, 'ana', 'bo')
    expect(move(won, 'cy', ['cy', 'ana', 'bo'])).toBe(won)
    expect(() => game.parseAction({ type: 'join', target: 'x' })).not.toThrow()
  })
})

describe('when dealing in closes', () => {
  it('closes by itself at the set time, even with no save at that moment', () => {
    const { state } = start(['ana', 'bo'])
    const present = ['ana', 'bo', 'cy']
    expect(join(state, 'cy', present, { now: T0 + 105 * MIN - 1 }).state.tasks.cy).toBeDefined()
    const late = join(state, 'cy', present, { now: T0 + 105 * MIN })
    expect(late.state).toBe(state)
    expect(late.effects.announcements).toEqual([])
    expect(dealingIn(state, T0 + 105 * MIN)).toBe(false)
    expect(game.playerView(state, 'cy', testInfo(config, present))).toEqual({ status: 'spectator' })
  })

  it('never closes by itself with 0 minutes', () => {
    const { state } = start(['ana', 'bo'], { config: { ...config, dealInMinutes: 0 } })
    expect(join(state, 'cy', ['ana', 'bo', 'cy'], { now: T0 + 24 * 60 * MIN }).state.late).toEqual(['cy'])
  })

  it('closes at the host’s switch, and the next guest watches', () => {
    const { state } = start(['ana', 'bo'])
    const closed = host(state, false, ['ana', 'bo']).state
    expect(closed).toMatchObject({ dealIn: false, dealInUntil: null })
    expect(join(closed, 'cy', ['ana', 'bo', 'cy']).state).toBe(closed)
    // A second Close is a skip.
    expect(host(closed, false, ['ana', 'bo']).state).toBe(closed)
    // So is Close after it closed by itself.
    expect(host(state, false, ['ana', 'bo'], { now: T0 + 200 * MIN }).state).toBe(state)
  })

  it('opens again at the host’s switch, deals in everyone here who has no task, and stays open', () => {
    const { state } = start(['ana', 'bo'])
    const closed = host(state, false, ['ana', 'bo']).state
    const present = ['ana', 'bo', 'cy', 'dee']
    const { state: open, effects } = host(closed, true, present, { now: T0 + 300 * MIN })
    expect(open).toMatchObject({ dealIn: true, dealInUntil: null, late: ['cy', 'dee'] })
    expect(new Set(held(open)).size).toBe(4)
    expect(effects.announcements.map((a) => a.to)).toEqual([['cy'], ['dee']])
    // Open with no timer left: a second Open is a skip, and it never closes by itself again.
    expect(host(open, true, present).state).toBe(open)
    expect(dealingIn(open, T0 + 10_000 * MIN)).toBe(true)
    // Open while the timer runs keeps it open past it.
    expect(host(state, true, ['ana', 'bo']).state).toMatchObject({ dealIn: true, dealInUntil: null })
    expect(() => game.parseHostAction({ type: 'dealIn' })).toThrow('Unknown host action')
  })

  it('tells phones in the public state, by the save’s clock', () => {
    const { state } = start(['ana', 'bo'])
    const info = (now: number) => testInfo(config, ['ana', 'bo'], { now })
    expect(game.publicState(state, info(T0))).toMatchObject({ dealIn: true, dealInUntil: T0 + 105 * MIN })
    expect(game.publicState(state, info(T0 + 105 * MIN))).toMatchObject({ dealIn: false })
    const pub = game.publicState(state, info(T0))
    expect(dealingInNow(pub, T0 + 104 * MIN)).toBe(true)
    expect(dealingInNow(pub, T0 + 105 * MIN)).toBe(false)
    // A public state saved before dealing in existed: phones don't ask.
    expect(dealingInNow({ alive: [] }, T0)).toBe(false)
  })
})

describe('the winner check', () => {
  it('still needs more than one dealt in, and a latecomer keeps a round of two going', () => {
    const { state } = start(['ana', 'bo'])
    const three = join(state, 'cy', ['ana', 'bo', 'cy']).state
    const afterBo = tag(three, 'ana', 'bo')
    expect(winnerOf(afterBo, testInfo(config, ['ana', 'bo', 'cy']))).toBeNull()
    expect(winnerOf(tag(afterBo, 'ana', 'cy'), testInfo(config, ['ana', 'bo', 'cy']))).toBe('ana')
  })

  it('deals nobody in once the round has a winner', () => {
    const { state } = start(['ana', 'bo'])
    const won = tag(state, 'ana', 'bo')
    expect(join(won, 'cy', ['ana', 'bo', 'cy']).state).toBe(won)
  })
})

describe('a round saved before the deck', () => {
  const old: EliminationState = {
    tasks: { ana: 'sing', bo: 'dance', cy: 'ribbit' },
    playerIds: ['ana', 'bo', 'cy'],
    knockouts: [],
  }

  it('deals a latecomer from the settings’ tasks nobody holds, and keeps dealing in open until the host closes it', () => {
    const present = ['ana', 'bo', 'cy', 'dee', 'eve', 'fay']
    let state = join(old, 'dee', present).state
    expect(['wave', 'hum', 'clap']).toContain(state.tasks.dee)
    expect([...state.deck!].sort()).toEqual([...config.tasks].sort())
    expect(state.dealt).toBe(7)
    state = join(state, 'eve', present).state
    state = join(state, 'fay', present).state
    expect(new Set(held(state)).size).toBe(6)
    expect(state.late).toEqual(['dee', 'eve', 'fay'])
    expect(dealingIn(old, T0 + 10_000 * MIN)).toBe(true)
    expect(host(old, false, ['ana', 'bo', 'cy']).state).toMatchObject({ dealIn: false })
    // Its saved state, read back from the database, plays on.
    expect(jsonbRoundTrip(state)).toEqual(state)
  })

  it('leaves out a task a knockout showed while another is free', () => {
    const afterBo = tag({ ...old, tasks: { ...old.tasks } }, 'ana', 'bo', ['ana', 'bo', 'cy'])
    const small = { ...config, tasks: ['sing', 'dance', 'ribbit', 'wave'] }
    const { state } = join(afterBo, 'dee', ['ana', 'bo', 'cy', 'dee'], { config: small })
    expect(state.tasks.dee).toBe('wave')
  })
})

/** A party with Last one standing and 6 tasks. */
function party(players: number, settings: Record<string, unknown> = { tasks: config.tasks }) {
  const p = simulateParty({ games: [game], players })
  p.addGame('g', 'elimination', 'Last one standing', settings)
  p.send(p.hostUser, { type: 'start', gameId: 'g' })
  return p
}

const viewOf = (p: FakeParty, player: GamePlayer) => p.game('g').views[player.id] as EliminationPlayerView | undefined
const publicOf = (p: FakeParty) => p.game('g').publicState as EliminationPublicState
const stateOf = (p: FakeParty) => p.stateOf('g')!.state as EliminationState
const joinMove = (p: FakeParty, player: GamePlayer) => p.send(p.userOf(player.id), { type: 'action', gameId: 'g', action: { type: 'join' } })
const hostMove = (p: FakeParty, open: boolean) => p.send(p.hostUser, { type: 'host-action', gameId: 'g', action: { type: 'dealIn', open } })

describe('latecomers in a party', () => {
  it('a guest who joins gets a task with the join move their phone sends, and the TV counts them', () => {
    const p = party(3)
    p.tick(20 * MIN)
    const dee = p.addPlayer('Dee')
    expect(viewOf(p, dee)).toBeUndefined()
    const step = joinMove(p, dee)
    expect(step.kind).toBe('commit')
    expect(step).toMatchObject({ view: { status: 'alive', late: true } })
    expect(viewOf(p, dee)).toMatchObject({ status: 'alive', late: true })
    expect(p.feed.find((f) => f.message === "You're in Last one standing")?.audience).toEqual([dee.id])
    // The TV's band and the phones count from the same roster: "4 of 4 still in".
    const roster = roundRoster(asPlayers(p), publicOf(p))
    expect([roster.standing.length, roster.total]).toEqual([4, 4])
    // Asking again changes nothing.
    expect(joinMove(p, dee).kind).toBe('skip')
  })

  it('a guest who takes a name from the guest list is dealt in by the next save, and so is one who is not on it', () => {
    const p = party(3)
    const zelda = p.listGuest('Zelda')
    p.tick(MIN)
    p.claimGuest(zelda.id)
    const walkIn = p.addPlayer('Walk-in')
    // One save (here a sync) runs both joins: two cards, neither one someone holds.
    expect(p.sync('g').kind).toBe('commit')
    const state = stateOf(p)
    expect([...state.late!].sort()).toEqual([zelda.id, walkIn.id].sort())
    expect(new Set(Object.values(state.tasks)).size).toBe(5)
    expect(viewOf(p, zelda)).toMatchObject({ status: 'alive' })
    expect(viewOf(p, walkIn)).toMatchObject({ status: 'alive' })
    expect(publicOf(p).alive).toHaveLength(5)
  })

  it('a guest who joins after the host closed dealing in watches, until the host opens it again', () => {
    const p = party(3)
    expect(hostMove(p, false).kind).toBe('commit')
    expect(hostMove(p, false).kind).toBe('skip')
    const late = p.addPlayer('Late')
    expect(joinMove(p, late).kind).toBe('commit') // the save makes them a member, with a view
    expect(viewOf(p, late)).toEqual({ status: 'spectator' })
    expect(publicOf(p)).toMatchObject({ dealIn: false })
    expect(p.send(p.userOf(late.id), { type: 'action', gameId: 'g', action: { type: 'tag', target: p.players[0].id } })).toMatchObject({
      kind: 'refuse',
      message: 'You joined after this game started',
    })
    expect(hostMove(p, true).kind).toBe('commit')
    expect(viewOf(p, late)).toMatchObject({ status: 'alive', late: true })
    expect(p.feed.filter((f) => f.message === "You're in Last one standing").map((f) => f.audience)).toEqual([[late.id]])
  })

  it('closes by itself 105 minutes after the start', () => {
    const p = party(3)
    p.tick(104 * MIN)
    const early = p.addPlayer('Early')
    joinMove(p, early)
    expect(viewOf(p, early)).toMatchObject({ status: 'alive' })
    p.tick(MIN)
    const late = p.addPlayer('Late')
    joinMove(p, late)
    expect(viewOf(p, late)).toEqual({ status: 'spectator' })
    expect(publicOf(p).dealIn).toBe(false)
  })

  it('a freed name taken again, by the same guest or another, watches and gets no second life', () => {
    const p = party(2)
    const zelda = p.listGuest('Zelda')
    p.claimGuest(zelda.id)
    p.sync('g')
    expect(viewOf(p, zelda)).toMatchObject({ status: 'alive', late: true })
    // Knocked out, then the name is freed and taken again.
    p.send(p.userOf(p.players[0].id), { type: 'action', gameId: 'g', action: { type: 'catch', target: zelda.id } })
    p.tick(1000)
    p.freeGuest(zelda.id)
    p.tick(1000)
    p.claimGuest(zelda.id)
    expect(joinMove(p, zelda).kind).toBe('commit')
    expect(viewOf(p, zelda)).toEqual({ status: 'spectator' })
    expect(joinMove(p, zelda).kind).toBe('skip')
    // Opening dealing in again doesn't deal the name in either.
    hostMove(p, false)
    hostMove(p, true)
    expect(viewOf(p, zelda)).toEqual({ status: 'spectator' })
    expect(stateOf(p).playerIds.filter((id) => id === zelda.id)).toHaveLength(1)
  })

  it('a removal that crowns the last one standing deals in nobody who joined in the same save', () => {
    const p = party(2)
    const [ana, bo] = p.players
    p.removePlayer(bo.id)
    const cy = p.addPlayer('Cy')
    p.sync('g')
    expect(p.game('g')).toMatchObject({ status: 'finished', winners: [ana.id] })
    expect(stateOf(p).playerIds).not.toContain(cy.id)
  })

  it('runs out of fresh cards only after every task was dealt, then repeats the least held', () => {
    const p = party(2, { tasks: ['sing', 'dance', 'ribbit'] })
    const [cy, dee, eve] = ['Cy', 'Dee', 'Eve'].map((name) => p.addPlayer(name))
    for (const guest of [cy, dee, eve]) joinMove(p, guest)
    const state = stateOf(p)
    expect(state.dealt).toBe(5)
    const tasks = state.playerIds.map((id) => state.tasks[id])
    expect(new Set(tasks.slice(0, 3)).size).toBe(3)
    expect(tasks.slice(3)).toEqual(state.deck!.slice(0, 2))
  })
})

describe('the rehearsal bot', () => {
  const sight = (view: EliminationPlayerView | null, publicState: Partial<EliminationPublicState>) => ({
    playerId: 'me',
    players: [{ id: 'me', name: 'me', code: 'ME' }],
    publicState: { alive: [], out: [], winner: null, outBy: {}, knockoutCounts: {}, feed: [], ...publicState },
    view,
    prompts: [],
    myAnswers: {},
    now: T0,
    random: () => 0.99,
  })

  it('asks to be dealt in like a phone: no view yet and dealing in open', () => {
    expect(bot.move(sight(null, { dealIn: true, dealInUntil: null }))).toEqual({ kind: 'action', action: { type: 'join' } })
    expect(bot.move(sight(null, { dealIn: true, dealInUntil: T0 }))).toBeNull()
    expect(bot.move(sight(null, { dealIn: false }))).toBeNull()
    expect(bot.move(sight({ status: 'spectator' }, { dealIn: true }))).toBeNull()
  })

  it('plays a party where a latecomer arrives, through simulateParty', () => {
    const p = party(4)
    const late = p.addPlayer('Late')
    const move = bot.move({ playerId: late.id, players: p.players.map((pl) => ({ id: pl.id, name: pl.name, code: p.codeOf(pl.id) })), publicState: publicOf(p), view: null, prompts: [], myAnswers: {}, now: p.now, random: () => 0 })
    expect(move).toEqual({ kind: 'action', action: { type: 'join' } })
    expect(p.send(p.userOf(late.id), { type: 'action', gameId: 'g', action: { type: 'join' } }).kind).toBe('commit')
    expect(viewOf(p, late)).toMatchObject({ status: 'alive' })
  })
})

/** The party's players as screens get them. */
function asPlayers(p: FakeParty): Player[] {
  return p.players.map((pl) => ({ id: pl.id, name: pl.name, code: p.codeOf(pl.id), profile: {}, created_at: 0 }))
}
