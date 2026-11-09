import { describe, expect, it, vi } from 'vitest'
import type { AnyGame, Highlight, RecapRound } from '../games/core/Game'
import { gameLogic } from '../games/logic'
import { buildRecapDoc, listNames, type RawRecap } from './recap'
import { recordedRawRecap } from './recap.recorded'

const MIN = 60_000

/** A stand-in game with only a recap() hook. */
const withRecap = (recap: (round: RecapRound<unknown, unknown>) => Highlight[]) => ({ recap }) as unknown as AnyGame

describe('buildRecapDoc on a recorded party', () => {
  const raw = recordedRawRecap
  const doc = buildRecapDoc(raw, gameLogic)
  const idOf = (name: string) => raw.players.find((p) => p.name === name)!.id

  it('counts the night', () => {
    expect(doc.version).toBe(1)
    expect(doc.session).toEqual({ id: raw.session.id, name: 'Recorded party' })
    expect(doc.numbers).toEqual({ guests: 6, games: 4, answers: 3, moves: 5, awards: 5 })
    expect(doc.generatedAt).toBe(Math.max(...raw.log.map((e) => e.at)))
  })

  it('has one chapter per round in start order; running rounds only say who leads', () => {
    expect(doc.chapters.map((c) => [c.title, c.round, c.finishedBy])).toEqual([
      ['Last one standing', 1, null],
      ['Beer pong', 1, 'host'],
      ['Lab quiz', 1, 'game'],
      ['Beer pong', 2, null],
    ])
    expect(doc.chapters[0].highlights).toEqual([
      { title: 'Still running', detail: 'Leading so far: Bo with 3', players: [idOf('Bo')], weight: 'headline' },
    ])
    expect(doc.chapters[1].winners).toEqual([{ id: idOf('Ana'), name: 'Ana' }])
    // In-person rounds have a recap() hook, so its headline replaces the generic "Ana won Beer pong".
    expect(doc.chapters[1].highlights).toEqual([
      { title: 'Top scorer in Beer pong: Ana', detail: '3 points', players: [idOf('Ana')], icon: 'trophy', tone: 'gold', weight: 'headline' },
    ])
    expect(doc.chapters[2].highlights[0].title).toBe('Ana, Dee and Finn won Lab quiz')
    expect(doc.chapters[3].highlights[0].detail).toBe('Leading so far: Bo with 4')
  })

  it('ranks the standings, with a podium of those who scored', () => {
    expect(doc.standings.map((r) => [r.name, r.points, r.rank])).toEqual([
      ['Bo', 7, 1],
      ['Ana', 6, 2],
      ['Dee', 2, 3],
      ['Eve', 2, 3],
      ['Finn', 1, 5],
    ])
    expect(doc.podium.map((p) => p.name)).toEqual(['Bo', 'Ana', 'Dee'])
  })

  it('replays the race to exactly the final standings, from a zero start', () => {
    expect(doc.race.length).toBeGreaterThan(2)
    expect(doc.race.length).toBeLessThanOrEqual(120)
    expect(Object.values(doc.race[0].totals).every((t) => t === 0)).toBe(true)
    const last = doc.race[doc.race.length - 1]
    expect(last.totals).toEqual(Object.fromEntries(raw.standings.map((r) => [r.player_id, r.points])))
    for (let i = 1; i < doc.race.length; i++) expect(doc.race[i].at).toBeGreaterThanOrEqual(doc.race[i - 1].at)
    // Everything happened within seconds: no lead change counts in the first 15 minutes.
    expect(doc.leadChanges).toEqual([])
  })

  it("gives every current player their night: rank, points by game, and the moments that name them", () => {
    expect(Object.keys(doc.players)).not.toContain(idOf('Cy'))
    const ana = doc.players[idOf('Ana')]
    expect([ana.rank, ana.points]).toEqual([2, 6])
    expect(ana.byGame.map((g) => [g.title, g.points])).toEqual([
      ['Beer pong', 3],
      ['Last one standing', 2],
      ['Lab quiz', 1],
    ])
    expect(ana.moments.map((m) => m.title)).toEqual(['Top scorer in Beer pong: Ana', 'Ana, Dee and Finn won Lab quiz', 'Your best game: Beer pong'])
    expect(doc.players[idOf('Bo')].byGame.map((g) => [g.title, g.points])).toEqual([
      ['Beer pong', 4],
      ['Last one standing', 3],
    ])
  })

  it('lists starts and finishes in time order', () => {
    expect(doc.timeline.map((t) => t.text)).toEqual([
      'Last one standing started',
      'Beer pong started',
      'Ana won Beer pong',
      'Lab quiz started',
      'Ana, Dee and Finn won Lab quiz',
      'Beer pong started again',
    ])
  })

  it('never carries the running round’s secret tasks', () => {
    const running = raw.rounds.find((r) => r.finished_at === null && (r.state as { tasks?: unknown })?.tasks)
    const tasks = Object.values((running!.state as { tasks: Record<string, string> }).tasks)
    expect(tasks.length).toBeGreaterThan(0)
    const text = JSON.stringify(doc)
    for (const task of tasks) expect(text).not.toContain(task)
  })
})

