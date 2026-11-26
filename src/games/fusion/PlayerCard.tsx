import { CaretRightIcon } from '@phosphor-icons/react'
import { useId } from 'react'
import { SectionHead } from '@/components/phone/Strap'
import { Button } from '@/components/ui/button'
import type { FusionGame } from '@/games/fusion/logic'
import { askingCase, cardLine, outcomeFor, outcomePoints } from '@/games/fusion/phoneLines'
import { SecondsLeft } from '@/games/fusion/phoneParts'
import { readPublic, readView } from '@/games/fusion/shapes'
import { sameName } from '@/games/core/names'
import { choiceOf, shortName, shortNames } from '@/games/fusion/view'
import type { PlayerCardProps } from '@/games/types'
import { useServerTime } from '@/lib/gameClock'

/**
 * Fusion's section on the phone home while another game holds the main card
 * (a second stage game live at once): its tab (gold while the TV shows it),
 * where the round is in one line on a row that opens the full view, and an
 * outlined Guess with the seconds left while a picture waits for this guest's
 * lock (the sheet holds the picker). Show my code stays the home's one gold
 * step.
 */
export default function PlayerCard({ game, players, player, publicState, view: rawView, myAnswers, prompts, serverNow, onStage, open }: PlayerCardProps<FusionGame>) {
  const id = useId()
  const pub = readPublic(publicState)
  const view = readView(rawView)
  const current = pub?.current ? pub.pictures.find((p) => p.n === pub.current!.n) : undefined
  const asking = pub?.phase === 'asking' && pub.current ? pub.current : null
  const mine = pub?.current ? choiceOf(myAnswers[pub.current.key]) : null
  const now = useServerTime(serverNow, 1000, asking !== null && mine === null)
  const closed = asking ? (prompts.find((p) => p.key === asking.key)?.closed_at ?? null) !== null : true
  const askCase = asking ? askingCase({ lockedIn: mine !== null, sending: false, over: closed || now >= asking.endsAt }) : null

  let reveal = null
  if (pub?.phase === 'reveal' && current?.revealed) {
    const outcome = outcomeFor(current, player.name, view, mine)
    const short = shortNames([...players.map((p) => p.name), ...current.revealed.names])
    const names = current.revealed.names.map((name) => (sameName(name, player.name) ? 'you' : shortName(short, name)))
    reveal = { names, outcome, points: outcomePoints(outcome, pub.rules) }
  }

  return (
    <section aria-labelledby={id} className="grid grid-cols-1 gap-3">
      <SectionHead id={id} tab={game.title} tone={onStage ? 'air' : 'plain'} />
      <button
        type="button"
        onClick={open}
        className="flex min-h-14 w-full items-center gap-3 rounded-phone bg-overlay px-4 py-2.5 text-left transition-colors hover:bg-rule focus-visible:ring-3 focus-visible:ring-gold/50 focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1 text-[17px] leading-snug font-bold">{cardLine(pub, view, askCase, reveal)}</span>
        <span className="sr-only">Open</span>
        <CaretRightIcon className="size-5 shrink-0 text-paper-2" />
      </button>
      {askCase === 'picking' && asking && now >= asking.startsAt && (
        <Button size="xl" variant="outline" className="w-full justify-between" onClick={open}>
          Guess
          <SecondsLeft endsAt={asking.endsAt} serverNow={serverNow} />
        </Button>
      )}
    </section>
  )
}
