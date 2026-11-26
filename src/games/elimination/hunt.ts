// Last one standing in words for a guest's phone (docs/identity.md, The
// hunt on a phone): where you stand, how many are left and the latest
// knockout at the time the game saved it. Only times the database holds, as
// clock times: "Clara got Frida at 22:41", never "4 min ago". Pure, so the
// words are unit-tested in hunt.test.ts.
import { clockTime } from '@/components/phone/text'
import { dealingInNow, type EliminationPlayerView, type EliminationPublicState } from '@/games/elimination/logic'
import { knockoutLine, nameFrom, roundRoster } from '@/games/elimination/roster'
import type { Player } from '@/lib/types'

/** "You're still in.", "You're out.", and so on: the section's heading for this phone's guest. */
export function huntHeading(view: EliminationPlayerView | null | undefined, publicState: EliminationPublicState | null): string {
  if (view === undefined) return 'Dealing tasks…'
  // A latecomer's plain line that they are in: they were never "still" in.
  if (view?.status === 'alive') return view.late ? "You're in." : "You're still in."
  if (view?.status === 'out') return "You're out."
  if (view?.status === 'winner') return "You're the last one standing."
  return publicState?.winner ? 'The hunt is over.' : 'You watch this round.'
}

/**
 * The line under the heading: "18 of 24 left. Clara got Frida at 22:41.", or
 * "12 of 12 left. Nobody is out yet." For a guest who is out (`meId`), who
 * got them and when, from the same feed.
 */
export function huntLine(
  players: readonly Player[],
  publicState: EliminationPublicState | null,
  view: EliminationPlayerView | null | undefined,
  meId: string,
): string | null {
  if (!publicState) return null
  const nameOf = nameFrom(players)
  const { standing, total } = roundRoster(players, publicState)
  const winner = publicState.winner
  const feed = Array.isArray(publicState.feed) ? publicState.feed : []

  if (view?.status === 'out') {
    const mine = feed.find((k) => k.target === meId)
    const how = `${nameOf(view.by)} ${view.method === 'catch' ? 'caught' : 'got'} you${mine ? ` at ${clockTime(mine.at)}` : ''}.`
    return winner ? `${how} ${nameOf(winner)} won.` : `${how} ${standing.length} of ${total} left.`
  }
  if (winner) return `${nameOf(winner)} won.`
  const count = `${standing.length} of ${total} left.`
  const [latest] = feed
  return latest ? `${count} ${knockoutLine(latest, nameOf)} at ${clockTime(latest.at)}.` : `${count} Nobody is out yet.`
}

/**
 * The line for a guest with no task this round (under "You watch this
 * round."): what happens next. Dealing in open means they couldn't be dealt
 * in (a freed name they took, whose round goes on without it); closed, that
 * it closed before they came. `failed`: their phone's ask to be dealt in
 * didn't get through.
 */
export function watchLine(publicState: EliminationPublicState | null, now: number, failed = false): string {
  if (failed) return "Couldn't deal you in. Check your connection and try again."
  return dealingInNow(publicState, now)
    ? "You'll be dealt in next time."
    : "Dealing in had closed when you joined. You'll be dealt in next time."
}
