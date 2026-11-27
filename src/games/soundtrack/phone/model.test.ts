// Lydspor's phone rules (spec section 4): one photo per song with swaps,
// takes and Undo, the tiles' bands, the board's counts and the last call's
// missing parts, when a new song takes the phone, the keyboard's scroll, and
// the ledger of this phone's own saves.
import { describe, expect, it } from 'vitest'
import {
  answeredParts,
  bandOf,
  confirmAnswer,
  doubledPhotos,
  followsNewSong,
  IDLE_MS,
  keyboardScroll,
  missingParts,
  photoChoice,
  planPhoto,
  settleLedger,
  shownAnswer,
  TOUCH_GUARD_MS,
  type PhotoWrite,
} from './model'

/** The photos a phone shows once these writes went through, as useAnswers shows them while they are sent. */
function applyWrites(events: readonly (number | null)[], writes: readonly PhotoWrite[]): (number | null)[] {
  const next = [...events]
  for (const { n, photo } of writes) next[n - 1] = photo
  return next
}

describe('planPhoto', () => {
  // Songs 1 to 4: B, C, nothing, F (wall indices 1, 2, null, 5).
  const events = [1, 2, null, 5]

  it('does nothing for the photo the song has already', () => {
    expect(planPhoto(events, 1, 1)).toEqual({ kind: 'same' })
  })

  it('places a free photo with one write', () => {
    expect(planPhoto(events, 3, 7)).toEqual({ kind: 'place', writes: [{ n: 3, photo: 7 }] })
  })

  it('swaps with the song that has it: the other song first, then this one', () => {
    const move = planPhoto(events, 1, 5)
    expect(move).toEqual({
      kind: 'swap',
      other: 4,
      writes: [
        { n: 4, photo: 1 },
        { n: 1, photo: 5 },
      ],
      undo: [
        { n: 1, photo: 1 },
        { n: 4, photo: 5 },
      ],
    })
    if (move.kind !== 'swap') throw new Error('not a swap')
    const after = applyWrites(events, move.writes)
    expect(after).toEqual([5, 2, null, 1])
    expect(applyWrites(after, move.undo)).toEqual(events)
  })

  it('takes a photo for a song with none, leaving the other without one', () => {
    const move = planPhoto(events, 3, 2)
    expect(move.kind).toBe('take')
    if (move.kind !== 'take') throw new Error('not a take')
    expect(move.other).toBe(2)
    const after = applyWrites(events, move.writes)
    expect(after).toEqual([1, null, 2, 5])
    // Undo frees this song's photo first, so no photo is ever on two songs.
    expect(move.undo).toEqual([
      { n: 3, photo: null },
      { n: 2, photo: 2 },
    ])
    expect(applyWrites(after, move.undo)).toEqual(events)
  })

  it('a take never puts one photo on two songs between its writes', () => {
    const move = planPhoto(events, 3, 2)
    if (move.kind !== 'take') throw new Error('not a take')
    let shown = [...events]
    for (const write of move.writes) {
      shown = applyWrites(shown, [write])
      expect(doubledPhotos(shown).size).toBe(0)
    }
  })

  it('sends the event as a choice, with none for no photo', () => {
    expect(photoChoice(3)).toEqual({ choice: ['3'] })
    expect(photoChoice(null)).toEqual({ choice: ['none'] })
  })
})

describe('bandOf', () => {
  const events = [1, 2, null, 5]

  it('says Here now on the song’s own photo, Swap with n on another’s, nothing on a free one', () => {
    expect(bandOf(events, 1, 1)).toEqual({ kind: 'here' })
    expect(bandOf(events, 1, 5)).toEqual({ kind: 'swap', with: 4 })
    expect(bandOf(events, 3, 2)).toEqual({ kind: 'swap', with: 2 })
    expect(bandOf(events, 1, 9)).toBeNull()
  })

  it('works for a song not played yet on this phone', () => {
    expect(bandOf(events, 5, 1)).toEqual({ kind: 'swap', with: 1 })
  })
})

describe('doubledPhotos', () => {
  it('finds a photo on two songs (a roll back that failed)', () => {
    expect(doubledPhotos([1, 1, null, 5])).toEqual(new Map([[1, [1, 2]]]))
    expect(doubledPhotos([1, 2, null]).size).toBe(0)
  })
})

describe('answeredParts and missingParts', () => {
  const has = (n: number, part: string) => !(n === 2 && part === 'singer') && !(n === 3 && part !== 'title')

  it('counts parts answered of parts played: "11 of 15"', () => {
    expect(answeredParts(3, has)).toEqual({ answered: 6, total: 9 })
    expect(answeredParts(0, has)).toEqual({ answered: 0, total: 0 })
  })

  it('lists each missing part song by song, title, singer, event', () => {
    expect(missingParts(3, has)).toEqual([
      { n: 2, part: 'singer' },
      { n: 3, part: 'singer' },
      { n: 3, part: 'event' },
    ])
  })
})

