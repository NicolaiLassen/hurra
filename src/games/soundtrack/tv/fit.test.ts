import { describe, expect, it } from 'vitest'
import { orderColumns, PHOTO_ASPECT, wallGrid } from './fit'

describe('wallGrid', () => {
  it('puts twelve photos 4 across and 3 down in the mockup box, at about 233 by 194', () => {
    // The wall's box at 1080p: 931 px wide beside the column, the stage's 800 px tall.
    const grid = wallGrid(12, 931, 800, 16)
    expect(grid).toMatchObject({ columns: 4, rows: 3 })
    expect(grid.tileWidth).toBeGreaterThanOrEqual(215)
    expect(grid.tileHeight).toBe(Math.floor(grid.tileWidth / PHOTO_ASPECT))
  })

  it('always fits its box', () => {
    for (const count of [1, 2, 3, 5, 8, 12, 13, 16]) {
      for (const [width, height] of [
        [931, 800],
        [674, 666],
        [553, 504],
        [553, 444],
      ]) {
        const gap = 12
        const grid = wallGrid(count, width, height, gap)
        expect(grid.columns * grid.rows).toBeGreaterThanOrEqual(count)
        expect(grid.columns * grid.tileWidth + (grid.columns - 1) * gap).toBeLessThanOrEqual(width)
        expect(grid.rows * grid.tileHeight + (grid.rows - 1) * gap).toBeLessThanOrEqual(height)
        // Never a column that saves no row.
        if (grid.columns > 1) expect(Math.ceil(count / (grid.columns - 1))).toBeGreaterThan(grid.rows)
      }
    }
  })

  it('prefers the larger photos when a wider grid would shrink them much', () => {
    // 8 photos: 3 across gives 299 px, 4 across only 220.
    expect(wallGrid(8, 931, 800, 16).columns).toBe(3)
  })

  it('draws nothing before the box is measured', () => {
    expect(wallGrid(12, 0, 0, 16).tileWidth).toBe(0)
    expect(wallGrid(0, 900, 800, 16).tileWidth).toBe(0)
  })
})

describe('orderColumns', () => {
  it('keeps every song on one row while the cells keep their room', () => {
    expect(orderColumns(8, 726, 62, 10)).toBe(8)
    expect(orderColumns(8, 570, 62, 6)).toBe(8)
  })

  it('balances two rows when they do not', () => {
    expect(orderColumns(8, 400, 62, 6)).toBe(4)
    expect(orderColumns(12, 726, 62, 10)).toBe(6)
    expect(orderColumns(11, 726, 62, 10)).toBe(6)
  })

  it('shows every song before the column is measured', () => {
    expect(orderColumns(8, 0, 62, 10)).toBe(8)
    expect(orderColumns(0, 500, 62, 10)).toBe(1)
  })
})
