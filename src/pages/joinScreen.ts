// The order of the join page (docs/guest-photos.md, 6.1, and docs/guest-list.md, 6),
// free of the client, so a unit test can pin it.
import type { PlayerRow, PublicSession } from '@/lib/types'

export type Joined = { party: PublicSession; player: PlayerRow }
export type JoinScreen = { kind: 'step'; joined: Joined } | { kind: 'busy' } | { kind: 'gate' }

/** The photo step for the guest who just joined here, whatever the membership reload finds meanwhile; then the busy screen; then the gate. */
export function joinScreen(joined: Joined | null, busy: boolean): JoinScreen {
  if (joined) return { kind: 'step', joined }
  return busy ? { kind: 'busy' } : { kind: 'gate' }
}

/** What an open party's join page shows (docs/guest-list.md, 6.1). */
export type OpenScreen =
  /** The free names are loading: the app's loader. */
  | { kind: 'loading' }
  /** Who are you? with the free names. */
  | { kind: 'list'; names: string[] }
  /** You're Ana? for a name tapped on the list. */
  | { kind: 'confirm'; name: string }
  /** Today's name form; with Back to the list when the guest came from it. */
  | { kind: 'form'; backToList: boolean }

/**
 * `names` are the party's free names (undefined while they load; empty for a
 * party without a list, or when they couldn't be read), `chosen` a name tapped
 * on the list, `typing` whether the guest tapped "I'm not on the list".
 */
export function openScreen(names: readonly string[] | undefined, chosen: string | null, typing: boolean): OpenScreen {
  if (typing) return { kind: 'form', backToList: (names?.length ?? 0) > 0 }
  if (chosen !== null) return { kind: 'confirm', name: chosen }
  if (names === undefined) return { kind: 'loading' }
  if (names.length === 0) return { kind: 'form', backToList: false }
  return { kind: 'list', names: [...names] }
}

/** From this many names, Who are you? has a search. */
export const SEARCH_FROM = 9

/** The router state the phone home leaves when the host freed this phone's name (6.6). */
export type FreedState = { freed: string }

/** The name the host gave back to the list, from the join page's router state; null for any other way in. */
export function freedNameOf(state: unknown): string | null {
  const freed = state !== null && typeof state === 'object' ? (state as Partial<FreedState>).freed : undefined
  return typeof freed === 'string' && freed.trim() !== '' ? freed : null
}

/** The note on Who are you? and the name form for a phone whose name the host freed. */
export const freedNote = (name: string) => `The host gave the name ${name} back to the list. Pick your own name.`