describe('followsNewSong', () => {
  const calm = { tab: 'now' as const, typing: false, covered: false, idleMs: 30_000, fresh: true }

  it('takes Now playing as the song starts', () => {
    expect(followsNewSong(calm)).toBe(true)
    expect(followsNewSong({ ...calm, idleMs: TOUCH_GUARD_MS })).toBe(true)
  })

  it('never while a field has the focus, or a sheet or an opened row covers the page', () => {
    expect(followsNewSong({ ...calm, typing: true })).toBe(false)
    expect(followsNewSong({ ...calm, covered: true })).toBe(false)
  })

  it('waits for a guest who just touched the screen, so a tap meant for the last song isn’t moved', () => {
    expect(followsNewSong({ ...calm, idleMs: 400 })).toBe(false)
  })

  it('leaves the board alone until the guest has not touched the screen for 8 seconds', () => {
    expect(followsNewSong({ ...calm, tab: 'board', idleMs: 3000 })).toBe(false)
    expect(followsNewSong({ ...calm, tab: 'board', idleMs: IDLE_MS })).toBe(true)
  })

  it('after the song started, Now playing too follows only the 8 seconds', () => {
    expect(followsNewSong({ ...calm, fresh: false, idleMs: 3000 })).toBe(false)
    expect(followsNewSong({ ...calm, fresh: false, idleMs: IDLE_MS })).toBe(true)
  })
})

describe('keyboardScroll', () => {
  // A 390 by 844 iPhone with the keyboard up: 509 px visible.
  const view = { viewTop: 0, viewHeight: 509 }

  it('does nothing when the heading and both fields are in view', () => {
    expect(keyboardScroll({ top: 200, bottom: 450, focusTop: 300, focusBottom: 356, ...view })).toBe(0)
  })

  it('scrolls the least that puts the block 12 px above the keyboard', () => {
    // Bottom at 600: down 103, so it ends at 497.
    expect(keyboardScroll({ top: 300, bottom: 600, focusTop: 400, focusBottom: 456, ...view })).toBe(103)
  })

  it('never so far that the heading goes above 12 px from the top, unless the focused field needs it', () => {
    // The block is 520 tall: only 88 is allowed, and the focused title fits with that.
    expect(keyboardScroll({ top: 100, bottom: 620, focusTop: 300, focusBottom: 356, ...view })).toBe(88)
    // The focused singer at the bottom wins.
    expect(keyboardScroll({ top: 100, bottom: 620, focusTop: 550, focusBottom: 606, ...view })).toBe(109)
  })

  it('scrolls back up to show a heading above the screen, keeping the bottom in view', () => {
    expect(keyboardScroll({ top: -40, bottom: 260, focusTop: 100, focusBottom: 156, ...view })).toBe(-52)
  })

  it('reads the visible part where the visual viewport is, not the page', () => {
    expect(keyboardScroll({ top: 300, bottom: 700, focusTop: 600, focusBottom: 656, viewTop: 150, viewHeight: 509 })).toBe(53)
  })
})

describe('the ledger', () => {
  const coldwave = { text: 'Coldwave' }
  const cold = { text: 'Cold' }

  it('shows this phone’s save until the snapshot catches up', () => {
    const confirmed = confirmAnswer(undefined, undefined, coldwave)
    expect(shownAnswer(undefined, confirmed)).toEqual(coldwave)
    expect(shownAnswer(coldwave, confirmed)).toEqual(coldwave)
  })

  it('never shows an older save from a snapshot that is behind', () => {
    const first = confirmAnswer(undefined, undefined, cold)
    // The second save went before the snapshot showed the first.
    const second = confirmAnswer(first, undefined, coldwave)
    expect(shownAnswer(cold, second)).toEqual(coldwave)
    expect(shownAnswer(undefined, second)).toEqual(coldwave)
  })

  it('trusts the snapshot when it says something new (another phone of the guest)', () => {
    const confirmed = confirmAnswer(undefined, cold, coldwave)
    expect(shownAnswer({ text: 'Coldwaves' }, confirmed)).toEqual({ text: 'Coldwaves' })
  })

  it('shows the snapshot when nothing was saved here', () => {
    expect(shownAnswer(cold, undefined)).toEqual(cold)
  })

  it('lets a save go once the snapshot holds it, so a teammate changing it back shows (a game played in teams)', () => {
    // A teammate typed Cold; this phone changed it to Coldwave.
    const mine = { 's1.title': confirmAnswer(undefined, cold, coldwave) }
    // A snapshot still behind keeps the save; one that caught up lets it go.
    expect(settleLedger(mine, { 's1.title': cold })).toBe(mine)
    const settled = settleLedger(mine, { 's1.title': coldwave })
    expect(settled).toEqual({})
    // The teammate changes it back to Cold: the phone shows Cold, not its own older save.
    expect(shownAnswer(cold, settled['s1.title'])).toEqual(cold)
    // Without settling, the old save would hide it.
    expect(shownAnswer(cold, mine['s1.title'])).toEqual(coldwave)
  })
})