describe('buildRecapDoc keeps live secrets out', () => {
  const P = ['a', 'b', 'c', 'd', 'e'].map((x) => `0000000${x}-0000-4000-8000-000000000000`)
  const [A, B, C, D, E] = P
  const T0 = 1_795_900_000_000
  const TASKS = P.map((_, i) => `SECRET TASK ${i}: get someone to say pineapple ${i}`)
  const QUESTIONS = Array.from({ length: 10 }, (_, i) => ({
    text: `QUESTION ${i + 1}: which ${i < 3 ? 'asked' : 'UNASKED'} thing is this`,
    options: [`KEY-${i + 1}-RIGHT`, `wrong ${i + 1}a`, `wrong ${i + 1}b`],
    correct: 0,
  }))
  const raw: RawRecap = {
    session: { id: 's', name: 'Secret party', created_at: T0, archived_at: null },
    players: P.map((id, i) => ({ id, name: ['Ana', 'Bo', 'Cy', 'Dee', 'Eve'][i], joined_at: T0, removed_at: null, profile: {} })),
    games: [
      { id: 'elim', title: 'Last one standing', game_type: 'elimination', position: 0, status: 'active' },
      { id: 'quiz', title: 'Quiz', game_type: 'quiz', position: 1, status: 'finished' },
    ],
    rounds: [
      {
        game_id: 'elim',
        round: 1,
        started_at: T0 + MIN,
        finished_at: null,
        finished_by: null,
        config: { tasks: TASKS, pointsPerTag: 1, pointsPerCatch: 1 },
        state: { tasks: Object.fromEntries(P.map((id, i) => [id, TASKS[i]])), playerIds: P, knockouts: [] },
        public_state: { alive: P },
        scores: {},
        points: {},
        winners: [],
      },
      {
        game_id: 'quiz',
        round: 1,
        started_at: T0 + 10 * MIN,
        finished_at: T0 + 20 * MIN,
        finished_by: 'host',
        config: { questions: QUESTIONS, seconds: 20, pointsPerRight: 1 },
        state: { phase: 'reveal', index: 2, results: [0, 1, 2].map((index) => ({ index, correct: 0 })), quizPoints: { [A]: 2500, [B]: 900 } },
        public_state: { phase: 'reveal', index: 2, total: 10 },
        scores: { [A]: 3, [B]: 1 },
        points: { [A]: 3, [B]: 1 },
        winners: [A],
      },
    ],
    log: [
      { id: 1, at: T0 + 10 * MIN, kind: 'game.effects', game_id: 'quiz', game_type: 'quiz', round: 1, actor: 'game', player_id: null, about: [A, B], data: { scores: { [A]: 3, [B]: 1 } } },
    ],
    standings: [A, B, C, D, E].map((id, i) => ({ player_id: id, name: ['Ana', 'Bo', 'Cy', 'Dee', 'Eve'][i], points: [3, 1, 0, 0, 0][i] })),
  }

  it('calls a game’s recap() for finished rounds only, and never puts a round’s state or config in the doc', () => {
    const eliminationRecap = vi.fn((round: RecapRound<unknown, unknown>): Highlight[] => [{ title: `Leaked ${JSON.stringify(round.state)}` }])
    const quizRecap = vi.fn((round: RecapRound<unknown, unknown>): Highlight[] => {
      // Like the real quiz: only what the finished round showed the room.
      const state = round.state as { results: { index: number }[] }
      return [
        { title: 'Ana won the quiz', players: [A], weight: 'headline' },
        { title: 'Fastest right answer: Ana', detail: `1.2 s on question ${state.results.length}`, players: [A], at: T0 + 15 * MIN },
      ]
    })
    const doc = buildRecapDoc(raw, new Map([['elimination', withRecap(eliminationRecap)], ['quiz', withRecap(quizRecap)]]))
    expect(eliminationRecap).not.toHaveBeenCalled()
    expect(quizRecap).toHaveBeenCalledTimes(1)
    expect(quizRecap.mock.calls[0][0]).toMatchObject({ finished: true, round: 1, winners: [A], points: { [A]: 3, [B]: 1 } })
    expect(doc.chapters[0].highlights).toEqual([{ title: 'Still running', weight: 'headline' }])
    const text = JSON.stringify(doc)
    for (const task of TASKS) expect(text).not.toContain(task)
    for (const q of QUESTIONS.slice(3)) {
      expect(text).not.toContain(q.text)
      for (const option of q.options) expect(text).not.toContain(option)
    }
    expect(text).not.toContain('KEY-')
    expect(text).not.toContain('pineapple')
    expect(doc.timeline.map((t) => t.text)).toEqual(['Last one standing started', 'Quiz started', 'Fastest right answer: Ana', 'Ana won Quiz'])
  })

  it('a broken hook only loses its own lines: the chapter gets the generic winner line', () => {
    const throwing = withRecap(() => {
      throw new Error('bug')
    })
    const junk = withRecap(() => [null, { title: '' }, { title: 'Kept', icon: 'not-an-icon', weight: 'loud', players: [A, 7] }] as unknown as Highlight[])
    expect(buildRecapDoc(raw, new Map([['quiz', throwing]])).chapters[1].highlights).toEqual([
      { title: 'Ana won Quiz', players: [A], icon: 'crown', weight: 'headline' },
    ])
    expect(buildRecapDoc(raw, new Map([['quiz', junk]])).chapters[1].highlights).toEqual([{ title: 'Kept', players: [A] }])
  })

  it('a finished round nobody won says it is over', () => {
    const noWinners: RawRecap = { ...raw, rounds: [{ ...raw.rounds[1], winners: [] }] }
    expect(buildRecapDoc(noWinners, new Map()).chapters[0].highlights).toEqual([{ title: 'Quiz is over', weight: 'headline' }])
  })
})

