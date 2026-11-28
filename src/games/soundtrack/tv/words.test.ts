import { describe, expect, it } from 'vitest'
import type { SoundtrackPublicState } from '../types'
import {
  lobbyLine,
  lockedLine,
  mostPoints,
  numberWord,
  ordinal,
  revealCounts,
  revealsLine,
  runnerUpLine,
  storyLine,
  strapWords,
  topHeading,
  typedWords,
  winnerDeck,
  LAST_CALL_LINE,
  NOBODY_LINE,
  MOMENT_PLAYING_LINE,
  MOMENT_RULES,
  PLAYING_LINE,
  pointChips,
  RULES,
  rulesFor,
} from './words'

const PUB: SoundtrackPublicState = {
  phase: 'lobby',
  total: 8,
  playedAt: [],
  wall: [],
  momentTyped: false,
  points: { event: 2, title: 1, singer: 1 },
  lockAt: null,
  lockedAt: null,
  playing: 22,
  revealed: 0,
  reveal: null,
  extras: null,
  top: [],
  final: null,
  intro: '',
  storyteller: 'Ida',
}

const at = (n: number) => Array.from({ length: n }, (_, i) => 1_000 + i)

describe("Lydspor's TV words", () => {
  it('opens with the intro, else pairing the songs with their events', () => {
    expect(lobbyLine(PUB)).toBe('Eight songs, eight events. Pair each song with its event.')
    expect(lobbyLine({ ...PUB, storyteller: '' })).toBe('Eight songs, eight events. Pair each song with its event.')
    expect(lobbyLine({ ...PUB, total: 1, storyteller: '' })).toBe('One song, one event. Pair the song with its event.')
    expect(lobbyLine({ ...PUB, total: 12 })).toBe('Twelve songs, twelve events. Pair each song with its event.')
    expect(lobbyLine({ ...PUB, intro: '  Songs from a summer.  ' })).toBe('Songs from a summer.')
    expect(numberWord(13)).toBe('13')
  })

  it('names the moments in the lobby with typed moments on', () => {
    const typed = { ...PUB, momentTyped: true }
    expect(lobbyLine(typed)).toBe('Eight songs, eight moments. Name each song and its moment.')
    expect(lobbyLine({ ...typed, total: 1 })).toBe('One song, one moment. Name the song and its moment.')
    expect(rulesFor(true)).toBe(MOMENT_RULES)
    expect(rulesFor(false)).toBe(RULES)
    expect(pointChips(PUB.points).map((chip) => chip.label)).toEqual(['Event', 'Title', 'Singer'])
    expect(pointChips(PUB.points, true)).toEqual([
      { label: 'Moment', points: 2 },
      { label: 'Title', points: 1 },
      { label: 'Singer', points: 1 },
    ])
  })

  it('names the storyteller where the spec does, and gets by without one', () => {
    expect(revealsLine('Ida')).toBe('Then Ida reveals each song and tells its story.')
    expect(revealsLine(' ')).toBe('Then each song is revealed with its story.')
    expect(lockedLine('Ida')).toBe('Up first: song 1. Ida reveals the songs in order and tells each story.')
    expect(lockedLine('')).toBe('Up first: song 1. The songs are revealed in order, each with its story.')
    expect(storyLine('Ida')).toBe('Ida tells the story.')
    expect(storyLine('')).toBeNull()
  })

  it('says where the round is in the strap', () => {
    expect(strapWords(null)).toBe('Getting ready')
    expect(strapWords(PUB)).toBe('8 songs, starting soon')
    expect(strapWords({ ...PUB, total: 1 })).toBe('1 song, starting soon')
    expect(strapWords({ ...PUB, phase: 'playing', playedAt: at(5) })).toBe('Song 5 of 8')
    expect(strapWords({ ...PUB, phase: 'lastCall', playedAt: at(8) })).toBe('Last call')
    expect(strapWords({ ...PUB, phase: 'locked', playedAt: at(8) })).toBe('All 8 songs played')
    expect(strapWords({ ...PUB, phase: 'locked', playedAt: at(6) })).toBe('6 of 8 songs played')
    expect(strapWords({ ...PUB, phase: 'reveal', playedAt: at(6), revealed: 1 })).toBe('Reveal 1 of 6')
    expect(strapWords({ ...PUB, phase: 'standings', playedAt: at(8), revealed: 4 })).toBe('After reveal 4 of 8')
    expect(strapWords({ ...PUB, phase: 'done' })).toBe('Final result')
    expect(strapWords({ ...PUB, phase: 'reveal' }, true)).toBe('Final result')
  })

  it('counts the reveal of the guests who could score, with the photo by its letter', () => {
    const reveal = { counts: { event: 15, title: 18, singer: 9 }, scoring: 22, event: 1 }
    expect(revealCounts(reveal)).toEqual([
      { part: 'event', figure: '15 of 22', words: 'got the event, photo B' },
      { part: 'title', figure: '18 of 22', words: 'got the title' },
      { part: 'singer', figure: '9 of 22', words: 'got the singer' },
    ])
    expect(revealCounts({ ...reveal, scoring: 0 })).toEqual([])
    // Typed moments: the event's count is the moment's, and there is no letter.
    expect(revealCounts({ ...reveal, event: 0 }, true)[0]).toEqual({ part: 'event', figure: '15 of 22', words: 'got the moment' })
    expect(NOBODY_LINE).toBe('Nobody answered this one.')
  })

  it('heads the top 5 by the songs revealed', () => {
    expect(topHeading(4, 8)).toBe('The top 5 after 4 songs')
    expect(topHeading(1, 6)).toBe('The top 5 after 1 song')
    expect(topHeading(8, 8)).toBe('The top 5 after all 8 songs')
  })

  it('says how many have typed a title', () => {
    expect(typedWords(1)).toBe('has typed a title')
    expect(typedWords(19)).toBe('have typed a title')
  })

  it('gives the winner their points of the most there were, and who came next', () => {
    expect(mostPoints({ ...PUB, revealed: 8 })).toBe(32)
    expect(winnerDeck('Lydspor', 1, 26, 32)).toBe('Won Lydspor with 26 of 32 points.')
    expect(winnerDeck('Lydspor', 2, 26, 32)).toBe('Shared Lydspor with 26 of 32 points each.')
    expect(winnerDeck('Lydspor', 1, 1, 0)).toBe('Won Lydspor with 1 point.')
    const name = (id: string) => ({ a: 'Ana', b: 'Bo', c: 'Cy', d: 'Dag' })[id] ?? 'A guest'
    const rows = (...list: [string, number, number][]) => list.map(([playerId, points, place]) => ({ playerId, points, place }))
    expect(runnerUpLine(rows(['a', 26, 1], ['b', 24, 2], ['c', 20, 3]), name)).toEqual({ names: 'Bo', text: 'was 2nd with 24 points.' })
    expect(runnerUpLine(rows(['a', 26, 1], ['d', 26, 1], ['b', 25, 3], ['c', 25, 3]), name)).toEqual({
      names: 'Bo and Cy',
      text: 'were 3rd with 25 points.',
    })
    expect(runnerUpLine(rows(['a', 26, 1], ['b', 0, 2]), name)).toBeNull()
    expect(runnerUpLine(rows(['a', 26, 1]), name)).toBeNull()
    expect(runnerUpLine(null, name)).toBeNull()
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd'])
  })

  it('keeps the copy free of dashes and exclamation marks', () => {
    const copy = [...RULES, ...MOMENT_RULES, MOMENT_PLAYING_LINE, PLAYING_LINE, LAST_CALL_LINE, NOBODY_LINE, lockedLine('Ida'), revealsLine('Ida'), storyLine('Ida')]
    for (const line of copy) expect(line).not.toMatch(/[\u2013\u2014!]| - /)
  })
})
