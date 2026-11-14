import { describe, expect, it } from 'vitest'
import { gameLogic } from '@/games/logic'
import { buildRecapDoc } from '@/lib/recap'
import { recordedRawRecap } from '@/lib/recap.recorded'
import {
  downloadName,
  failedNightRead,
  movedOnSince,
  nearestIndex,
  RACE_COLORS,
  raceSeries,
  timeSpan,
  timeTicks,
  valueTicks,
} from './recapView'

const MIN = 60_000

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

  it('ignores its own Publish, the TV, the pairing and a prompt closing', () => {
    const log = [
      row(10, 'game.finished'),
      row(20, 'recap.published'),
      row(21, 'session.tv_scene'),
      row(22, 'stage.changed'),
      row(23, 'screen.paired'),
      row(24, 'prompt.closed'),
    ]
    expect(movedOnSince({ log }, 10)).toBe(false)
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
