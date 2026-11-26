import { CaretDownIcon, PlayIcon, SpinnerIcon, StackIcon, TelevisionSimpleIcon } from '@phosphor-icons/react'
import { useRef, useState } from 'react'
import { useHostCall } from '@/components/host/hostCalls'
import { startChoices, type StartChoice } from '@/components/host/scene'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { getGameModule } from '@/games/registry'
import { callGame, setSpotlight } from '@/lib/queries'
import { toast } from '@/lib/toast'
import type { SessionGame } from '@/lib/types'
import { useLive } from '@/lib/useLive'
import { cn } from '@/lib/utils'

/**
 * Start a game that hasn't run yet (docs/engine-v2.md, 7.3): a split button.
 * The main side follows the game's presentation (the quiz takes the TV, Last
 * one standing runs in the background); the caret offers the other way.
 * Disabled while the start is on its way, so a double tap can't deal it twice.
 * A start in the background says so, with Show on the TV right in the toast:
 * the TV keeps what it shows, which can look as if nothing started.
 *
 * Gold only on the game whose Start is the room's one next step (`gold`, from
 * roomStep): the others are the overlay's secondary buttons (docs/identity.md).
 */
export default function StartButton({ game, gold }: { game: SessionGame; gold: boolean }) {
  const [main, other] = startChoices(getGameModule(game.game_type)?.logic.presentation)
  const call = useHostCall()
  const sessionId = useLive().snapshot?.session?.id
  const next = gold
  const variant = next ? 'default' : 'secondary'
  const [pending, setPending] = useState(false)
  const inFlight = useRef(false)

  async function start(choice: StartChoice) {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    const started = await call(() => callGame({ type: 'start', gameId: game.id, stage: choice.stage }))
    inFlight.current = false
    setPending(false)
    if (started && !choice.stage && sessionId) {
      toast(`${game.title} is running in the background`, {
        description: 'The TV keeps showing what it shows now.',
        action: { label: 'Show on the TV', onClick: () => void call(() => setSpotlight(sessionId, game.id)) },
      })
    }
  }

  const icon = (choice: StartChoice) => (choice.stage ? <TelevisionSimpleIcon /> : <StackIcon />)

  return (
    <div className="flex" role="group" aria-label={`Start ${game.title}`}>
      <Button size="lg" variant={variant} className="rounded-r-none pr-3" isPending={pending} onClick={() => void start(main)}>
        {pending ? <SpinnerIcon className="animate-spin" /> : <PlayIcon />}
        {main.label}
      </Button>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-lg"
            variant={variant}
            className={cn('rounded-l-none', next ? 'border-l-ink/25' : 'border-l-rule')}
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
