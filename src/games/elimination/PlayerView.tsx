import { CrownIcon, DetectiveIcon, QrCodeIcon, SkullIcon, SwordIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import SecretCard from '@/components/SecretCard'
import { Button } from '@/components/ui/button'
import KnockoutFlow from '@/games/elimination/KnockoutFlow'
import type { EliminationGame } from '@/games/elimination/logic'
import { nameFrom, roundRoster } from '@/games/elimination/roster'
import SurvivorMeter from '@/games/elimination/SurvivorMeter'
import WhoIsLeft from '@/games/elimination/WhoIsLeft'
import type { PlayerViewProps } from '@/games/types'

/** The whole game on a phone: the phone draws the card around it and its header. */
export default function PlayerView({
  player,
  players,
  publicState,
  view,
  act,
  scannedCode,
  onScanHandled,
}: PlayerViewProps<EliminationGame>) {
  const [scanning, setScanning] = useState(false)
  const nameOf = nameFrom(players)
  const { standing, total } = roundRoster(players, publicState)

  return (
    <div className="space-y-5">
      <SurvivorMeter alive={standing.length} total={total} />

      {view === undefined && <p className="py-8 text-center text-muted-foreground">Dealing tasks…</p>}

      {view?.status === 'alive' && (
        <>
          <SecretCard label="task">{view.task}</SecretCard>
          <Button size="xl" className="w-full" onClick={() => setScanning(true)}>
            <QrCodeIcon />
            Got someone? Scan their code
          </Button>
          <ul className="grid gap-2.5 text-sm text-muted-foreground">
            <li className="flex gap-2.5">
              <SwordIcon weight="duotone" className="mt-0.5 size-5 shrink-0 text-confetti-pink" />
              <span>
                <span className="font-semibold text-foreground">Tag:</span> get someone to do your task. They're out and
                their task is yours.
              </span>
            </li>
            <li className="flex gap-2.5">
              <DetectiveIcon weight="duotone" className="mt-0.5 size-5 shrink-0 text-confetti-teal" />
              <span>
                <span className="font-semibold text-foreground">Catch:</span> spot someone trying their task on you.
                They're out and you keep yours.
              </span>
            </li>
          </ul>
          {view.knockouts > 0 && (
            <p className="text-center text-sm font-semibold">You've knocked out {view.knockouts} so far.</p>
          )}
        </>
      )}

      {view?.status === 'out' && (
        <div className="space-y-4 rounded-3xl bg-destructive/10 p-6 text-center ring-1 ring-destructive/30">
          <SkullIcon weight="duotone" className="mx-auto size-16 text-destructive" />
          <div>
            <p className="text-3xl font-black">You're out</p>
            <p className="mt-2 text-muted-foreground">
              {view.method === 'catch'
                ? `${nameOf(view.by)} caught you trying “${view.task}”`
                : `${nameOf(view.by)} got you with “${view.task}”`}
            </p>
          </div>
          <p className="text-sm">
            {publicState.winner ? (
              <span className="inline-flex items-center gap-1.5">
                <CrownIcon weight="fill" className="text-primary" />
                {nameOf(publicState.winner)} is the last one standing.
              </span>
            ) : (
              `${standing.length} still standing. Cheer them on!`
            )}
            {view.knockouts > 0 && ` You knocked out ${view.knockouts} before that.`}
          </p>
        </div>
      )}

      {view?.status === 'winner' && (
        <div className="space-y-3 rounded-3xl bg-primary/15 p-6 text-center ring-1 ring-primary/40">
          <CrownIcon weight="duotone" className="mx-auto size-16 text-primary" />
          <p className="text-3xl font-black">Last one standing!</p>
          <p className="text-muted-foreground">You knocked out {view.knockouts} and nobody got you.</p>
        </div>
      )}

      {(view === null || view?.status === 'spectator') && (
        <p className="py-6 text-center text-muted-foreground">
          This round started before you joined. You'll be dealt in next time.
        </p>
      )}

      <section className="space-y-2 border-t pt-4">
        <h3 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">Players</h3>
        <WhoIsLeft players={players} publicState={publicState} meId={player.id} />
      </section>

      <KnockoutFlow
        player={player}
        players={players}
        publicState={publicState}
        view={view}
        act={act}
        scanning={scanning}
        onCloseScanner={() => setScanning(false)}
        scannedCode={scannedCode}
        onScanHandled={onScanHandled}
      />
    </div>
  )
}
