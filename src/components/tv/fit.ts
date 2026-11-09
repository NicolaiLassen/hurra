// The TV's fit logic: what fits the screen, measured in pixels, so 8 guests and
// 45 both read from across the room at 1920 by 1080 and at 1440 by 900.

/** More players than this and the podium shrinks, so the list keeps rows you can read across the room. */
export const BIG_PARTY = 27

// Row layouts, roomiest first: the first whose rows fit the space (filled top
// to bottom, in at most maxColumns columns, each at least minColumnWidth wide)
// is used. Rows have fixed heights so the fit maths holds.
export const ROW_LAYOUTS = [
  { kind: 'regular', height: 56, gap: 8, maxColumns: 4, minColumnWidth: 420 },
  { kind: 'compact', height: 40, gap: 8, maxColumns: 5, minColumnWidth: 300 },
  { kind: 'tiny', height: 32, gap: 4, maxColumns: 6, minColumnWidth: 220 },
] as const

export type RowLayout = (typeof ROW_LAYOUTS)[number]

/** The space between columns (gap-x-6), in px. */
export const COLUMN_GAP = 24
/** Badges only fit beside a name in a column at least this wide (px); in a narrower one they crush it. */
export const BADGES_MIN_WIDTH = 520

/** The roomiest row layout whose rows all fit `width` by `height`, with its column count. */
export function rowLayout(count: number, width: number, height: number): { layout: RowLayout; columns: number; fits: boolean } {
  for (const layout of ROW_LAYOUTS) {
    const perColumn = Math.max(1, Math.floor((height + layout.gap) / (layout.height + layout.gap)))
    const columns = Math.ceil(count / perColumn)
    const widthColumns = Math.floor((width + COLUMN_GAP) / (layout.minColumnWidth + COLUMN_GAP))
    if (columns <= Math.min(layout.maxColumns, widthColumns)) return { layout, columns, fits: true }
  }
  // Nothing fits: the smallest rows, in as few columns as their height allows.
  const layout = ROW_LAYOUTS[ROW_LAYOUTS.length - 1]
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
