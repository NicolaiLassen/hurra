import { CaretRightIcon, DetectiveIcon } from '@phosphor-icons/react'
import { useId } from 'react'
import { SectionHead } from '@/components/phone/Strap'
import { Button } from '@/components/ui/button'
import { plural, type FusionGame } from '@/games/fusion/logic'
import { choiceOf, publicOf } from '@/games/fusion/view'
import type { PlayerCardProps } from '@/games/types'

/**
 * Fusion's section on the phone home while another game holds the main card:
 * its tab (gold while the TV shows it), how far your voting is on a row that
 * opens the full view, and an outlined Vote while pictures wait for you. Show
 * my code stays the home's one gold step.
 */
export default function PlayerCard({ game, publicState, myAnswers, view, onStage, open }: PlayerCardProps<FusionGame>) {
  const id = useId()
  const pub = publicOf(publicState)
  const total = pub?.pictures.length ?? 0
  const voted = pub?.pictures.filter((p) => choiceOf(myAnswers[p.key]) !== null).length ?? 0
  const revealed = pub?.pictures.filter((p) => p.revealed).length ?? 0
  const voting = pub?.phase === 'voting'
  const allVoted = voting && voted === total

  let status: string
  if (!pub) status = 'Getting the pictures ready…'
  else if (voting) status = allVoted ? `All pictures voted, ${voted} of ${total}` : `Vote on the pictures: ${voted} of ${total} done`
  else {
    const where = pub.phase === 'locked' ? `Voting is closed, ${revealed} of ${total} revealed.` : 'The reveal is done.'
    status = `${where} You have ${plural(view?.points ?? 0, 'point')}.`
  }

  return (
    <section aria-labelledby={id} className="grid grid-cols-1 gap-3">
      <SectionHead id={id} tab={game.title} tone={onStage ? 'air' : 'plain'} />
      <button
        type="button"
        onClick={open}
        className="flex min-h-14 w-full items-center gap-3 rounded-phone bg-overlay px-4 py-2.5 text-left transition-colors hover:bg-rule focus-visible:ring-3 focus-visible:ring-gold/50 focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1 text-[17px] leading-snug font-bold">{status}</span>
        <span className="sr-only">Open</span>
        <CaretRightIcon className="size-5 shrink-0 text-paper-2" />
      </button>
      {voting && !allVoted && (
        <Button size="xl" variant="outline" className="w-full" onClick={open}>
          <DetectiveIcon className="size-5" />
          Vote
        </Button>
      )}
    </section>
  )
}
