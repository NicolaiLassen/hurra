import { CrownIcon, DetectiveIcon, ScanIcon, SwordIcon } from '@phosphor-icons/react'
import { useId, useState } from 'react'
import Avatar from '@/components/Avatar'
import SecretCard from '@/components/SecretCard'
import { Button } from '@/components/ui/button'
import { useDealMeIn } from '@/games/elimination/dealMeIn'
import { huntHeading, huntLine } from '@/games/elimination/hunt'
import KnockoutFlow from '@/games/elimination/KnockoutFlow'
import type { EliminationGame } from '@/games/elimination/logic'
import { nameFrom } from '@/games/elimination/roster'
import WatchLine from '@/games/elimination/WatchLine'
import WhoIsLeft from '@/games/elimination/WhoIsLeft'
import type { PlayerViewProps } from '@/games/types'

/**
 * The whole hunt on a phone (the main card, or the sheet opened from its
 * section): where you stand and the latest knockout at its time, your task
 * and the outlined Scan, how tag and catch work, and everyone dealt in with
 * Out beside the ones knocked out. The phone draws the strap above it.
 */
export default function PlayerView({
  game,
  player,
  players,
  publicState,
  view,
  act,
  serverNow,
  scannedCode,
  onScanHandled,
}: PlayerViewProps<EliminationGame>) {
  const listId = useId()
  const [scanning, setScanning] = useState(false)
  const dealing = useDealMeIn({ game, view, publicState, serverNow, act })
  const nameOf = nameFrom(players)
  const line = huntLine(players, publicState, view, player.id)
  const out = view?.status === 'out'
  const won = view?.status === 'winner'

  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="flex min-w-0 items-center gap-3.5">
        {(out || won) && <Avatar name={player.name} playerId={player.id} out={out} className="size-16 shrink-0" />}
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-phone-head leading-tight font-extrabold">
            {won && <CrownIcon weight="fill" aria-hidden className="size-6 shrink-0 text-gold" />}
            {out ? (
              <span>
                You're <span className="text-pink">out</span>.
              </span>
            ) : dealing.waiting ? (
              'Dealing you in…'
            ) : (
              huntHeading(view, publicState)
            )}
          </p>
          {line && <p className="mt-1 text-[1.0625rem] leading-snug text-paper-2">{line}</p>}
        </div>
      </div>

      {view?.status === 'alive' && (
        <>
          <div className="grid gap-3">
            <SecretCard label="task">{view.task}</SecretCard>
            <Button size="xl" variant="outline" className="w-full" onClick={() => setScanning(true)}>
              <ScanIcon weight="bold" className="size-5 text-pink" />
              Got someone? Scan their code
            </Button>
          </div>
          <ul className="grid gap-2.5 text-paper-2">
            <li className="flex gap-2.5">
              <SwordIcon weight="duotone" className="mt-0.5 size-5 shrink-0 text-pink" />
              <span>
                <span className="font-semibold text-paper">Tag:</span> get someone to do your task. They're out and their
                task is yours.
              </span>
            </li>
            <li className="flex gap-2.5">
              <DetectiveIcon weight="duotone" className="mt-0.5 size-5 shrink-0 text-pink" />
              <span>
                <span className="font-semibold text-paper">Catch:</span> spot someone trying their task on you. They're
                out and you keep yours.
              </span>
            </li>
          </ul>
          {view.knockouts > 0 && <p className="font-semibold">You've knocked out {view.knockouts} so far.</p>}
        </>
      )}

      {out && (
        <p className="text-paper-2">
          {view.method === 'catch' ? `${nameOf(view.by)} caught you trying “${view.task}”.` : `${nameOf(view.by)} got you with “${view.task}”.`}
          {view.knockouts > 0 && ` You knocked out ${view.knockouts} before that.`}
        </p>
      )}

      {won && <p className="text-paper-2">You knocked out {view.knockouts} and nobody got you.</p>}

      {(view === null || view?.status === 'spectator') && !dealing.waiting && (
        <WatchLine publicState={publicState} serverNow={serverNow} dealing={dealing} />
      )}

      <section aria-labelledby={listId} className="grid gap-2.5">
        <h3 id={listId} className="text-sm on-air text-paper-2">
          Who is left
        </h3>
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
