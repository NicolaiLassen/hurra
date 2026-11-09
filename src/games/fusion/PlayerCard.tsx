import { CaretRightIcon, DetectiveIcon, LockKeyIcon } from '@phosphor-icons/react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { plural, type FusionGame } from '@/games/fusion/logic'
import { choiceOf, publicOf } from '@/games/fusion/view'
import type { PlayerCardProps } from '@/games/types'

/**
 * The compact card while another game holds the phone's main card: how far
 * your voting is, and Vote. A whole card, title and Live badge included, like
 * the phone's generic one; tapping its header opens the full view.
 */
export default function PlayerCard({ game, publicState, myAnswers, view, open }: PlayerCardProps<FusionGame>) {
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
    <Card>
      {/* grid-cols-1: the column may shrink, so a long title truncates instead of widening the card. */}
      <CardContent className="grid grid-cols-1 gap-4">
        <button
          type="button"
          onClick={open}
          className="-m-2 flex items-center gap-3 rounded-2xl p-2 text-left transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span className="sr-only">Open</span>
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-confetti-violet/15 text-confetti-violet">
            {!pub || voting ? <DetectiveIcon weight="duotone" className="size-6" /> : <LockKeyIcon weight="duotone" className="size-6" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-lg leading-tight font-bold">{game.title}</span>
              <Badge className="shrink-0">Live</Badge>
            </span>
            <span className="block text-sm text-muted-foreground tabular-nums">{status}</span>
          </span>
          <CaretRightIcon className="size-5 shrink-0 text-muted-foreground" />
        </button>
        {voting && !allVoted && (
          <Button size="lg" className="w-full" onClick={open}>
            <DetectiveIcon />
            Vote
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
