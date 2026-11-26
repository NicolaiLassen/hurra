// Lydspor's words on a phone (spec section 4): the lobby, the board, the
// sheet, the toast and the reveal, with typed text shown as typed.
import { describe, expect, it } from 'vitest'
import {
  eventLine,
  introLine,
  laterLine,
  MISSING_ASK,
  namedLine,
  nextLine,
  partLine,
  payoutLine,
  quoted,
  sheetReminder,
  soFarWords,
  songsWord,
  storyLine,
  swapToast,
} from './words'

describe('the lobby', () => {
  it('counts songs in words', () => {
    expect(songsWord(8)).toBe('Eight songs')
    expect(songsWord(1)).toBe('One song')
    expect(songsWord(13)).toBe('13 songs')
  })

  it('opens with the intro, else pairing the songs with their events', () => {
    expect(introLine('  Songs from the road. ', 8)).toBe('Songs from the road.')
    expect(introLine('', 8)).toBe('Eight songs, eight events. Pair each song with its event.')
    expect(introLine('', 8)).toBe('Eight songs, eight events. Pair each song with its event.')
    expect(introLine('', 1)).toBe('One song, one event. Pair the song with its event.')
  })

  it('says who reveals the songs', () => {
    expect(payoutLine('Mira')).toBe('Then Mira reveals each song and tells its story. Lydspor pays out on the night board.')
    expect(payoutLine('')).toBe('Then each song is revealed and its story told. Lydspor pays out on the night board.')
  })
})

describe('the board', () => {
  it('says which songs come later, and nothing once all have played', () => {
    expect(laterLine(6, 8)).toBe('Songs 7 and 8 come later.')
    expect(laterLine(7, 8)).toBe('Song 8 comes later.')
    expect(laterLine(5, 8)).toBe('Songs 6 to 8 come later.')
    expect(laterLine(8, 8)).toBeNull()
  })

  it('asks for each missing part', () => {
    expect(MISSING_ASK).toEqual({ title: 'what is it called?', singer: 'who sings it?', event: 'which event?' })
  })

  it('says what a song still needs after its photo', () => {
    expect(namedLine(5, true, true)).toBe('Song 5 is named.')
    expect(namedLine(5, false, true)).toBe('Song 5 needs its title.')
    expect(namedLine(5, true, false)).toBe('Song 5 needs its singer.')
    expect(namedLine(5, false, false)).toBe('Song 5 needs its title and singer.')
  })
})

describe('quoted', () => {
  it('quotes typed text as typed, in curly quotes', () => {
    expect(quoted('sevn feries')).toBe('“sevn feries”')
  })

  it('cuts at 40 characters with an ellipsis, counting characters, not code units', () => {
    expect(quoted('a'.repeat(41))).toBe(`“${'a'.repeat(40)}…”`)
    expect(quoted('ø'.repeat(40))).toBe(`“${'ø'.repeat(40)}”`)
  })
})

describe('the photo sheet', () => {
  it('reminds when the song started and what was typed for it', () => {
    expect(sheetReminder('21:01', 'Seven feries', 'coldwave')).toBe('Started at 21:01. You have “Seven feries” by “coldwave”.')
    expect(sheetReminder('21:01', 'Natlys', null)).toBe('Started at 21:01. You have “Natlys”.')
    expect(sheetReminder('21:01', null, 'Rosa')).toBe('Started at 21:01. You have a song by “Rosa”.')
    expect(sheetReminder('21:01', null, null)).toBe('Started at 21:01.')
  })
})

describe('the swap toast', () => {
  it('names both songs and their photos for a swap, lowest song first', () => {
    // Song 5 had C (2) and took F (5) from song 2.
    expect(swapToast({ kind: 'swap', n: 5, other: 2, photo: 5, gave: 2 })).toEqual({
      title: 'Song 2 and song 5 swapped events.',
      detail: 'Song 2 has C now, song 5 has F.',
    })
    expect(swapToast({ kind: 'swap', n: 2, other: 5, photo: 5, gave: 2 })).toEqual({
      title: 'Song 2 and song 5 swapped events.',
      detail: 'Song 2 has F now, song 5 has C.',
    })
  })

  it('says which song is left without an event after a take', () => {
    expect(swapToast({ kind: 'take', n: 5, other: 3, photo: 5, gave: null })).toEqual({
      title: 'Song 5 took F from song 3.',
      detail: 'Song 3 needs an event now.',
    })
  })
})

describe('the reveal', () => {
  it('heads up for the story', () => {
    expect(storyLine('Mira')).toBe('Mira tells the story.')
    expect(storyLine(' ')).toBe('Story time.')
  })

  it('says what the guest typed and whether it counted, for every result', () => {
    expect(partLine('exact', 'paper lanterns')).toBe('You typed “paper lanterns”.')
    expect(partLine('typo', 'Paper Lantrens')).toBe('You typed “Paper Lantrens”. Spelling forgiven.')
    expect(partLine('accepted', 'Papir Lanterner')).toBe('You typed “Papir Lanterner”. Close, the host accepted it.')
    expect(partLine('close', 'Papir Lantern')).toBe('You typed “Papir Lantern”. Close, not counted.')
    expect(partLine('wrong', 'Glass Rain')).toBe('You typed “Glass Rain”.')
    expect(partLine('none', null)).toBe('No answer.')
  })

  it('says which photo the guest had when it wasn’t right', () => {
    expect(eventLine('right', 1)).toBeNull()
    expect(eventLine('wrong', 5)).toBe('You had photo F.')
    expect(eventLine('doubled', 1)).toBe('You had photo B on two songs, so it counts on neither.')
    expect(eventLine('none', null)).toBe('No answer.')
  })

  it('says what the guest has on the next song, as typed', () => {
    const mine = { event: [1, 5], title: ['Papir Lanterner', 'Sevn feries'], singer: ['Mira', 'coldwave'] }
    expect(nextLine(2, mine)).toEqual({ lead: 'Song 2 is next.', have: 'photo F, “Sevn feries” and “coldwave”' })
    const gaps = { event: [1, null], title: ['Papir Lanterner', null], singer: ['Mira', 'coldwave'] }
    expect(nextLine(2, gaps)).toEqual({ lead: 'Song 2 is next.', have: 'no photo, no title and “coldwave”' })
    expect(nextLine(2, null)).toEqual({ lead: 'Song 2 is next.', have: null })
  })

  it('gives the place only once the guest has scored', () => {
    expect(soFarWords(3, '6th')).toBe('Lydspor points so far, 6th.')
    expect(soFarWords(1, '2nd')).toBe('Lydspor point so far, 2nd.')
    expect(soFarWords(0, null)).toBe('Lydspor points so far.')
  })
})
