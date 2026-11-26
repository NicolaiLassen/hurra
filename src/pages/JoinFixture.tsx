// Dev builds only (docs/guest-list.md, 6.7): /join/x?fixture=guests shows Who
// are you? on a sample guest list with no network. &names=45 for a long list,
// &freed=Ana for the note a freed phone reads. A tap shows You're Ana?, and
// taking the name, or typing one, only says so in a toast. A typed name that
// matches a free one gets the offer, as the database would refuse it.
import { useCallback, useMemo, useState } from 'react'
import { foldName } from '@/lib/format'
import { fixtureFreeNames, FIXTURE_NOW, FIXTURE_SESSION_ID } from '@/lib/fixtures'
import { OnListError } from '@/lib/queries'
import { toast } from '@/lib/toast'
import type { PlayerRow, PublicSession } from '@/lib/types'
import { JoinOpen, type JoinCalls } from '@/pages/Join'

const PARTY: PublicSession = { id: FIXTURE_SESSION_ID, name: 'Birthday party', join_code: 'HURRA30', status: 'open', archived_at: null }

const samplePlayer = (name: string): PlayerRow => ({
  id: FIXTURE_SESSION_ID,
  session_id: FIXTURE_SESSION_ID,
  user_id: 'sample',
  name,
  code: 'SMPLE',
  profile: {},
  created_at: new Date(FIXTURE_NOW).toISOString(),
})

export default function JoinFixture({ count, freed }: { count: number; freed: string | null }) {
  const names = useMemo(() => fixtureFreeNames(Number.isFinite(count) ? Math.min(Math.max(count, 0), 200) : 16), [count])
  // Each sample join starts the page over, as if another phone opened it.
  const [round, setRound] = useState(0)
  const calls = useMemo<JoinCalls>(
    () => ({
      loadNames: async () => names,
      join: async (_code, typed) => {
        const listed = names.find((name) => foldName(name) === foldName(typed))
        if (listed) throw new OnListError(`"${listed}" is on the guest list. If that's you, pick it from the list.`, 409, listed)
        return samplePlayer(typed.trim())
      },
      claim: async (_code, name) => samplePlayer(name),
    }),
    [names],
  )
  const onJoined = useCallback(() => {
    toast.info('Sample party: nothing was sent')
    setRound((n) => n + 1)
  }, [])

  return (
    <JoinOpen
      key={round}
      party={PARTY}
      freed={freed}
      calls={calls}
      onClaimCode={() => toast.info('Sample party: the code form needs a real party')}
      onJoined={onJoined}
      onPartyChanged={() => {}}
    />
  )
}
