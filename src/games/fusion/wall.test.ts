import { describe, expect, it } from 'vitest'
import { NAMES_MIN_HEIGHT, NAMES_MIN_WIDTH, TILE_CHIP_SIZE, TILE_NAME_SIZE, tileChipFace, wallChipFace, wallGap, wallImageSize, wallLayout } from './wall'

/** The stage each TV gives a game, with one band line and with two (docs/identity.md, The TV's frame). */
const STAGES = {
  '1080': [1728, 800],
  '1080, two lines': [1728, 732],
  '900': [1296, 666],
  '900, two lines': [1296, 606],
  '720': [1152, 504],
  '720, two lines': [1152, 444],
} as const

describe('wallLayout', () => {
  it.each(Object.entries(STAGES))('fits 1 to 40 pictures whole in the %s stage, the widest tile winning', (_, [width, height]) => {
    for (let count = 1; count <= 40; count++) {
      const wall = wallLayout(count, width, height)
      expect(wall.columns * wall.rows).toBeGreaterThanOrEqual(count)
      // Every tile fits: the columns and gaps across, the rows and gaps down.
      expect(wall.columns * wall.tileWidth + (wall.columns - 1) * wall.gap).toBeLessThanOrEqual(width)
      expect(wall.rows * wall.tileHeight + (wall.rows - 1) * wall.gap).toBeLessThanOrEqual(height)
      // No other column count gives a wider tile.
      for (let columns = 1; columns <= count; columns++) {
        const rows = Math.ceil(count / columns)
        const tile = Math.min((width - (columns - 1) * wall.gap) / columns, ((height - (rows - 1) * wall.gap) / rows) * 0.8)
        expect(Math.floor(tile)).toBeLessThanOrEqual(wall.tileWidth)
      }
      // Names only where 28 px text fits; tokens otherwise.
      expect(wall.mode).toBe(wall.tileWidth >= NAMES_MIN_WIDTH && wall.tileHeight >= NAMES_MIN_HEIGHT ? 'names' : 'tokens')
    }
  })

  // spec 7.3, aspect 4:5: [count, stage, columns, rows, tile width, tile height, mode]
  it.each([
    [2, '1080', 2, 1, 640, 800, 'names'],
    [2, '1080, two lines', 2, 1, 585, 732, 'names'],
    [2, '900', 2, 1, 532, 666, 'names'],
    [2, '720', 2, 1, 403, 504, 'names'],
    [2, '720, two lines', 2, 1, 355, 444, 'names'],
    [12, '1080', 6, 2, 268, 335, 'names'],
    [12, '900', 6, 2, 201, 251, 'names'],
    [12, '720', 6, 2, 177, 221, 'names'],
    [12, '720, two lines', 6, 2, 170, 213, 'names'],
    [24, '1080', 8, 3, 202, 252, 'names'],
    [24, '1080, two lines', 8, 3, 186, 233, 'names'],
    [24, '900', 8, 3, 151, 189, 'names'],
    [24, '720', 8, 3, 127, 159, 'tokens'],
    [24, '720, two lines', 8, 3, 111, 139, 'tokens'],
    [40, '1080', 10, 4, 152, 191, 'names'],
    [40, '1080, two lines', 10, 4, 139, 174, 'names'],
    [40, '900', 10, 4, 121, 152, 'tokens'],
    [40, '900, two lines', 10, 4, 115, 145, 'tokens'],
    [40, '720', 10, 4, 95, 119, 'tokens'],
    [40, '720, two lines', 10, 4, 83, 104, 'tokens'],
  ] as const)('%i pictures in the %s stage: %i by %i tiles of %i by %i px, %s', (count, stage, columns, rows, w, h, mode) => {
    const [width, height] = STAGES[stage]
    const wall = wallLayout(count, width, height)
    expect([wall.columns, wall.rows]).toEqual([columns, rows])
    // Within a pixel of the spec's table, which rounds where this floors.
    expect(Math.abs(wall.tileWidth - w)).toBeLessThanOrEqual(1)
    expect(Math.abs(wall.tileHeight - h)).toBeLessThanOrEqual(1)
    expect(wall.mode).toBe(mode)
  })

  it("prints the party's 12 pictures' names at every TV size", () => {
    for (const [width, height] of Object.values(STAGES)) expect(wallLayout(12, width, height).mode).toBe('names')
  })

  it('follows the pictures own shape: square pictures make square tiles', () => {
    const wall = wallLayout(12, 1728, 800, 1)
    expect(wall.tileWidth).toBe(wall.tileHeight)
  })

  it('gives nothing for no pictures or no room, without dividing by zero', () => {
    for (const wall of [wallLayout(0, 1728, 800), wallLayout(12, 0, 0)]) {
      expect(wall.tileWidth).toBe(0)
      expect(wall.tileHeight).toBe(0)
      expect(wall.mode).toBe('tokens')
    }
  })
})

