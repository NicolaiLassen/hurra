// How Lydspor's TV fills the room it gets: the wall of photos and the running
// order, from measured sizes. Pure, so it is tested.

/** A wall photo's width over its height: 6 to 5, as the mockup's 233 by 194. */
export const PHOTO_ASPECT = 1.2

export type WallGrid = { columns: number; rows: number; tileWidth: number; tileHeight: number }

/** A wider grid is kept while its photos are at least this share of the largest grid's: 4 across reads as a wall. */
const WIDER = 0.95

/**
 * The wall's grid in a box of `width` by `height` px: the column count that
 * gives the largest photos at PHOTO_ASPECT, with `gap` px between them, or
 * more columns for photos almost as large (WIDER). Twelve photos in the
 * mockup's box are 4 across and 3 down.
 */
export function wallGrid(count: number, width: number, height: number, gap: number): WallGrid {
  const none = { columns: 1, rows: 1, tileWidth: 0, tileHeight: 0 }
  if (count <= 0 || width <= 0 || height <= 0) return none
  const grids = Array.from({ length: count }, (_, i) => {
    const columns = i + 1
    const rows = Math.ceil(count / columns)
    const byWidth = (width - gap * (columns - 1)) / columns
    const byHeight = ((height - gap * (rows - 1)) / rows) * PHOTO_ASPECT
    const tileWidth = Math.max(0, Math.floor(Math.min(byWidth, byHeight)))
    return { columns, rows, tileWidth, tileHeight: Math.floor(tileWidth / PHOTO_ASPECT) }
  })
  const largest = Math.max(...grids.map((grid) => grid.tileWidth))
  if (largest <= 0) return none
  // The most columns whose photos are nearly the largest, never a column that saves no row.
  const near = grids.filter((grid) => grid.tileWidth >= largest * WIDER && (grid.columns === 1 || Math.ceil(count / (grid.columns - 1)) > grid.rows))
  return near[near.length - 1]
}

/**
 * The running order's columns in `width` px: every song on one row while each
 * cell keeps `minCell` px, else as few rows as that allows, balanced so the
 * rows hold about the same number (12 songs: 6 and 6, not 8 and 4).
 */
export function orderColumns(total: number, width: number, minCell: number, gap: number): number {
  if (total <= 0) return 1
  if (width <= 0) return total
  const fit = Math.max(1, Math.floor((width + gap) / (minCell + gap)))
  const rows = Math.ceil(total / Math.min(total, fit))
  return Math.ceil(total / rows)
}
