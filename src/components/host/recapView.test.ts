import { describe, expect, it, vi } from 'vitest'
import { recapSlides } from '@/components/tv/recapSlides'
import { gameLogic } from '@/games/logic'
import { fixtureRecapDoc } from '@/lib/fixtures'
import { buildRecapDoc, type RecapDoc } from '@/lib/recap'
import { recordedRawRecap } from '@/lib/recap.recorded'
import {
  ARRIVAL_RETRIES_MS,
  biggestClimber,
  chapterStory,
  crownsCaption,
  crownSpots,
  downloadName,
  durationText,
  failedNightRead,
  gameTones,
  movedOnSince,
  nearestIndex,
  nightAwards,
  nightHeadline,
  ordinal,
  podiumPlaces,
  RACE_COLORS,
  raceSeries,
  recapScreen,
  retried,
  timeSpan,
  timeTicks,
  tvNote,
  tvPeek,
  valueTicks,
} from './recapView'

const MIN = 60_000
const AT = new Date(2026, 10, 28, 21, 0).getTime()

/** A night of five guests: the standings, with competition ranks, and no rounds yet. */
function nightOf(points: Record<string, number>, chapters: RecapDoc['chapters'] = []): RecapDoc {
  const standings = Object.entries(points)
    .sort((a, b) => b[1] - a[1])
    .map(([name, p]) => ({ playerId: name.toLowerCase(), name, points: p, rank: 0 }))
  standings.forEach((row, i) => (row.rank = i > 0 && row.points === standings[i - 1].points ? standings[i - 1].rank : i + 1))
  return {
    version: 1,
    session: { id: 's', name: 'Party' },
    generatedAt: AT,
    numbers: { guests: standings.length, games: chapters.length, answers: 0, moves: 0, awards: 0 },
    chapters,
    race: [],
    leadChanges: [],
    podium: standings.filter((r) => r.points > 0).slice(0, 3),
    standings,
    players: Object.fromEntries(standings.map((r) => [r.playerId, { name: r.name, rank: r.rank, points: r.points, byGame: [], moments: [] }])),
    timeline: [],
  }
}

type Chapter = RecapDoc['chapters'][number]
const chapter = (title: string, winners: string[], highlights: Chapter['highlights'], over = true): Chapter => ({
  gameId: `${title.toLowerCase()}-id`,
  gameType: 'some-game',
  title,
  round: 1,
  startedAt: AT,
  finishedAt: over ? AT + 30 * MIN : null,
  finishedBy: over ? 'game' : null,
  winners: winners.map((name) => ({ id: name.toLowerCase(), name })),
  highlights,
})

describe('raceSeries', () => {
  const doc = buildRecapDoc(recordedRawRecap, gameLogic)

  it('has one series per guest in the race, in standings order, each with its own colour', () => {
    const { times, series } = raceSeries(doc)
    expect(times).toEqual(doc.race.map((r) => r.at))
    expect(series.map((s) => s.name)).toEqual(doc.standings.slice(0, series.length).map((r) => r.name))
    expect(series.map((s) => s.color)).toEqual(RACE_COLORS.slice(0, series.length))
    for (const s of series) {
      expect(s.values).toHaveLength(times.length)
      expect(s.final).toBe(doc.standings.find((r) => r.playerId === s.playerId)!.points)
    }
  })

  it('is empty before anyone scored', () => {
    expect(raceSeries({ race: [], standings: [] })).toEqual({ times: [], series: [] })
  })
})

describe('valueTicks', () => {
  it('steps 1, 2 or 5 times a power of ten from 0 to past the top', () => {
    expect(valueTicks(0, 7)).toEqual([0, 2, 4, 6, 8])
    expect(valueTicks(0, 4)).toEqual([0, 1, 2, 3, 4])
    expect(valueTicks(0, 42)).toEqual([0, 20, 40, 60])
    expect(valueTicks(0, 1234)).toEqual([0, 500, 1000, 1500])
  })

  it('covers negative totals and a race where nobody scored', () => {
    expect(valueTicks(-3, 7)).toEqual([-5, 0, 5, 10])
    expect(valueTicks(0, 0)).toEqual([0, 1])
  })
})

