import { ordinal, placeOf, pointsText } from '@/components/phone/text'
import MyPhotoButton from '@/components/photos/MyPhotoButton'
import ProfileBadges from '@/components/ProfileBadges'
import type { Player, ScoreRow, Session } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * Your token and place, at the top of the phone home: the token (a button for
 * "Your photo"), then "7th, 8 points" and who is next to you, ties said in
 * words ("1 behind Felix and Luna"). The place is gold only for the leader.
 */
export default function MyPlace({ session, player, standings }: { session: Session; player: Player; standings: ScoreRow[] }) {
  const place = placeOf(standings, player.id)

  return (
    <section aria-label="Your place tonight" className="flex items-center gap-4">
      <MyPhotoButton session={session} player={player} className="size-24" badge="lg" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-paper-2">{player.name}, tonight</p>
        {place && (
          <>
            {/* Read as one sentence: "7th, 8 points, 1 behind Felix and Luna". */}
            <p className="sr-only">
              {place.rank ? `${ordinal(place.rank)}, ${pointsText(place.points)}, ${place.line}` : `No points yet, ${place.line}`}
            </p>
            <div aria-hidden>
              {place.rank ? (
                <p className="mt-0.5 flex items-baseline gap-2.5">
                  <span className={cn('text-phone-place leading-none wide', place.rank === 1 && 'text-gold')}>{ordinal(place.rank)}</span>
                  {/* Keyed by the points, so a change pops in. */}
                  <span key={place.points} className="inline-block animate-count-pop text-[1.875rem] leading-none tv-num motion-reduce:animate-none">
                    {place.points}
                  </span>
                  <span className="font-semibold text-paper-2">{place.points === 1 || place.points === -1 ? 'point' : 'points'}</span>
                </p>
              ) : (
                <p className="mt-0.5 text-phone-head leading-tight font-extrabold">No points yet</p>
              )}
              <p className="mt-1 text-[0.9375rem] font-semibold text-paper-2">{place.line}</p>
            </div>
          </>
        )}
        <ProfileBadges profile={player.profile} className="mt-2" />
      </div>
    </section>
  )
}
