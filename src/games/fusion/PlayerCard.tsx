import { DetectiveIcon, LockKeyIcon } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { plural, type FusionGame } from '@/games/fusion/logic'
import { choiceOf, publicOf } from '@/games/fusion/view'
import type { PlayerCardProps } from '@/games/types'

/** The compact card while another game holds the phone's main card: how far your voting is, and Vote. */
export default function PlayerCard({ publicState, myAnswers, view, open }: PlayerCardProps<FusionGame>) {
  const pub = publicOf(publicState)
  if (!pub) return null
  const total = pub.pictures.length
  const voted = pub.pictures.filter((p) => choiceOf(myAnswers[p.key]) !== null).length
  const revealed = pub.pictures.filter((p) => p.revealed).length

  if (pub.phase === 'voting') {
    const done = voted === total
    return (
      <div className="flex items-center gap-3">
        <DetectiveIcon weight="duotone" className="size-7 shrink-0 text-confetti-violet" />
        <p className="min-w-0 flex-1 text-sm">
          {done ? 'All pictures voted. ' : 'Vote on the pictures: '}
          <span className="font-semibold tabular-nums">
            {voted} of {total}
          </span>{' '}
          done
        </p>
        <Button variant={done ? 'secondary' : 'default'} onClick={open}>
          {done ? 'Open' : 'Vote'}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <LockKeyIcon weight="duotone" className="size-7 shrink-0 text-confetti-violet" />
      <p className="min-w-0 flex-1 text-sm">
        {pub.phase === 'locked' ? (
          <>
            Voting is closed. <span className="font-semibold tabular-nums">{revealed}</span> of {total} revealed.
          </>
        ) : (
          <>The reveal is done.</>
        )}{' '}
        You have {plural(view?.points ?? 0, 'point')}.
      </p>
      <Button variant="secondary" onClick={open}>
        Open
      </Button>
    </div>
  )
}
