import { describe, expect, it } from 'vitest'
import { cardsThatFit, cardsThatStack, rowLayout } from './fit'

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
})