describe('wallGap', () => {
  it('is 24, 16 and 12 px by the count, three quarters of that on a narrow stage', () => {
    expect([wallGap(12, 1728), wallGap(13, 1728), wallGap(24, 1728), wallGap(25, 1728)]).toEqual([24, 16, 16, 12])
    expect([wallGap(12, 1296), wallGap(24, 1152), wallGap(40, 1152)]).toEqual([18, 12, 9])
  })
})

describe('the wall text', () => {
  it('never goes under the TV floor of 28 px', () => {
    expect(TILE_CHIP_SIZE).toMatch(/^max\(28px,/)
    expect(TILE_NAME_SIZE).toMatch(/^max\(28px,/)
  })

  it('sets a label chip in the wide face where it fits the tile, else the condensed one', () => {
    // 12 pictures at 1080p: every label in the party's set fits wide, "The viking" too.
    expect(tileChipFace('#12', 268)).toBe('wide')
    expect(tileChipFace('The viking', 268)).toBe('wide')
    // 40 at 1080p: "#40" still fits, the long label doesn't.
    expect(tileChipFace('#40', 152)).toBe('wide')
    expect(tileChipFace('The viking', 152)).toBe('condensed')
    // 40 at 720p with two band lines: even "#10" is too wide for an 83 px tile.
    expect(tileChipFace('#10', 83)).toBe('condensed')
    expect(tileChipFace('#9', 83)).toBe('wide')
  })

  it('gives every chip on a wall one face: condensed for all when any label needs it', () => {
    const labels = Array.from({ length: 12 }, (_, i) => `#${i + 1}`)
    expect(wallChipFace(labels, 268)).toBe('wide')
    expect(wallChipFace([...labels, 'The viking'], 268)).toBe('wide')
    expect(wallChipFace([...labels, 'The viking'], 152)).toBe('condensed')
    expect(wallChipFace(['#1', '#9'], 83)).toBe('wide')
    expect(wallChipFace(['#9', '#10'], 83)).toBe('condensed')
  })
})

describe('wallImageSize', () => {
  it('draws the thumbnail up to 440 device pixels on the long edge, the full image past that', () => {
    expect(wallImageSize(335, 1)).toBe('thumb')
    expect(wallImageSize(440, 1)).toBe('thumb')
    expect(wallImageSize(517, 1)).toBe('full')
    expect(wallImageSize(335, 2)).toBe('full')
    // 1, 2 or 4 pictures on a 1080p TV get the full image; 6 and up the thumbnail.
    const longEdge = (count: number) => {
      const wall = wallLayout(count, 1728, 800)
      return Math.max(wall.tileWidth, wall.tileHeight)
    }
    expect([1, 2, 4, 6, 12, 40].map((count) => wallImageSize(longEdge(count), 1))).toEqual(['full', 'full', 'full', 'thumb', 'thumb', 'thumb'])
    // A device pixel ratio of 0 (unknown) counts as 1.
    expect(wallImageSize(335, 0)).toBe('thumb')
  })
})
