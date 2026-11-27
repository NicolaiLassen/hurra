import type { TeamWords } from '@/components/phone/team'
import { TeamSwatch } from '@/components/TeamChip'
import type { Team } from '@/lib/types'

/**
 * Over a game played in teams, under its strap: the team's swatch, "Team Gold
 * answers together." and how one answer counts, then who gave the newest
 * answer ("Ana answered for your team."). Quiet words on the ground, so the
 * game's own screen stays the thing to look at; the name carries the team,
 * the swatch is decoration (a state never rests on colour alone).
 */
export default function TeamLine({ team, words }: { team: Pick<Team, 'colour'>; words: TeamWords }) {
  return (
    <section aria-label="Your team" data-team-line="" className="flex items-start gap-2.5 text-[0.9375rem] leading-snug text-paper-2">
      <TeamSwatch team={team} className="mt-[0.3125rem] size-3.5" />
      <div className="min-w-0">
        <p>
          <strong className="font-bold text-paper">{words.head}</strong> {words.rule}
        </p>
        {words.answered && <p className="mt-1 font-semibold text-paper">{words.answered}</p>}
      </div>
    </section>
  )
}
