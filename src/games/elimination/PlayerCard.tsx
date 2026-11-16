import { CaretRightIcon, CrownIcon, QrCodeIcon, SwordIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import SecretCard from '@/components/SecretCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import KnockoutFlow from '@/games/elimination/KnockoutFlow'
import type { EliminationGame } from '@/games/elimination/logic'
import { nameFrom, roundRoster } from '@/games/elimination/roster'
import type { PlayerCardProps } from '@/games/types'

/**
 * Last one standing while another game holds the phone's main card (say, the
 * quiz): how many are left, your task behind the compact secret card, and the
 * scan, so knockouts keep happening during the quiz.
 *
 * A whole card, title and Live badge included, like the phone's generic one;
 * tapping its header opens the full view (`open`). Camera scans don't land
 * here: the phone opens the full view with them.
 */
export default function PlayerCard({ game, player, players, publicState, view, act, open }: PlayerCardProps<EliminationGame>) {
  const [scanning, setScanning] = useState(false)
  const nameOf = nameFrom(players)
  const { standing, total } = roundRoster(players, publicState)
  const count = `${standing.length} of ${total} standing`

  let status: string
  if (view === undefined) status = 'Dealing tasks…'
  else if (view?.status === 'alive') status = `You're in, ${count}`
  else if (view?.status === 'out') status = `You're out, ${count}`
  else if (view?.status === 'winner') status = "You're the last one standing!"
  else status = `Watching, ${count}`

  return (
    <Card>
      {/* grid-cols-1: the column may shrink, so a long title truncates instead of widening the card. */}
      <CardContent className="grid grid-cols-1 gap-4">
        {/* The whole header opens the full view, so the title keeps its room on a narrow phone. */}
        <button
          type="button"
          onClick={open}
          className="-m-2 flex items-center gap-3 rounded-2xl p-2 text-left transition-colors hover:bg-overlay/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span className="sr-only">Open</span>
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-confetti-pink/15 text-confetti-pink">
            <SwordIcon weight="duotone" className="size-6" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-lg leading-tight font-bold">{game.title}</span>
              <Badge className="shrink-0">Live</Badge>
            </span>
            <span className="block text-sm text-muted-foreground">
              {view?.status === 'winner' && <CrownIcon weight="fill" className="mr-1 inline text-primary" />}
              {status}
            </span>
          </span>
          <CaretRightIcon className="size-5 shrink-0 text-muted-foreground" />
        </button>

        {view?.status === 'alive' && (
          <>
            <SecretCard label="task" compact>
              {view.task}
            </SecretCard>
            <Button size="lg" className="w-full" onClick={() => setScanning(true)}>
              <QrCodeIcon />
              Got someone? Scan
            </Button>
          </>
        )}

        {view?.status === 'out' && view.by && (
          <p className="text-sm text-muted-foreground">
            {view.method === 'catch' ? `${nameOf(view.by)} caught you.` : `${nameOf(view.by)} got you.`} Cheer on the
            ones still standing!
          </p>
        )}

        {(view === null || view?.status === 'spectator') && (
          <p className="text-sm text-muted-foreground">
            This round started before you joined. You'll be dealt in next time.
          </p>
        )}
      </CardContent>

      <KnockoutFlow
        player={player}
        players={players}
        publicState={publicState}
        view={view}
        act={act}
        scanning={scanning}
        onCloseScanner={() => setScanning(false)}
      />
    </Card>
  )
}
