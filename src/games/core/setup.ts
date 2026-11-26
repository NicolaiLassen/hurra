// A game's readiness before it starts (GameModule.setupStatus), and the
// words each game builds its line from: "6 of 8 songs ready: 2 need a photo,
// 1 needs a caption". Pure, so every game's line is unit-tested.

/**
 * Whether a game's settings are ready to play, in one line for its row in the
 * host's Games panel: "8 pictures, all with two names", "6 of 8 songs
 * ready: 2 need a photo". Not ready makes Set up the row's next step instead
 * of Start; the host can still start a game its own check lets through.
 */
export type SetupStatus = { ready: boolean; line: string }

/** What some of a game's items still need: 2, "needs a photo", "need a photo". */
export type Need = { count: number; one: string; many: string }

/** A need in the words of a count: `need(2, 'a photo')` says "need a photo" for 2, "needs a photo" for 1. */
export const need = (count: number, what: string, many?: string): Need => ({
  count,
  one: `needs ${what}`,
  many: `need ${many ?? what}`,
})

/** "2 need a photo, 1 needs a caption": the needs with a count, in their order. */
export function needsList(needs: readonly Need[]): string {
  return needs
    .filter((n) => n.count > 0)
    .map((n) => `${n.count} ${n.count === 1 ? n.one : n.many}`)
    .join(', ')
}

/** "1 song", "8 songs". */
export const counted = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

/**
 * "6 of 8 songs ready: 2 need a photo", or "8 songs ready" when every one is.
 * `ready` counts the items with nothing left to do.
 */
export function readyLine(ready: number, total: number, noun: readonly [string, string], needs: readonly Need[]): string {
  if (ready >= total) return `${counted(total, noun[0], noun[1])} ready`
  const list = needsList(needs)
  return `${ready} of ${counted(total, noun[0], noun[1])} ready${list ? `: ${list}` : ''}`
}

/** A sentence's first letter in lower case, to follow a colon: "Add at least 2" becomes "add at least 2". */
export const lowerFirst = (text: string) => (text ? text[0].toLowerCase() + text.slice(1) : text)
