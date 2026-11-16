// Last one standing's TV board (tiles.ts): every guest still in stays on the
// screen, and a knocked-out guest's name keeps its room beside the word Out.
// The boards are the final screen's, measured in Chrome at three TV sizes.
import { describe, expect, it } from 'vitest'
import { OUT_REM, SQUEEZED_MIN_REM, tileLayout } from '@/games/elimination/tiles'

const REM = 16
const TV_1080 = { width: 1008, height: 652 }
const TV_900 = { width: 584, height: 528 }
const TV_720 = { width: 424, height: 348 }

const layout = (count: number, stillIn: number, board: { width: number; height: number }) =>
  tileLayout(count, stillIn, board.width, board.height, REM)
const columnWidth = (l: ReturnType<typeof layout>, board: { width: number }) => (board.width - (l.columns - 1) * l.gap) / l.columns

describe("Last one standing's TV board", () => {
  it('shows every guest of a party up to 45 on a 1080p TV, whoever is out', () => {
    for (let count = 1; count <= 45; count++) {
      for (const stillIn of [count, Math.ceil(count / 2), 1, 0]) expect(layout(count, stillIn, TV_1080).shown, `${count}, ${stillIn} in`).toBe(count)
    }
  })

  it('draws 8 guests large and 24 as tokens over their names', () => {
    expect(layout(8, 3, TV_1080)).toMatchObject({ size: 'large', squeezed: false })
    expect(layout(24, 3, TV_1080)).toMatchObject({ size: 'medium', squeezed: false })
  })

  it('keeps everyone still in on the screen while narrower columns can hold them', () => {
    for (const board of [TV_1080, TV_900, TV_720]) {
      // The mini tile's rows that fit, and the columns at the narrowest a squeezed one gets.
      const rows = Math.floor((board.height + 8) / (2.5 * REM + 8))
      const room = rows * Math.floor((board.width + 8) / (SQUEEZED_MIN_REM * REM + 8))
      for (let count = 1; count <= 45; count++) {
        for (let stillIn = 0; stillIn <= count; stillIn++) {
          expect(layout(count, stillIn, board).shown, `${board.width}: ${count}, ${stillIn} in`).toBeGreaterThanOrEqual(Math.min(stillIn, room))
        }
      }
    }
  })

  it('gives a name room beside the word Out, cutting only guests who are out', () => {
    // The final screen at 720p: the winner and 23 out. Three columns of names
    // with the word, not four of single letters; the 3 cut were out first.
    const final = layout(24, 1, TV_720)
    expect(final).toMatchObject({ size: 'mini', squeezed: true, shown: 21 })
    expect(columnWidth(final, TV_720)).toBeGreaterThanOrEqual((SQUEEZED_MIN_REM + OUT_REM) * REM)
    // Before the first knockout, nobody needs the word: the whole party, narrower.
    expect(layout(24, 24, TV_720)).toMatchObject({ shown: 24 })
  })

  it("keeps a mini tile's name its room beside the word at 45 guests", () => {
    const full = layout(45, 1, TV_1080)
    expect(full).toMatchObject({ size: 'mini', squeezed: false, shown: 45 })
    expect(columnWidth(full, TV_1080)).toBeGreaterThanOrEqual((9.5 + OUT_REM) * REM)
  })
})
