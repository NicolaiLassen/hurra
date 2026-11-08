import { describe, expect, it } from 'vitest'
import { fitGrid } from '@/lib/fitGrid'

const big = { name: 'big', minWidth: 160, height: 152, gap: 12 }
const chip = { name: 'chip', minWidth: 200, height: 52, gap: 8 }

describe('fitGrid', () => {
  it('keeps the biggest tiles when they fit', () => {
    // 8 players, 1424px wide: 8 columns, 1 row of 152px.
    expect(fitGrid(8, 1424, 600, [big, chip])).toMatchObject({ option: big, columns: 8, rows: 1, fits: true })
  })

  it('steps down when the rows would run off the bottom', () => {
    // 45 players: big tiles need 6 rows (972px) in 600px; chips take 6 columns and 8 rows (472px).
    expect(fitGrid(45, 1424, 600, [big, chip])).toMatchObject({ option: chip, columns: 6, rows: 8, fits: true })
  })

  it('counts the gap between columns, not after the last one', () => {
    // Exactly 2 columns of 160 with a 12px gap fit in 332px.
    expect(fitGrid(2, 332, 200, [big]).columns).toBe(2)
    expect(fitGrid(2, 331, 200, [big]).columns).toBe(1)
  })

  it('returns the smallest option, marked as not fitting, when nothing fits', () => {
    expect(fitGrid(200, 400, 300, [big, chip])).toMatchObject({ option: chip, fits: false })
  })

  it('always has at least one column', () => {
    expect(fitGrid(3, 50, 1000, [big]).columns).toBe(1)
  })
})
