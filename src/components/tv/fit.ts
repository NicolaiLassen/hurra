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

// The leader's board (docs/identity.md, The standings): the leader as a hero
// with the next places under it in the leader's column, and everyone else, the
// field, in rows beside it, with the join block under the field while joining
// is open. Both columns are measured, so 1 guest and 45 read from across the
// room on a 1080p TV and still fit a 1440 by 900 or 720p screen.

/** The space between the leader's column and the field (gap-16), in px. */
export const SPLIT_GAP = 64

/**
 * The leader's column's share of the board's width, widest first: the first
 * that leaves the field room for all its rows is used, so a big party gets
 * a narrower leader's column and more columns of rows.
 */
export const LEADER_SPLITS = [0.5, 0.44, 0.38] as const

/** The places the leader's column lists under the hero at most: the next five. */
export const NEXT_PLACES = 5

/**
 * How many of the `next` places stand in rows under the hero, in a column
 * `height` high, and whether the commentary still fits under them. The
 * commentary keeps its line while at least four of the places (or all of
 * them, when fewer) fit with it; otherwise the places take its room. Heights
 * not measured yet (0) show every place, and the next measurement corrects them.
 */
export function leaderColumn({
  height,
  hero,
  row,
  rowGap,
  gap,
  comment,
  next,
}: {
  /** The column's height, px. */
  height: number
  /** The hero's height, px. */
  hero: number
  /** One place's row and the space between rows, px. */
  row: number
  rowGap: number
  /** The space between the hero, the rows and the commentary, px. */
  gap: number
  /** The commentary's height, px; 0 without one. */
  comment: number
  /** The places there are to list (at most NEXT_PLACES). */
  next: number
}): { places: number; comment: boolean } {
  if (height <= 0 || hero <= 0 || row <= 0) return { places: next, comment: comment > 0 }
  const rowsIn = (room: number) => (room < row ? 0 : Math.floor((room + rowGap) / (row + rowGap)))
  const below = height - hero - gap
  if (comment > 0) {
    const withComment = Math.min(next, rowsIn(below - comment - gap))
    if (withComment >= Math.min(4, next)) return { places: withComment, comment: true }
  }
  return { places: Math.max(0, Math.min(next, rowsIn(below))), comment: false }
}

/** How the field's rows fill a box: as rowLayout, plus how many show when even the smallest rows do not all fit. */
export type FieldFit = { layout: RowLayout; columns: number; perColumn: number; shown: number; fits: boolean }

/**
 * The field's `count` rows in a box `width` by `height`: the roomiest layout
 * that fits them all (rowLayout). When none does, the smallest rows in as
 * many columns as the width allows, and as many rows as those hold, less one
 * for a line saying how many more there are: never a name cut by the edge.
 */
export function fieldFit(count: number, width: number, height: number, layouts: readonly RowLayout[] = ROW_LAYOUTS): FieldFit {
  const { layout, columns, fits } = rowLayout(count, width, height, layouts)
  const perColumnOf = (l: RowLayout) => Math.max(1, Math.floor((height + l.gap) / (l.height + l.gap)))
  if (fits) return { layout, columns, perColumn: Math.ceil(count / Math.max(1, columns)), shown: count, fits }
  const smallest = layouts[layouts.length - 1]
  const perColumn = perColumnOf(smallest)
  const widthColumns = Math.max(1, Math.floor((width + COLUMN_GAP) / (smallest.minColumnWidth + COLUMN_GAP)))
  const cols = Math.min(smallest.maxColumns, widthColumns)
  const room = perColumn * cols
  return { layout: smallest, columns: cols, perColumn, shown: count <= room ? count : Math.max(0, room - 1), fits: count <= room }
}

/**
 * The join block's two forms, measured: the QR code on paper with the code
 * (`block` high and `blockWidth` wide, which the field's column must give
 * it), or its short form, the code over the address (`line` high).
 */
export type JoinSizes = { block: number; blockWidth: number; line: number }

/**
 * Where the board splits between the leader's column and the field, and which
 * join block stands under the field (`join`, null while joining is closed):
 * the widest leader's column whose field fits over the big join block (and is
 * as wide as it), else over the join line, else the narrowest with the join
 * line and as many rows as fit (fieldFit). Without a field, the widest column
 * as wide as the big block allows.
 */
export function boardSplit({
  field,
  width,
  height,
  join,
  gap,
  layouts = ROW_LAYOUTS,
}: {
  /** Rows in the field. */
  field: number
  /** The board's width and height, px. */
  width: number
  height: number
  join: JoinSizes | null
  /** The space between the field and the join block, px. */
  gap: number
  layouts?: readonly RowLayout[]
}): { split: number; join: 'block' | 'line' | null; fit: FieldFit | null } {
  const forms = join ? (['block', 'line'] as const) : ([null] as const)
  const fieldWidth = (split: number) => Math.max(0, width - width * split - SPLIT_GAP)
  const fieldHeight = (form: 'block' | 'line' | null) => Math.max(0, height - (form && join ? join[form] + gap : 0))
  const roomFor = (form: 'block' | 'line' | null, split: number) => form !== 'block' || !join || fieldWidth(split) >= join.blockWidth
  if (field === 0) {
    const split = LEADER_SPLITS.find((s) => roomFor(forms[0], s))
    return split !== undefined ? { split, join: forms[0], fit: null } : { split: LEADER_SPLITS[LEADER_SPLITS.length - 1], join: forms[forms.length - 1], fit: null }
  }
  for (const form of forms) {
    for (const split of LEADER_SPLITS) {
      if (!roomFor(form, split)) continue
      const fit = fieldFit(field, fieldWidth(split), fieldHeight(form), layouts)
      if (fit.fits) return { split, join: form, fit }
    }
  }
  const split = LEADER_SPLITS[LEADER_SPLITS.length - 1]
  const form = forms[forms.length - 1]
  return { split, join: form, fit: fieldFit(field, fieldWidth(split), fieldHeight(form), layouts) }
}

/** How the night so far stands under a winner's colour (nightPodium). */
export type NightPodium = {
  /** The night's top three show on their steps; else only the words, the full width. */
  podium: boolean
  /** The tokens stand on the steps (92 px of the room); else a small one sits by the name on the step. */
  tokens: boolean
  /** The steps in one row (the name, this game's gain and the place, no token), when the room is short. */
  compact: boolean
  /** The steps' heights by place, first to third, px. */
  steps: [number, number, number]
}

/**
 * The night so far on a winner's screen (WinnerMoment), in `height` px under
 * the field (0 until measured): the tokens on the steps while there is room,
 * the steps in one row when the room is short, the steps' heights by place,
 * clearly different. The third hurra's promise always stays, and beside the
 * podium it takes two lines (`promiseLine` is one of them, px): in less room
 * than that the podium gives way, so the promise has the whole width for one
 * line and nothing is cut at the stage's edge.
 */
export function nightPodium(height: number, promiseLine: number): NightPodium {
  const tokens = height === 0 || height >= 260
  const room = height - (tokens ? 92 : 0)
  const compact = height > 0 && room < 150
  const least = compact ? 56 : 112
  const tallest = height > 0 ? Math.max(least, Math.min(216, room)) : 216
  const lowest = Math.max(least, Math.min(tallest - 32, Math.round(tallest * 0.55)))
  const podium = height === 0 || (height >= least && (promiseLine === 0 || height >= 2 * promiseLine))
  return { podium, tokens, compact, steps: [tallest, Math.round((tallest + lowest) / 2), lowest] }
}
