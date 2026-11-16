// How Last one standing's TV board lays out its tiles (PlayerTiles in TvView):
// which size, how many columns, whether the avatars go, and how many tiles
// show. Pure, so tiles.test.ts checks the fit without a browser.
import { fitGrid } from '@/lib/fitGrid'

/**
 * How much wider (rem) the word Out at 28 px is than the method icon a one-line
 * tile used to end with. A mini or squeezed tile has no line of its own for the
 * word, so its name shares the line with it, and the tile is this much wider to
 * keep the name's room.
 */
export const OUT_REM = 2.25

// Tile sizes for the player grid, largest first (rem): the biggest one whose
// rows all fit the space left on the screen is used, so 8 players get big
// tiles and a party of 45 still fits on a 1080p TV as chips.
export const TILE_SIZES = [
  { size: 'large', minWidth: 10, height: 9.5, gap: 0.75 },
  { size: 'medium', minWidth: 7.75, height: 8, gap: 0.75 },
  { size: 'chip', minWidth: 12.5, height: 3.25, gap: 0.5 },
  { size: 'mini', minWidth: 9.5 + OUT_REM, height: 2.5, gap: 0.5 },
] as const

export type TileSize = (typeof TILE_SIZES)[number]['size']

/** The narrowest a squeezed tile column gets (rem), so a name keeps a few letters (plus OUT_REM beside the word Out). */
export const SQUEEZED_MIN_REM = 6
/** Below this column width (rem) a squeezed tile drops its avatar to give the name room (plus OUT_REM beside the word Out). */
export const AVATAR_MIN_REM = 8

/**
 * The board for `count` tiles, the first `stillIn` of them guests still in, in
 * a box of `width` by `height` px at `rem` px to the rem.
 *
 * When even the smallest tiles don't fit, it keeps the rows that do and spreads
 * everyone over more, narrower columns, so nobody still in drops off the
 * screen. But never narrower than SQUEEZED_MIN_REM, or the names have no room
 * left, and beyond the columns the guests still in need, a column also keeps
 * room for the word Out: past that the last tiles are cut, whole rows at a
 * time, and those are the players who are out (sorted last). Once a column is
 * too narrow for an avatar beside the name, the avatar goes, so the name keeps
 * its room.
 */
export function tileLayout(count: number, stillIn: number, width: number, height: number, rem: number) {
  const fit = fitGrid(
    count,
    width,
    height,
    TILE_SIZES.map((t) => ({ ...t, minWidth: t.minWidth * rem, height: t.height * rem, gap: t.gap * rem })),
  )
  const { gap } = fit.option
  if (fit.fits) return { size: fit.option.size, gap, columns: fit.columns, squeezed: false, shown: count }

  const rowsThatFit = Math.max(1, Math.floor((height + gap) / (fit.option.height + gap)))
  const outRoom = stillIn < count ? OUT_REM : 0
  const columnsAt = (minRem: number) => Math.max(1, Math.floor((width + gap) / (minRem * rem + gap)))
  const columns = Math.min(
    Math.ceil(count / rowsThatFit),
    columnsAt(SQUEEZED_MIN_REM),
    Math.max(Math.ceil(stillIn / rowsThatFit), columnsAt(SQUEEZED_MIN_REM + outRoom)),
  )
  const columnWidth = (width - (columns - 1) * gap) / columns
  return {
    size: fit.option.size,
    gap,
    columns,
    squeezed: columnWidth < (AVATAR_MIN_REM + outRoom) * rem,
    shown: Math.min(count, rowsThatFit * columns),
  }
}