describe('timeTicks', () => {
  it('falls on whole steps of the clock', () => {
    const from = new Date(2026, 10, 28, 19, 7).getTime()
    const ticks = timeTicks(from, from + 5 * 60 * MIN, 6)
    expect(ticks.length).toBeGreaterThan(0)
    expect(ticks.length).toBeLessThanOrEqual(6)
    for (const t of ticks) {
      expect(t).toBeGreaterThanOrEqual(from)
      expect(new Date(t).getMinutes()).toBe(0)
    }
    expect(new Date(ticks[0]).getHours()).toBe(20)
  })

  it('uses finer steps for a short stretch, and none for an empty one', () => {
    const from = new Date(2026, 10, 28, 21, 2).getTime()
    const ticks = timeTicks(from, from + 40 * MIN, 5)
    expect(ticks.map((t) => new Date(t).getMinutes())).toEqual([10, 20, 30, 40])
    expect(timeTicks(from, from, 5)).toEqual([])
  })
})

describe('movedOnSince', () => {
  const row = (at: number, kind: string) => ({
    id: at,
    at,
    kind,
    game_id: null,
    game_type: null,
    round: null,
    actor: 'host' as const,
    player_id: null,
    about: [],
    data: {},
  })

  it('is true once something the recap shows happened after it was built', () => {
    expect(movedOnSince({ log: [row(10, 'game.started'), row(20, 'points.awarded')] }, 15)).toBe(true)
    expect(movedOnSince({ log: [row(10, 'game.started'), row(20, 'points.awarded')] }, 20)).toBe(false)
  })

  it('ignores its own Publish, the TV and its sound, the pairing and a prompt closing', () => {
    const log = [
      row(10, 'game.finished'),
      row(20, 'recap.published'),
      row(21, 'session.tv_scene'),
      row(22, 'stage.changed'),
      row(23, 'screen.paired'),
      row(24, 'prompt.closed'),
      row(25, 'session.sound_volume'),
    ]
    expect(movedOnSince({ log }, 10)).toBe(false)
  })

  it('ignores a guest adding, changing or removing their photo', () => {
    expect(movedOnSince({ log: [row(10, 'game.finished'), row(20, 'player.photo_changed')] }, 10)).toBe(false)
  })

  it('works on a recorded night', () => {
    const last = Math.max(...recordedRawRecap.log.map((e) => e.at))
    expect(movedOnSince(recordedRawRecap, last)).toBe(false)
    expect(movedOnSince(recordedRawRecap, last - 60_000)).toBe(true)
  })
})

describe('failedNightRead', () => {
  const night = { at: 1 }

  it('keeps the night on screen, with no error, when a quiet re-read fails', () => {
    expect(failedNightRead({ attempt: 0, raw: night, error: null }, 1, true, 'Failed to fetch')).toEqual({ attempt: 1, raw: night, error: null })
  })

  it('shows the error of a quiet re-read that took over the first read, instead of an endless loader', () => {
    expect(failedNightRead<typeof night>(null, 1, true, 'Failed to fetch')).toEqual({ attempt: 1, raw: null, error: 'Failed to fetch' })
    expect(failedNightRead<typeof night>({ attempt: 1, raw: null, error: 'Not signed in' }, 2, true, 'Failed to fetch')).toEqual({
      attempt: 2,
      raw: null,
      error: 'Failed to fetch',
    })
  })

  it('shows the error of a Rebuild, over the night it keeps', () => {
    expect(failedNightRead({ attempt: 0, raw: night, error: null }, 1, false, 'Failed to fetch')).toEqual({ attempt: 1, raw: night, error: 'Failed to fetch' })
  })
})

