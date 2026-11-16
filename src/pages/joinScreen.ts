// The order of the join page (docs/guest-photos.md, 6.1), free of the client, so a unit test can pin it.
import type { PlayerRow, PublicSession } from '@/lib/types'

export type Joined = { party: PublicSession; player: PlayerRow }
export type JoinScreen = { kind: 'step'; joined: Joined } | { kind: 'busy' } | { kind: 'gate' }

/** The photo step for the guest who just joined here, whatever the membership reload finds meanwhile; then the busy screen; then the gate. */
export function joinScreen(joined: Joined | null, busy: boolean): JoinScreen {
  if (joined) return { kind: 'step', joined }
  return busy ? { kind: 'busy' } : { kind: 'gate' }
}
