import { describe, expect, it } from 'vitest'
import { fixtureRecapDoc } from '@/lib/fixtures'
import type { RecapDoc } from '@/lib/recap'
import {
  chapterHighlights,
  numberTiles,
  raceFrames,
  RACE_SLIDE_MS,
  recapSlides,
  shownLeadChanges,
  SLIDE_MS,
  slideKey,
  slideMs,
} from './recapSlides'

const doc = fixtureRecapDoc()

describe('recapSlides', () => {
  it('runs from the numbers through the race, every chapter and the lead changes to the podium', () => {
    const slides = recapSlides(doc)
    expect(slides.map(slideKey)).toEqual([
      'numbers',
      'race',
      ...doc.chapters.map((_, i) => `chapter-${i}`),
      'leads',
      'podium',
    ])
  })

  it('leaves out the slides a quiet night has nothing for', () => {
    const quiet: RecapDoc = { ...doc, race: [], leadChanges: [], podium: [] }
    expect(recapSlides(quiet).map((s) => s.kind)).toEqual(['numbers', ...doc.chapters.map(() => 'chapter')])
    const nobodyScored: RecapDoc = { ...doc, race: doc.race.map((r) => ({ ...r, totals: Object.fromEntries(Object.keys(r.totals).map((id) => [id, 0])) })) }
    expect(recapSlides(nobodyScored).some((s) => s.kind === 'race')).toBe(false)
  })

  it('gives the race longer than the other slides', () => {
    expect(slideMs({ kind: 'race' })).toBe(RACE_SLIDE_MS)
    expect(slideMs({ kind: 'numbers' })).toBe(SLIDE_MS)
    expect(RACE_SLIDE_MS).toBeGreaterThan(SLIDE_MS)
  })
})

describe('the race', () => {
  it('sorts every frame by total, highest first, and ends on the final standings', () => {
    const frames = raceFrames(doc)
    expect(frames).toHaveLength(doc.race.length)
    for (const frame of frames) {
      const totals = frame.rows.map((r) => r.total)
      expect(totals).toEqual([...totals].sort((a, b) => b - a))
    }
    const last = frames[frames.length - 1].rows
    expect(last[0].name).toBe(doc.standings[0].name)
    expect(last.length).toBeLessThanOrEqual(8)
  })
})

describe('the numbers', () => {
  it('always shows guests and games, the rest only when there were any', () => {
    expect(numberTiles(doc).map((t) => t.key)).toEqual(['guests', 'games', 'answers', 'moves', 'awards'])
    const noQuiz: RecapDoc = { ...doc, numbers: { guests: 1, games: 0, answers: 0, moves: 3, awards: 0 } }
    expect(numberTiles(noQuiz)).toEqual([
      { key: 'guests', value: 1, label: 'guest' },
      { key: 'games', value: 0, label: 'games played' },
      { key: 'moves', value: 3, label: 'moves' },
    ])
  })
})

describe('a chapter', () => {
  const chapter = doc.chapters[0]

  it('leaves out the line its winners already say, and puts the headline first', () => {
    const shown = chapterHighlights(chapter)
    expect(shown.map((h) => h.title)).not.toContain(`${chapter.winners.map((w) => w.name).join(' and ')} won ${chapter.title}`)
    expect(shown.length).toBeLessThanOrEqual(3)
    const lines = chapterHighlights({
      ...chapter,
      winners: [],
      highlights: [
        { title: 'A line', weight: 'line' },
        { title: 'A highlight', weight: 'highlight' },
        { title: 'The headline', weight: 'headline' },
        { title: 'Another line', weight: 'line' },
      ],
    })
    expect(lines.map((h) => h.title)).toEqual(['The headline', 'A highlight', 'A line'])
  })

  it('keeps "X is over" when nobody won: it is all the chapter has to say', () => {
    const over = chapterHighlights({ ...chapter, winners: [], highlights: [{ title: `${chapter.title} is over`, weight: 'headline' }] })
    expect(over.map((h) => h.title)).toEqual([`${chapter.title} is over`])
  })
})

describe('lead changes', () => {
  it('shows the latest ones, oldest first', () => {
    const many: RecapDoc = {
      ...doc,
      leadChanges: Array.from({ length: 9 }, (_, i) => ({ at: 9 - i, playerId: `p${i}`, name: `P${i}` })),
    }
    expect(shownLeadChanges(many, 3).map((l) => l.at)).toEqual([7, 8, 9])
  })
})
