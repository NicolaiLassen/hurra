import { CaretRightIcon, CrownIcon, ScanIcon } from '@phosphor-icons/react'
import { useId, useState } from 'react'
import Avatar from '@/components/Avatar'
import { SectionHead, SectionLink } from '@/components/phone/Strap'
import SecretCard from '@/components/SecretCard'
import { Button } from '@/components/ui/button'
import { huntHeading, huntLine } from '@/games/elimination/hunt'
import KnockoutFlow from '@/games/elimination/KnockoutFlow'
import type { EliminationGame } from '@/games/elimination/logic'
import type { PlayerCardProps } from '@/games/types'

/**
 * Last one standing's section on the phone home, while another game holds
 * the main card (docs/identity.md, The hunt on a phone): the hunt's pink tab,
 * where you stand ("You're still in."), how many are left with the latest
 * knockout at its time, your task face down with the popper's stripes on its
 * edge, and an outlined Scan, so Show my code stays the home's one gold step.
 * Out: your token with the pink stripe, and who got you when. "Who is left"
 * opens the full view (`open`). Camera scans don't land here: the phone
 * opens the full view with them.
 */
export default function PlayerCard({ game, player, players, publicState, view, act, open }: PlayerCardProps<EliminationGame>) {
  const id = useId()
  const [scanning, setScanning] = useState(false)
  const heading = huntHeading(view, publicState)
  const line = huntLine(players, publicState, view, player.id)
  const out = view?.status === 'out'
  const won = view?.status === 'winner'

  return (
    <section aria-labelledby={id} className="grid grid-cols-1 gap-4">
      <SectionHead
        id={id}
        tab={game.title}
        tone="hunt"
        action={
          <SectionLink onClick={open}>
            Who is left
            <CaretRightIcon className="size-4" />
          </SectionLink>
        }
      />

      <div className="flex min-w-0 items-center gap-3.5">
        {(out || won) && (
          <span className="relative shrink-0">
            <Avatar name={player.name} playerId={player.id} out={out} className="size-12" />
          </span>
        )}
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-phone-head leading-tight font-extrabold">
            {won && <CrownIcon weight="fill" aria-hidden className="size-6 shrink-0 text-gold" />}
            {out ? (
              <span>
                You're <span className="text-pink">out</span>.
              </span>
            ) : (
              heading
            )}
          </p>
          {line && <p className="mt-1 text-[1.0625rem] leading-snug text-paper-2">{line}</p>}
        </div>
      </div>

      {view?.status === 'alive' && (
        <>
          <SecretCard label="task" compact>
            {view.task}
          </SecretCard>
          <Button size="xl" variant="outline" className="w-full" onClick={() => setScanning(true)}>
            <ScanIcon weight="bold" className="size-5 text-pink" />
            Got someone? Scan their code
          </Button>
        </>
      )}

      {(view === null || view?.status === 'spectator') && (
        <p className="text-paper-2">This round started before you joined. You'll be dealt in next time.</p>
      )}

      <KnockoutFlow
        player={player}
        players={players}
        publicState={publicState}
        view={view}
        act={act}
        scanning={scanning}
        onCloseScanner={() => setScanning(false)}
      />
    </section>
  )
}
