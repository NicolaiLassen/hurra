import { CaretDownIcon, PlayIcon, SpinnerIcon, StackIcon, TelevisionSimpleIcon } from '@phosphor-icons/react'
import { useRef, useState } from 'react'
import { useHostCall } from '@/components/host/hostCalls'
import { startChoices, type StartChoice } from '@/components/host/scene'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { getGameModule } from '@/games/registry'
import { callGame } from '@/lib/queries'
import type { SessionGame } from '@/lib/types'

/**
 * Start a game that hasn't run yet (docs/engine-v2.md, 7.3): a split button.
 * The main side follows the game's presentation (the quiz takes the TV, Last
 * one standing runs in the background); the caret offers the other way.
 * Disabled while the start is on its way, so a double tap can't deal it twice.
 */
export default function StartButton({ game }: { game: SessionGame }) {
  const [main, other] = startChoices(getGameModule(game.game_type)?.logic.presentation)
  const call = useHostCall()
  const [pending, setPending] = useState(false)
  const inFlight = useRef(false)

  async function start(choice: StartChoice) {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    await call(() => callGame({ type: 'start', gameId: game.id, stage: choice.stage }))
    inFlight.current = false
    setPending(false)
  }

  const icon = (choice: StartChoice) => (choice.stage ? <TelevisionSimpleIcon /> : <StackIcon />)

  return (
    <div className="flex" role="group" aria-label={`Start ${game.title}`}>
      <Button size="lg" className="rounded-r-none pr-3" isPending={pending} onClick={() => void start(main)}>
        {pending ? <SpinnerIcon className="animate-spin" /> : <PlayIcon />}
        {main.label}
      </Button>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-lg"
            className="rounded-l-none border-l-primary-foreground/25"
            disabled={pending}
            aria-label={`More ways to start ${game.title}`}
          >
            <CaretDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-52">
          <DropdownMenuItem onSelect={() => void start(other)}>
            {icon(other)}
            {other.label}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