describe('the race and the lead changes', () => {
  const T0 = 1_795_900_000_000
  const ids = ['p1', 'p2', 'p3']
  const names = ['Ana', 'Bo', 'Cy']
  const players = ids.map((id, i) => ({ id, name: names[i], joined_at: T0, removed_at: null, profile: {} }))
  let logId = 0
  const award = (minute: number, player: string, points: number, kind = 'points.awarded') => ({
    id: ++logId,
    at: T0 + minute * MIN,
    kind,
    game_id: null,
    game_type: null,
    round: null,
    actor: 'host' as const,
    player_id: player,
    about: [player],
    data: { player_id: player, points, reason: null, game_id: null },
  })

  it('records a new leader after the first 15 minutes, ignoring ties', () => {
    logId = 0
    const log = [
      award(1, 'p1', 3), // Ana leads in the first 15 minutes: not counted
      award(5, 'p2', 4), // Bo takes over, still in the quiet time
      award(20, 'p1', 1), // 4 to 4: a tie changes nothing
      award(25, 'p1', 2), // Ana leads again: counted
      award(30, 'p3', 9), // Cy: counted
      award(40, 'p3', 9, 'points.undone'), // Cy's points undone: Ana leads again
    ]
    const doc = buildRecapDoc(
      {
        session: { id: 's', name: 'Party', created_at: T0 - 600 * MIN, archived_at: null },
        players,
        games: [],
        rounds: [],
        log,
        standings: [
          { player_id: 'p1', name: 'Ana', points: 6 },
          { player_id: 'p2', name: 'Bo', points: 4 },
          { player_id: 'p3', name: 'Cy', points: 0 },
        ],
      },
      new Map(),
    )
    expect(doc.leadChanges.map((c) => [c.name, (c.at - T0) / MIN])).toEqual([
      ['Ana', 25],
      ['Cy', 30],
      ['Ana', 40],
    ])
    expect(doc.timeline.map((t) => t.text)).toEqual(['Ana took the lead', 'Cy took the lead', 'Ana took the lead'])
    // The zero start sits just before the first points.
    expect(doc.race[0]).toEqual({ at: T0 + MIN - 1, totals: { p1: 0, p2: 0, p3: 0 } })
    expect(doc.race[doc.race.length - 1].totals).toEqual({ p1: 6, p2: 4, p3: 0 })
  })

  it('samples a long night down to 120 points at even times, ending on the final standings', () => {
    logId = 0
    const log = Array.from({ length: 400 }, (_, i) => award(i, ids[i % 3], 1))
    const doc = buildRecapDoc(
      {
        session: { id: 's', name: 'Party', created_at: T0, archived_at: null },
        players,
        games: [],
        rounds: [],
        log,
        standings: ids.map((id, i) => ({ player_id: id, name: names[i], points: [134, 133, 133][i] })),
      },
      new Map(),
    )
    expect(doc.race).toHaveLength(120)
    expect(doc.race[0].totals).toEqual({ p1: 0, p2: 0, p3: 0 })
    expect(doc.race[119]).toEqual({ at: T0 + 399 * MIN, totals: { p1: 134, p2: 133, p3: 133 } })
    const gaps = doc.race.slice(1).map((s, i) => s.at - doc.race[i].at)
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1)
  })

  it('takes a deleted game’s scores out of the race, and a removed player out of the lead', () => {
    logId = 0
    const effects = (minute: number, scores: Record<string, number>) => ({
      id: ++logId,
      at: T0 + minute * MIN,
      kind: 'game.effects',
      game_id: 'g',
      game_type: 'x',
      round: 1,
      actor: 'game' as const,
      player_id: null,
      about: Object.keys(scores),
      data: { scores },
    })
    const log = [
      effects(1, { p1: 5 }),
      award(2, 'p2', 2),
      { ...award(20, 'p1', 0), kind: 'game.deleted', game_id: 'g', player_id: null, data: { title: 'G' } },
      { ...award(30, 'p3', 0), kind: 'player.removed', data: { name: 'Cy' } },
    ]
    const doc = buildRecapDoc(
      {
        session: { id: 's', name: 'Party', created_at: T0, archived_at: null },
        players,
        games: [],
        rounds: [],
        log,
        standings: [
          { player_id: 'p2', name: 'Bo', points: 2 },
          { player_id: 'p1', name: 'Ana', points: 0 },
        ],
      },
      new Map(),
    )
    expect(doc.race.map((s) => s.totals)).toEqual([
      { p2: 0, p1: 0 },
      { p2: 0, p1: 5 },
      { p2: 2, p1: 5 },
      { p2: 2, p1: 0 },
    ])
    expect(doc.leadChanges.map((c) => c.name)).toEqual(['Bo'])
  })
})

describe('listNames', () => {
  it('joins names the way the recap says them', () => {
    expect(listNames([])).toBe('')
    expect(listNames(['Ana'])).toBe('Ana')
    expect(listNames(['Ana', 'Bo'])).toBe('Ana and Bo')
    expect(listNames(['Ana', 'Bo', 'Cy'])).toBe('Ana, Bo and Cy')
    expect(listNames(['Ana', 'Bo', 'Cy', 'Dee', 'Eve'])).toBe('Ana, Bo, Cy and 2 more')
  })
})
