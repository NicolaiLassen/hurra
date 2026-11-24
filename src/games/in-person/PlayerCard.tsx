import { useId } from 'react'
import { SectionHead } from '@/components/phone/Strap'
import type { InPersonGame } from '@/games/in-person/logic'
import type { PlayerCardProps } from '@/games/types'

/**
 * The round's section on the phone home while another game holds the main
 * card: its tab (gold while the TV shows it) and what to do, in one line.
 * There is nothing more to open, so it has no Open control.
 */
export default function PlayerCard({ game, onStage }: PlayerCardProps<InPersonGame>) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="grid grid-cols-1 gap-2">
      <SectionHead id={id} tab={game.title} tone={onStage ? 'air' : 'plain'} />
      <p className="text-[1.0625rem] leading-snug text-paper-2">Played in person. Show the host your code when you score.</p>
    </section>
  )
}
