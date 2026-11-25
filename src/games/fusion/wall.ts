// Participant fusion's wall on the TV (docs/identity.md, Participant fusion on
// the TV): every picture at once, 1 to 40, as big as the stage allows. Pure, so
// the layout is tested at every stage size (wall.test.ts); the TV view draws
// what it says.

/** How a revealed tile carries its two people: their first names, or only their tokens where 28 px text won't fit. */
export type WallMode = 'names' | 'tokens'

export type WallLayout = {
  columns: number
  rows: number
  /** Every tile's size in px, whole, the same for all. */
  tileWidth: number
  tileHeight: number
  /** Between tiles, px. */
  gap: number
  mode: WallMode
}

/** The pictures' shape until their thumbnails are in: 4:5, a portrait print. */
export const DEFAULT_ASPECT = 0.8
/** A revealed tile prints names only from this size; under it, the two tokens carry them. */
export const NAMES_MIN_WIDTH = 132
export const NAMES_MIN_HEIGHT = 165
/** Under this stage width the gaps are three quarters as wide. */
const NARROW_STAGE = 1500
/** A thumbnail is 400 px on its long edge: it serves a tile up to 440 device pixels, the full image anything bigger. */
export const THUMB_MAX_EDGE = 440

/** The room between tiles: 24 px up to 12 pictures, 16 up to 24, 12 beyond; three quarters of that on a narrow stage. */
export function wallGap(count: number, width: number): number {
  const base = count <= 12 ? 24 : count <= 24 ? 16 : 12
  return width < NARROW_STAGE ? base * 0.75 : base
}

/**
 * The wall for `count` pictures of shape `aspect` (width over height) in a
 * stage of `width` by `height` px: for each column count, the tile that fits
 * its cell; the widest tile wins. Every tile fits, uniform, with no room kept
 * for captions (the names sit on the picture).
 */
export function wallLayout(count: number, width: number, height: number, aspect = DEFAULT_ASPECT): WallLayout {
  const gap = wallGap(count, width)
  let best = { columns: 1, rows: Math.max(1, count), width: 0 }
  if (count > 0 && width > 0 && height > 0 && aspect > 0) {
    for (let columns = 1; columns <= count; columns++) {
      const rows = Math.ceil(count / columns)
      const cellWidth = (width - (columns - 1) * gap) / columns
      const cellHeight = (height - (rows - 1) * gap) / rows
      if (cellWidth <= 0 || cellHeight <= 0) continue
      const tile = Math.min(cellWidth, cellHeight * aspect)
      if (tile > best.width) best = { columns, rows, width: tile }
    }
  }
  const tileWidth = Math.max(0, Math.floor(best.width))
  const tileHeight = Math.max(0, Math.floor(best.width / aspect))
  return {
    columns: best.columns,
    rows: best.rows,
    tileWidth,
    tileHeight,
    gap,
    mode: tileWidth >= NAMES_MIN_WIDTH && tileHeight >= NAMES_MIN_HEIGHT ? 'names' : 'tokens',
  }
}

/** Which image a wall tile draws: the thumbnail up to THUMB_MAX_EDGE device pixels on its long edge, else the full image. */
export function wallImageSize(tileLongEdge: number, dpr: number): 'thumb' | 'full' {
  return tileLongEdge * (dpr > 0 ? dpr : 1) <= THUMB_MAX_EDGE ? 'thumb' : 'full'
}

/** The label chip's text on a tile: a share of the tile's width, never under the TV's 28 px floor or over 50 px. */
export const TILE_CHIP_SIZE = 'max(28px, min(11cqw, 50px))'
/**
 * A revealed tile's names, the wall's payoff read from the sofa: a share of
 * the tile's width (35 px on the party's 268 px tiles at 1080p), never under
 * the floor or over 44 px.
 */
export const TILE_NAME_SIZE = 'max(28px, min(13cqw, 44px))'

/** Archivo's advance widths in em at 125 percent wide and weight 900, a little generous: '#', capitals, digits, lower case, space. */
const WIDE_EM = { hash: 0.86, upper: 0.86, digit: 0.74, lower: 0.66, space: 0.3 } as const

/**
 * The face of a tile's label chip: the letter chip's wide face when the label
 * fits the tile in it, else the condensed one (as "The viking" on a 40 picture
 * wall, or "#10" on a 720p one), so the label isn't cut to "#...". At the
 * chip's size on that tile (TILE_CHIP_SIZE), with its padding.
 */
export function tileChipFace(label: string, tileWidth: number): ChipFace {
  const size = Math.max(28, Math.min(0.11 * tileWidth, 50))
  const em = Array.from(label).reduce((sum, c) => {
    if (c === ' ') return sum + WIDE_EM.space
    if (c === '#') return sum + WIDE_EM.hash
    if (/\d/.test(c)) return sum + WIDE_EM.digit
    return sum + (c === c.toUpperCase() && c !== c.toLowerCase() ? WIDE_EM.upper : WIDE_EM.lower)
  }, 0.6)
  return em * size <= 0.85 * tileWidth ? 'wide' : 'condensed'
}

export type ChipFace = 'wide' | 'condensed'

/** One face for every chip on a wall, so the labels read as one set: condensed for all when any label needs it. */
export function wallChipFace(labels: readonly string[], tileWidth: number): ChipFace {
  return labels.some((label) => tileChipFace(label, tileWidth) === 'condensed') ? 'condensed' : 'wide'
}
