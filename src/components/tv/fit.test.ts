import { describe, expect, it } from 'vitest'
import {
  boardSplit,
  boardTier,
  cardsThatFit,
  cardsThatStack,
  fieldFit,
  LARGE_ROWS,
  LEADER_SPLITS,
  leaderColumn,
  ROW_LAYOUTS,
  rowLayout,
  rowLayoutsFor,
} from './fit'

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

describe('leaderColumn', () => {
  // A 1080p board about 760 px high: the hero 264, rows 72 with 6 between, 28 between the parts, a commentary of 42.
  const tall = { height: 760, hero: 264, row: 72, rowGap: 6, gap: 28, comment: 42, next: 5 }

  it('lists the next five under the hero, with the commentary, on a 1080p TV', () => {
    expect(leaderColumn(tall)).toEqual({ places: 5, comment: true })
  })

  it('keeps the commentary while four places fit with it, and gives its room to the places after that', () => {
    expect(leaderColumn({ ...tall, height: 690 })).toEqual({ places: 4, comment: true })
    // 1440 by 900: four places with the commentary; with less room, four without it rather than three with it.
    expect(leaderColumn({ ...tall, height: 620, hero: 220, row: 56 })).toEqual({ places: 4, comment: true })
    expect(leaderColumn({ ...tall, height: 500, hero: 220, row: 56 })).toEqual({ places: 4, comment: false })
  })

  it('lists only the places there are', () => {
    expect(leaderColumn({ ...tall, next: 2 })).toEqual({ places: 2, comment: true })
    expect(leaderColumn({ ...tall, next: 0, comment: 0 })).toEqual({ places: 0, comment: false })
  })

  it('shows every place until the column is measured', () => {
    expect(leaderColumn({ ...tall, height: 0 })).toEqual({ places: 5, comment: true })
    expect(leaderColumn({ ...tall, row: 0 })).toEqual({ places: 5, comment: true })
  })
})

describe('fieldFit', () => {
  it('fits every row when a layout does', () => {
    expect(fieldFit(18, 800, 456)).toMatchObject({ layout: { kind: 'compact' }, columns: 2, perColumn: 9, shown: 18, fits: true })
  })

  it('shows the rows that fit, less one for the line saying how many more, when even the smallest do not', () => {
    // 720p: two columns of ten tiny rows.
    const fit = fieldFit(41, 650, 386)
    expect(fit).toMatchObject({ layout: { kind: 'tiny' }, columns: 2, perColumn: 10, fits: false })
    expect(fit.shown).toBe(19)
  })
})

describe('boardSplit', () => {
  const join = { block: 272, blockWidth: 700, line: 48 }

  it('gives 24 guests the mockup: half the width for the leader, two columns of compact rows over the big join block', () => {
    const split = boardSplit({ field: 18, width: 1728, height: 760, join, gap: 32, layouts: rowLayoutsFor('medium') })
    expect(split).toMatchObject({ split: 0.5, join: 'block', fit: { layout: { kind: 'compact' }, columns: 2, fits: true } })
  })

  it('narrows the leader\'s column for 45 guests, so the field fits beside the big join block', () => {
    const split = boardSplit({ field: 39, width: 1728, height: 760, join, gap: 32, layouts: rowLayoutsFor('large') })
    expect(split).toMatchObject({ split: LEADER_SPLITS[2], join: 'block', fit: { layout: { kind: 'tiny' }, columns: 4, fits: true } })
  })

  it('swaps the big join block for its line when the field fits only beside that', () => {
    // 45 guests on 1440 by 900.
    const split = boardSplit({ field: 39, width: 1296, height: 600, join, gap: 24, layouts: rowLayoutsFor('large') })
    expect(split).toMatchObject({ join: 'line', fit: { fits: true } })
  })

  it('narrows the leader\'s column until the big join block is whole, or takes its line', () => {
    // 24 guests on 1440 by 900: the block is 640 wide, wider than half the board leaves it.
    const narrow = { block: 208, blockWidth: 640, line: 40 }
    expect(boardSplit({ field: 18, width: 1376, height: 680, join: narrow, gap: 32, layouts: rowLayoutsFor('medium') })).toMatchObject({
      split: LEADER_SPLITS[1],
      join: 'block',
    })
    expect(boardSplit({ field: 0, width: 1376, height: 680, join: narrow, gap: 32 })).toMatchObject({ split: LEADER_SPLITS[1], join: 'block' })
    expect(boardSplit({ field: 0, width: 900, height: 680, join: narrow, gap: 32 })).toMatchObject({ join: 'line' })
  })

  it('keeps the big join block with no field, and leaves it out while joining is closed', () => {
    expect(boardSplit({ field: 0, width: 1728, height: 760, join, gap: 32 })).toEqual({ split: 0.5, join: 'block', fit: null })
    expect(boardSplit({ field: 18, width: 1728, height: 760, join: null, gap: 32 })).toMatchObject({ join: null, fit: { fits: true } })
  })

  it('falls back to the narrowest column and the join line, with as many rows as fit, on a small screen', () => {
    // 45 guests on a 720p screen: the floor of 28 px leaves no room for all of them.
    const split = boardSplit({ field: 41, width: 1152, height: 460, join, gap: 24, layouts: rowLayoutsFor('large') })
    expect(split).toMatchObject({ split: LEADER_SPLITS[2], join: 'line', fit: { fits: false } })
    expect(split.fit!.shown).toBeLessThan(41)
  })
})
