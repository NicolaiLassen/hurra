import { TimerIcon } from '@phosphor-icons/react'
import Callout from '@/components/Callout'
import type { SessionGame } from '@/lib/types'
import { useWakeSync } from '@/lib/wakeSync'

/**
 * The host page's backup timer (docs/engine-v2.md, 4.5 and 5.10): it sends a
 * live game's timer sync 1.5 s after its wake_at, in case the TV's didn't get
 * through. When a game's syncs keep failing, a warning says so. Mounted only
 * on the live party, never on a fixture.
 */
export default function TimerWarnings({ games }: { games: SessionGame[] }) {
  const { failing } = useWakeSync({ delayMs: 1500 })
  if (failing.length === 0) return null
  return (
    <div className="grid gap-2" role="alert">
      {failing.map(({ gameId }) => {
        const title = games.find((g) => g.id === gameId)?.title ?? 'A game'
        return (
          <Callout
            key={gameId}
            tone="red"
            icon={<TimerIcon weight="fill" />}
            title={`${title}'s timer isn't getting through.`}
            detail="Use its buttons to move on by hand."
          />
        )
      })}
    </div>
  )
}
