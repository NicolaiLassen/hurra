import { describe, expect, it } from 'vitest'
import { boardTier, cardsThatFit, cardsThatStack, LARGE_ROWS, ROW_LAYOUTS, rowLayout, rowLayoutsFor } from './fit'

describe('boardTier', () => {
  it('composes the board for the size of the party', () => {
    expect([1, 2, 3].map(boardTier)).toEqual(['few', 'few', 'few'])
    expect([4, 8, 12].map(boardTier)).toEqual(['small', 'small', 'small'])
    expect([13, 24, 27].map(boardTier)).toEqual(['medium', 'medium', 'medium'])
    expect([28, 45, 60].map(boardTier)).toEqual(['large', 'large', 'large'])
  })

  it('gives 28 guests the smaller podium, so their rows are never smaller than 31 guests get', () => {
    // 25 rows under the regular podium at 1920 by 1080 (about 392 px) need compact rows...
    expect(rowLayout(25, 1840, 392, rowLayoutsFor(boardTier(27)))).toMatchObject({ layout: { kind: 'compact' } })
    // ...while under the compact podium (about 472 px) they stay regular, as 28 rows do for 31 guests.
    expect(boardTier(28)).toBe(boardTier(31))
    expect(rowLayout(25, 1840, 472, rowLayoutsFor(boardTier(28)))).toMatchObject({ layout: { kind: 'regular' }, fits: true })
    expect(rowLayout(28, 1840, 472, rowLayoutsFor(boardTier(31)))).toMatchObject({ layout: { kind: 'regular' }, fits: true })
  })
})

describe('rowLayoutsFor', () => {
  it('offers the large rows to a small party only, roomiest first', () => {
    expect(rowLayoutsFor('small')).toEqual([LARGE_ROWS, ...ROW_LAYOUTS])
    expect(rowLayoutsFor('medium')).toEqual(ROW_LAYOUTS)
    expect(rowLayoutsFor('large')).toEqual(ROW_LAYOUTS)
  })

  it('gives a small party large rows while they fit, and the usual ones after', () => {
    // 9 rows (12 guests) at 1920 by 1080, under the podium: 3 columns of 3.
    expect(rowLayout(9, 1840, 300, rowLayoutsFor('small'))).toMatchObject({ layout: { kind: 'large' }, columns: 3, fits: true })
    // 1440 by 900 has room for 2 columns of large rows only, so 9 rows step down to regular ones.
    expect(rowLayout(9, 1376, 340, rowLayoutsFor('small'))).toMatchObject({ layout: { kind: 'regular' }, columns: 2, fits: true })
    // The same rows in a medium party's list never get the large ones.
    expect(rowLayout(9, 1840, 300, rowLayoutsFor('medium'))).toMatchObject({ layout: { kind: 'regular' }, columns: 3, fits: true })
  })
})

describe('rowLayout', () => {
  it('gives a small party the roomiest rows', () => {
    expect(rowLayout(5, 1840, 420)).toMatchObject({ layout: { kind: 'regular' }, columns: 1, fits: true })
  })

  it('steps down to smaller rows and more columns as the party grows', () => {
    // 21 rows (24 guests, 3 on the podium) at 1440 by 900: regular rows fit, until the status cards take room.
    expect(rowLayout(21, 1360, 440)).toMatchObject({ layout: { kind: 'regular' }, columns: 3, fits: true })
    expect(rowLayout(21, 1360, 300)).toMatchObject({ layout: { kind: 'compact' }, columns: 4, fits: true })
    // 42 rows (45 guests) at 1440 by 900 beside the status cards.
    expect(rowLayout(42, 1360, 414)).toMatchObject({ layout: { kind: 'tiny' }, columns: 4, fits: true })
  })

  it('says when even the smallest rows do not fit, and uses as few columns as they allow', () => {
    expect(rowLayout(60, 1360, 200)).toMatchObject({ layout: { kind: 'tiny' }, columns: 6, fits: false })
  })
})

describe('cardsThatFit', () => {
  it('counts the cards that fit side by side', () => {
    expect(cardsThatFit(848, 272, 16)).toBe(3)
    expect(cardsThatFit(560, 272, 16)).toBe(2)
    expect(cardsThatFit(271, 272, 16)).toBe(0)
    expect(cardsThatFit(0, 272, 16)).toBe(0)
  })
})

describe('cardsThatStack', () => {
  it('fits every card when they all fit, with no chip row', () => {
    expect(cardsThatStack([200, 160], 376, 16, 40)).toBe(2)
  })

  it('keeps room for the chip row when some cards must go', () => {
    // 200 + 16 + 160 = 376 > 360: one card, and the chips (16 + 40) below it.
    expect(cardsThatStack([200, 160], 360, 16, 40)).toBe(1)
    expect(cardsThatStack([200, 160], 250, 16, 40)).toBe(0)
  })

  it('counts cards not measured yet as fitting', () => {
    expect(cardsThatStack([0, 0, 0], 100, 16, 40)).toBe(3)
  })

  it('keeps the chip groups under a small party\'s join card that fit, from the top', () => {
    // 1280 by 720 leaves 152 px under the card: Now playing (60) fits, Also running (3 lines, 148) after it does not.
    expect(cardsThatStack([60, 148], 152, 16, 0)).toBe(1)
    expect(cardsThatStack([148], 152, 16, 0)).toBe(1)
    // 1440 by 900 leaves 332 px: both fit.
    expect(cardsThatStack([60, 148], 332, 16, 0)).toBe(2)
  })
})
