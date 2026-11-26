import { ScanIcon } from '@phosphor-icons/react'
import { Link } from 'react-router'
import Avatar from '@/components/Avatar'
import { Button } from '@/components/ui/button'
import type { InPersonGame } from '@/games/in-person/logic'
import { scorers } from '@/games/in-person/summary'
import type { HostViewProps } from '@/games/types'
import { withRanks } from '@/lib/format'

/** How many of the round's scorers the panel lists. */
const SHOWN = 5

/**
 * The round in the host control room: Scan a player (for this round), and who
 * leads this round so far, so the host knows how it stands before ending it.
 * Scan a player is the room's one gold step only while the round is on the
 * TV; beside another game on the TV (the quiz) it stays quiet, since that
 * game's next step holds the gold (docs/identity.md, The host room).
 */
export default function HostView({ session, game, players, gamePoints }: HostViewProps<InPersonGame>) {
  const rows = withRanks(scorers(gamePoints, players))
  const onTv = session.spotlight_game_id === game.id

  return (
    // grid-cols-1: one column as wide as the panel, so a long name truncates instead of widening it.
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-paper-2">Scan players' QR codes to give points for {game.title}.</p>
        <Button asChild variant={onTv ? 'default' : 'secondary'}>
          {/* The game id goes along, so the points land in this round even with two rounds live. */}
          <Link to={`/host/scan?game=${game.id}`}>
            <ScanIcon />
            Scan a player
          </Link>
        </Button>
      </div>

      <section>
        <h3 className="mb-2 text-sm font-extrabold">This round</h3>
        {rows.length === 0 ? (
          <p className="text-sm text-paper-2">No points yet.</p>
        ) : (
          <ol className="divide-y divide-rule">
            {rows.slice(0, SHOWN).map((row) => (
              <li key={row.id} className="flex items-center gap-3 py-1.5">
                <span className="tv-num w-5 text-right text-base text-paper-3">{row.rank}</span>
                <Avatar name={row.name} playerId={row.id} className="size-7" />
                <span className="min-w-0 flex-1 truncate font-bold">{row.name}</span>
                <span className="tv-num text-lg text-paper">{row.points}</span>
              </li>
            ))}
          </ol>
        )}
        {rows.length > SHOWN && <p className="mt-1 text-sm text-paper-2">and {rows.length - SHOWN} more</p>}
      </section>
    </div>
  )
}
