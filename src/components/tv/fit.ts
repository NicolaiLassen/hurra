// The TV's fit logic: what fits the screen, measured in pixels, so 1 guest, 8
// and 45 all read from across the room at 1920 by 1080 and at 1440 by 900.

/**
 * How the standings board is composed for a party of this size, so it looks
 * meant at every count (docs/engine-v2.md, 7.2):
 * - `few` (1 to 3): a big podium, with a big join card beside it while
 *   joining is open; there are no rows yet.
 * - `small` (4 to 12): the podium and roomy rows, centred as one block.
 * - `medium` (13 to 27): the podium over columns of rows.
 * - `large` (28 and up): a smaller podium that stays readable, over the same rows.
 *   From 28 the regular podium would leave 1920 by 1080 room for only 24 regular
 *   rows, so a bigger party would get smaller rows than 31 guests do.
 */
export type BoardTier = 'few' | 'small' | 'medium' | 'large'

export function boardTier(players: number): BoardTier {
  if (players <= 3) return 'few'
  if (players <= 12) return 'small'
  if (players <= 27) return 'medium'
  return 'large'
}

// Row layouts, roomiest first: the first whose rows fit the space (filled top
// to bottom, in at most maxColumns columns, each at least minColumnWidth wide)
// is used. Rows have fixed heights so the fit maths holds.
export const ROW_LAYOUTS = [
  { kind: 'regular', height: 56, gap: 8, maxColumns: 4, minColumnWidth: 420 },
  { kind: 'compact', height: 40, gap: 8, maxColumns: 5, minColumnWidth: 300 },
  { kind: 'tiny', height: 32, gap: 4, maxColumns: 6, minColumnWidth: 220 },
] as const

/** Roomier rows, tried first for a small party (`small`), whose few rows would otherwise leave the screen half empty. */
export const LARGE_ROWS = { kind: 'large', height: 80, gap: 12, maxColumns: 3, minColumnWidth: 520 } as const

export type RowLayout = (typeof ROW_LAYOUTS)[number] | typeof LARGE_ROWS

/** The row layouts a tier may use, roomiest first. */
export function rowLayoutsFor(tier: BoardTier): readonly RowLayout[] {
  return tier === 'small' ? [LARGE_ROWS, ...ROW_LAYOUTS] : ROW_LAYOUTS
}

/** The space between columns (gap-x-6), in px. */
export const COLUMN_GAP = 24
/** Badges only fit beside a name in a column at least this wide (px); in a narrower one they crush it. */
export const BADGES_MIN_WIDTH = 520

/** The roomiest of `layouts` whose rows all fit `width` by `height`, with its column count. */
export function rowLayout(
  count: number,
  width: number,
  height: number,
  layouts: readonly RowLayout[] = ROW_LAYOUTS,
): { layout: RowLayout; columns: number; fits: boolean } {
  for (const layout of layouts) {
    const perColumn = Math.max(1, Math.floor((height + layout.gap) / (layout.height + layout.gap)))
    const columns = Math.ceil(count / perColumn)
    const widthColumns = Math.floor((width + COLUMN_GAP) / (layout.minColumnWidth + COLUMN_GAP))
    if (columns <= Math.min(layout.maxColumns, widthColumns)) return { layout, columns, fits: true }
  }
  // Nothing fits: the smallest rows, in as few columns as their height allows.
  const layout = layouts[layouts.length - 1]
  const perColumn = Math.max(1, Math.floor((height + layout.gap) / (layout.height + layout.gap)))
  return { layout, columns: Math.min(layout.maxColumns, Math.ceil(count / perColumn)), fits: false }
}

/** How many cards at least `minWidth` wide fit side by side in `width`, with `gap` between them. */
export function cardsThatFit(width: number, minWidth: number, gap: number): number {
  if (width <= 0) return 0
  return Math.max(0, Math.floor((width + gap) / (minWidth + gap)))
}

/**
 * How many cards, from the first, stack into `height` with `gap` between them.
 * When some don't fit they become one row of chips (`chipRow` high) under the
 * ones that do, so that row's room is kept too. Heights not measured yet (0)
 * count as fitting: the next measurement corrects them.
 */
export function cardsThatStack(heights: readonly number[], height: number, gap: number, chipRow: number): number {
  const total = (k: number) => heights.slice(0, k).reduce((sum, h) => sum + h, 0) + Math.max(0, k - 1) * gap
  if (total(heights.length) <= height) return heights.length
  for (let k = heights.length - 1; k > 0; k--) {
    if (total(k) + gap + chipRow <= height) return k
  }
  return 0
}
