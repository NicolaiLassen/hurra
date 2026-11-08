/** One way to lay out a grid of tiles: the narrowest a column may get, a tile's height and the gap (px). */
export type GridOption = { minWidth: number; height: number; gap: number }

/**
 * Picks the first option (list them largest first) whose tiles all fit the
 * area, with its column count. When none fits, returns the last one with
 * `fits: false`, so the caller can decide what to cut.
 */
export function fitGrid<T extends GridOption>(count: number, width: number, height: number, options: readonly T[]) {
  if (options.length === 0) throw new Error('fitGrid needs at least one option')
  for (const [i, option] of options.entries()) {
    const columns = Math.max(1, Math.floor((width + option.gap) / (option.minWidth + option.gap)))
    const rows = Math.ceil(count / columns)
    const needed = rows * option.height + Math.max(0, rows - 1) * option.gap
    const fits = needed <= height
    if (fits || i === options.length - 1) return { option, columns, rows, fits }
  }
  throw new Error('unreachable')
}