describe('opening the recap page', () => {
  it('holds the loader until the night is in, so the page goes from the loader straight to the night', () => {
    expect(recapScreen({ raw: null, error: null })).toBe('loader')
    expect(recapScreen({ raw: { at: 1 }, error: null })).toBe('page')
    // Its read gave up: the page says so, with Try again.
    expect(recapScreen({ raw: null, error: 'Failed to fetch' })).toBe('page')
  })

  it('tries the read on arrival again after a blip, so it never opens on "The night couldn\'t be read"', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValueOnce('the night')
    const sleep = vi.fn(async () => {})
    await expect(retried(read, ARRIVAL_RETRIES_MS, () => false, sleep)).resolves.toBe('the night')
    expect(sleep).toHaveBeenCalledWith(1000)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('gives up after its last wait with the last error, or at once when the page has moved on', async () => {
    const gone = new Error('Only hosts can read this')
    const read = vi.fn().mockRejectedValue(gone)
    const sleep = vi.fn(async () => {})
    await expect(retried(read, ARRIVAL_RETRIES_MS, () => false, sleep)).rejects.toBe(gone)
    expect(read).toHaveBeenCalledTimes(ARRIVAL_RETRIES_MS.length + 1)
    expect(sleep.mock.calls).toEqual([[1000], [2000]])
    read.mockClear()
    await expect(retried(read, ARRIVAL_RETRIES_MS, () => true, sleep)).rejects.toBe(gone)
    expect(read).toHaveBeenCalledTimes(1)
  })
})

describe('nightHeadline', () => {
  it('cheers the winner of a night that is over, and says by how much', () => {
    expect(nightHeadline(nightOf({ Lea: 18, Hanne: 12, Jonas: 12, Bo: 1 }, [chapter('Quiz', ['Lea'], [])]))).toEqual({
      title: 'Hurra for Lea',
      line: 'Lea took the night with 18 points, 6 points ahead of Hanne and Jonas.',
    })
  })

  it('cheers everyone tied first, and keeps to the present while a round still runs', () => {
    expect(nightHeadline(nightOf({ Ana: 7, Bo: 7, Cy: 2 }))).toEqual({ title: 'Hurra for Ana and Bo', line: 'Ana and Bo share the night with 7 points each.' })
    const running = [chapter('Quiz', [], [], false)]
    expect(nightHeadline(nightOf({ Ana: 1, Bo: 0 }, running))).toEqual({ title: 'Ana leads the night', line: '1 point so far.' })
    expect(nightHeadline(nightOf({ Ana: 3, Bo: 3 }, running)).title).toBe('Ana and Bo lead the night')
  })

  it('waits for the first points', () => {
    expect(nightHeadline(nightOf({ Ana: 0, Bo: 0 })).title).toBe('The night is young')
    expect(nightHeadline(nightOf({ Ana: 0 }, [chapter('Quiz', [], [], false)])).line).toBe('Nobody has scored yet.')
  })
})

describe('podiumPlaces', () => {
  const placed = (doc: RecapDoc) => podiumPlaces(doc).map((p) => [p.row.name, p.place, p.step])

  it('puts the top three on the first, second and third steps, in place order', () => {
    expect(placed(nightOf({ Ana: 18, Bo: 12, Cy: 5, Dee: 1 }))).toEqual([
      ['Ana', 1, 0],
      ['Bo', 2, 1],
      ['Cy', 3, 2],
    ])
  })

  it('crowns everyone tied first on the top step, as the TV does, and shares the second step in a tie for second', () => {
    expect(placed(fixtureRecapDoc())).toEqual([
      ['Bo', 1, 0],
      ['Freja', 1, 0],
      ['Maja', 1, 0],
    ])
    expect(placed(nightOf({ Ana: 18, Bo: 12, Cy: 12 }))).toEqual([
      ['Ana', 1, 0],
      ['Bo', 2, 1],
      ['Cy', 2, 1],
    ])
    expect(podiumPlaces(nightOf({ Ana: 0 }))).toEqual([])
  })
})

describe('nightAwards', () => {
  const doc = nightOf({ Lea: 18, Hanne: 12, Jonas: 12, Gus: 7, Karla: 3, Cy: 1 }, [
    chapter('Quiz', ['Gus'], [
      { title: 'Gus won the quiz', detail: '3,251 quiz points', players: ['gus'], icon: 'crown', tone: 'gold', weight: 'headline' },
      { title: 'Fastest right answer: Hanne', detail: '0.8 s on question 1', players: ['hanne'], icon: 'lightning', tone: 'teal', weight: 'highlight' },
      { title: 'Hardest question: “Which dish?”', detail: '3 of 6 knew', icon: 'target', tone: 'pink', weight: 'highlight' },
    ]),
    chapter('Last one standing', ['Lea'], [
      { title: 'Top hunter: Jonas', detail: '5 knockouts', players: ['jonas'], icon: 'sword', tone: 'pink', weight: 'highlight' },
      { title: 'First out: Hanne', detail: 'Jonas caught them', players: ['hanne', 'jonas'], icon: 'skull', tone: 'red', weight: 'line' },
    ]),
    chapter('Fusion', ['Lea'], [
      { title: 'Best disguise: Picture 4 fooled the room', detail: 'Nobody saw Karla and Cy', players: ['karla', 'cy'], icon: 'detective', tone: 'violet', weight: 'highlight' },
    ]),
    chapter('Beer pong', [], [{ title: 'Still running', detail: 'Leading so far: Gus with 2', players: ['gus'], weight: 'headline' }], false),
  ])
  const awards = nightAwards(doc)

  it("crowns every finished round's winners, with what their game said about them", () => {
    expect(awards.filter((a) => a.crown).map((a) => [a.label, a.title, a.detail])).toEqual([
      ['Won Quiz', 'Gus', '3,251 quiz points'],
      ['Won Last one standing', 'Lea', undefined],
      ['Won Fusion', 'Lea', undefined],
    ])
  })

  it('turns the highlights that name guests into awards, labelled by what comes before their names', () => {
    expect(awards.filter((a) => !a.crown).map((a) => [a.label, a.title, a.icon, a.tone, a.players.map((p) => p.name)])).toEqual([
      ['Fastest right answer', 'Hanne', 'lightning', 'teal', ['Hanne']],
      ['Top hunter', 'Jonas', 'sword', 'pink', ['Jonas']],
      // A sentence stays whole, under its game's title.
      ['Fusion', 'Best disguise: Picture 4 fooled the room', 'detective', 'violet', ['Karla', 'Cy']],
    ])
    expect(awards.find((a) => a.label === 'Top hunter')?.chapter).toEqual({ gameId: 'last one standing-id', gameType: 'some-game', title: 'Last one standing', round: 1 })
  })

  it('leaves out minor lines, highlights about nobody, and rounds still running', () => {
    const titles = awards.map((a) => a.title)
    expect(titles.some((t) => t.startsWith('First out') || t.startsWith('Hardest') || t === 'Still running')).toBe(false)
    expect(awards.some((a) => a.label.startsWith('Won Beer pong'))).toBe(false)
  })

  it('works on recorded nights, the climber included', () => {
    const recorded = nightAwards(buildRecapDoc(recordedRawRecap, gameLogic))
    expect(recorded.map((a) => [a.label, a.title])).toEqual([
      ['Won Beer pong', 'Ana'],
      ['Won Lab quiz', 'Ana, Dee and Finn'],
      ['Biggest climber', 'Bo'],
    ])
    expect(recorded[2].detail).toMatch(/^From 3rd to 1st in the race since \d\d:\d\d$/)
    expect(nightAwards(fixtureRecapDoc()).map((a) => a.label)).toEqual([
      'Won Last one standing',
      'Won Quiz',
      'Won Who is fused?',
      'Won Beer pong',
      'Top hunter',
      'Fastest right answer',
    ])
  })

  it('names a guest who left from a round they won or a lead they took, and gives one it cannot name no face', () => {
    // Jonas, Kim and Hanne left: the standings no longer have them.
    const left = nightOf({ Lea: 18, Bo: 3 }, [
      chapter('Last one standing', ['Jonas'], [
        { title: 'Top hunter: Jonas', detail: '5 knockouts', players: ['jonas'], icon: 'sword', tone: 'pink', weight: 'highlight' },
      ]),
      chapter('Quiz', ['Lea'], [
        { title: 'Fastest right answer: Kim', players: ['kim'], icon: 'lightning', tone: 'teal', weight: 'highlight' },
        { title: 'Slowest right answer: Hanne', players: ['hanne'], icon: 'target', tone: 'violet', weight: 'highlight' },
        { title: 'Best team: Lea and Hanne', players: ['lea', 'hanne'], icon: 'star', weight: 'highlight' },
      ]),
    ])
    const doc = { ...left, leadChanges: [{ at: AT, playerId: 'kim', name: 'Kim' }] }
    expect(nightAwards(doc).filter((a) => !a.crown).map((a) => [a.label, a.title, a.players.map((p) => p.name)])).toEqual([
      ['Top hunter', 'Jonas', ['Jonas']],
      ['Fastest right answer', 'Kim', ['Kim']],
      // Nothing in the doc names Hanne: the game's sentence stays whole, under its title, and only Lea has a face.
      ['Quiz', 'Slowest right answer: Hanne', []],
      ['Quiz', 'Best team: Lea and Hanne', ['Lea']],
    ])
  })
})

describe('chapterStory', () => {
  it("puts the winners' line in their game's own words, and every other highlight after it, headlines first", () => {
    const story = chapterStory(
      chapter('Last one standing', ['Lea'], [
        { title: 'First out: Hanne', detail: 'Jonas caught them', players: ['hanne', 'jonas'], weight: 'line' },
        { title: 'Lea was the last one standing', detail: '3 knockouts', players: ['lea'], weight: 'headline' },
        { title: 'Top hunter: Jonas', detail: '5 knockouts', players: ['jonas'], weight: 'highlight' },
      ]),
    )
    expect(story.winners).toEqual({ title: 'Lea was the last one standing', detail: '3 knockouts' })
    expect(story.highlights.map((h) => h.title)).toEqual(['Top hunter: Jonas', 'First out: Hanne'])
  })

  it('says "won" for a game without words of its own, and leaves out the generic line', () => {
    const story = chapterStory(chapter('Lab quiz', ['Ana', 'Dee'], [{ title: 'Ana and Dee won Lab quiz', players: ['ana', 'dee'], weight: 'headline' }]))
    expect(story).toEqual({ winners: { title: 'Ana and Dee won Lab quiz' }, highlights: [] })
    expect(chapterStory(chapter('Lab quiz', ['Ana'], [])).winners).toEqual({ title: 'Ana won' })
  })

  it('has no winners line for a round still running', () => {
    const story = chapterStory(chapter('Quiz', [], [{ title: 'Still running', detail: 'Leading so far: Bo with 3', weight: 'headline' }], false))
    expect(story).toEqual({ winners: null, highlights: [{ title: 'Still running', detail: 'Leading so far: Bo with 3', weight: 'headline' }] })
  })
})

describe('biggestClimber', () => {
  const standings = [
    { playerId: 'a', name: 'Ana', points: 9, rank: 1 },
    { playerId: 'b', name: 'Bo', points: 8, rank: 2 },
    { playerId: 'c', name: 'Cy', points: 4, rank: 3 },
    { playerId: 'd', name: 'Dee', points: 3, rank: 4 },
  ]
  const sample = (minutes: number, a: number, b: number, c: number, d: number) => ({ at: AT + minutes * MIN, totals: { a, b, c, d } })

  it('finds who climbed most places after halfway, from the last moment at their lowest place', () => {
    const race = [sample(0, 0, 0, 0, 0), sample(10, 0, 5, 1, 0), sample(60, 1, 6, 4, 3), sample(70, 2, 7, 4, 3), sample(120, 9, 8, 4, 3)]
    expect(biggestClimber({ race, standings })).toEqual({ playerId: 'a', name: 'Ana', from: 4, to: 1, at: AT + 70 * MIN })
  })

  it('needs a climb of 2 places or more, and a race of 3', () => {
    const race = [sample(0, 0, 0, 0, 0), sample(60, 1, 2, 0, 0), sample(120, 9, 8, 4, 3)]
    expect(biggestClimber({ race, standings })).toBeNull()
    expect(biggestClimber({ race: [], standings })).toBeNull()
  })
})

describe('crownSpots', () => {
  it('keeps a lone lead change on its own moment', () => {
    expect(crownSpots([40, 200, 400])).toEqual([40, 200, 400])
  })

  it('fans changes close together out to the left of the latest, which stays on its moment', () => {
    expect(crownSpots([100, 105, 110, 300])).toEqual([92, 101, 110, 300])
    // A run of close changes is one spot, however long it gets.
    expect(crownSpots([0, 15, 30])).toEqual([12, 21, 30])
  })

  it('shows at most the latest three crowns of a spot', () => {
    expect(crownSpots([100, 101, 102, 103])).toEqual([null, 85, 94, 103])
  })
})

describe('crownsCaption', () => {
  it('says the crowns mark the lead changes while each has one', () => {
    expect(crownsCaption(crownSpots([40]))).toBe('The crown marks the lead change.')
    expect(crownsCaption(crownSpots([40, 200, 400]))).toBe('The crowns mark the 3 lead changes.')
  })

  it('says a line marks each once changes bunch up and only the latest keep a crown', () => {
    // Six changes 6 minutes apart in a 5 hour night, on a phone's 255 px plot: 5 px apart.
    const xs = [0, 1, 2, 3, 4, 5].map((i) => 200 + i * 5)
    expect(crownSpots(xs).filter((x) => x === null)).toHaveLength(3)
    expect(crownsCaption(crownSpots(xs))).toBe('The lead changed 6 times: a line marks each, and crowns show the latest where they bunch up.')
  })
})

describe("the room's view", () => {
  it("peeks at the TV's slides in its own order, with their times and the loop", () => {
    const doc = fixtureRecapDoc()
    const peek = tvPeek(doc)
    expect(peek.slides.map((s) => s.slide)).toEqual(recapSlides(doc))
    expect(peek.slides.map((s) => s.label)).toEqual([
      'The night in numbers',
      'The race',
      ...doc.chapters.map((c) => c.title),
      'Lead changes',
      'The podium',
    ])
    expect(peek.loopSeconds).toBe(peek.slides.reduce((sum, s) => sum + s.seconds, 0))
    expect(durationText(peek.loopSeconds)).toBe('1 min 8 s')
  })

  it('says where the TV stands with these slides, and that it still plays the published version once more has happened', () => {
    const publishedAt = new Date(2026, 10, 28, 22, 0).getTime()
    expect(tvNote({ publishedAt: null, onTv: false, behind: false })).toBe('Once published, Show on the TV plays it on a loop.')
    expect(tvNote({ publishedAt, onTv: false, behind: false })).toBe('Show on the TV plays it there.')
    expect(tvNote({ publishedAt, onTv: true, behind: false })).toBe('It is playing on the TV now.')
    expect(tvNote({ publishedAt, onTv: true, behind: true })).toBe('The TV still plays the version you published at 22:00; Update to play these slides.')
    expect(tvNote({ publishedAt, onTv: false, behind: true })).toBe('Show on the TV plays the version you published at 22:00; Update to play these slides.')
  })

  it('writes durations, places and game tones', () => {
    expect([durationText(45), durationText(60), durationText(72.4)]).toEqual(['45 s', '1 min', '1 min 12 s'])
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st'])
    const tones = gameTones({ chapters: [chapter('A', [], []), chapter('B', [], []), chapter('A', [], []), chapter('C', [], [])] })
    expect([...tones.values()]).toEqual(['gold', 'pink', 'teal'])
  })
})

describe('the rest', () => {
  it('snaps to the nearest sample', () => {
    expect(nearestIndex([0, 10, 20], 14)).toBe(1)
    expect(nearestIndex([0, 10, 20], 16)).toBe(2)
    expect(nearestIndex([0, 10, 20], -5)).toBe(0)
  })

  it('writes time spans', () => {
    const at = new Date(2026, 10, 28, 21, 5).getTime()
    expect(timeSpan(at, at + 35 * MIN)).toBe('21:05 to 21:40')
    expect(timeSpan(at, null)).toBe('21:05, still running')
  })

  it('names the download after the party and the day', () => {
    const at = new Date(2026, 10, 28, 23, 30).getTime()
    expect(downloadName("Nicolai's 30th!", at)).toBe('hurra-nicolai-s-30th-2026-11-28.json')
    expect(downloadName('Fødselsdag på Nørrebro', at)).toBe('hurra-fodselsdag-pa-norrebro-2026-11-28.json')
    expect(downloadName('???', at)).toBe('hurra-party-2026-11-28.json')
  })
})
