import { CheckCircleIcon } from '@phosphor-icons/react'
import { useContext, useState } from 'react'
import { FixtureMode } from '@/components/phone/calls'
import { teamSizeLine } from '@/components/phone/team'
import { TeamSwatch } from '@/components/TeamChip'
import { chooseTeam } from '@/lib/queries'
import { membersOf, teamsOf } from '@/lib/teams'
import { toast } from '@/lib/toast'
import type { Player, Snapshot } from '@/lib/types'
import { useLive } from '@/lib/useLive'
import { cn } from '@/lib/utils'

/**
 * Your team, on the phone home while the party has teams (docs/user-flows.md,
 * "Teams"): the party's teams as a grid of outlined tiles, each with its
 * colour, its name and how many are in it, yours marked "You're in". A tap on
 * another team switches to it (choose_team). Never gold: Show my code is the
 * home's one gold step. The home leaves it out while a game played in teams
 * is live, since nobody switches mid round; your team still shows under your
 * place.
 *
 * The tapped team shows as yours at once, until the snapshot says where you
 * are; a refusal puts it back and says why. In a fixture nothing is sent.
 */
export default function TeamPicker({ snapshot, player, className }: { snapshot: Snapshot; player: Pick<Player, 'id'>; className?: string }) {
  const fixture = useContext(FixtureMode)
  const { refresh } = useLive()
  const teams = teamsOf(snapshot)
  const current = snapshot.players.find((p) => p.id === player.id)?.team_id ?? null
  // The pick on its way: it holds only while the snapshot still has the team it was made from.
  const [wanted, setWanted] = useState<{ from: string | null; to: string } | null>(null)
  const [sending, setSending] = useState(false)
  const shown = wanted && wanted.from === current ? wanted.to : current

  async function pick(teamId: string) {
    if (sending || teamId === shown) return
    const name = teams.find((t) => t.id === teamId)?.name ?? 'that team'
    setWanted({ from: current, to: teamId })
    if (fixture) return
    setSending(true)
    try {
      await chooseTeam(teamId)
      refresh()
      toast.success(`You're in ${name}.`)
    } catch (error) {
      setWanted(null)
      toast.error(error instanceof Error ? error.message : "Couldn't switch team. Try again.")
    } finally {
      setSending(false)
    }
  }

  // How many are in each, with this guest counted where the pick puts them.
  const size = (teamId: string) => membersOf(snapshot, teamId).filter((p) => p.id !== player.id).length + (teamId === shown ? 1 : 0)

  return (
    <section aria-labelledby="your-team" className={cn('grid grid-cols-1 gap-2', className)}>
      <div>
        <h2 id="your-team" className="text-sm on-air text-paper-2">
          Your team
        </h2>
        <p className="mt-1 text-[0.9375rem] text-paper-2">
          {shown ? 'Tap another team to switch. You can switch until a team game starts.' : 'Pick the team you play with in team games.'}
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-2">
        {teams.map((team) => {
          const mine = team.id === shown
          return (
            <li key={team.id} className="min-w-0">
              <button
                type="button"
                aria-pressed={mine}
                aria-busy={(sending && mine) || undefined}
                disabled={sending && !mine}
                onClick={() => void pick(team.id)}
                className={cn(
                  'grid min-h-16 w-full grid-cols-1 content-center gap-0.5 rounded-phone border-[1.5px] px-3 py-2.5 text-left transition-colors',
                  'focus-visible:ring-3 focus-visible:ring-paper/40 focus-visible:outline-none disabled:opacity-60',
                  mine ? 'border-paper bg-overlay' : 'border-rule hover:bg-overlay',
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <TeamSwatch team={team} className="size-4" />
                  <span className="min-w-0 flex-1 truncate font-bold text-paper">{team.name}</span>
                  {mine && <CheckCircleIcon weight="fill" aria-label="You're in" className="size-5 shrink-0 text-paper" />}
                </span>
                {/* Under the name, past the swatch: the whole width left for "You and 4 more". */}
                <span className="block truncate pl-6 text-sm text-paper-2">{teamSizeLine(size(team.id), mine)}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
