import { CaretDownIcon, GameControllerIcon, StopIcon, TelevisionSimpleIcon } from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import Confirm from '@/components/Confirm'
import GameViewBoundary from '@/components/host/GameViewBoundary'
import { useHostAct, useHostCall } from '@/components/host/hostCalls'
import StatusBadge from '@/components/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { getGameModule } from '@/games/registry'
import { gameMediaUrl } from '@/lib/media'
import { callGame, setSpotlight } from '@/lib/queries'
import { gamePointsOf, promptsOf, talliesOf } from '@/lib/stage'
import type { SessionGame, Snapshot } from '@/lib/types'
import { useLive } from '@/lib/useLive'
import { cn } from '@/lib/utils'

/**
 * One live game in the control room (docs/engine-v2.md, 7.3): its title and
 * where it shows, Show on the TV and End, and the game's own HostView fed the
 * full state (hosts only), this round's settings, the answers coming in and
 * this round's points.
 */
export default function LiveGameCard({ snapshot, game, onStage }: { snapshot: Snapshot; game: SessionGame; onStage: boolean }) {
  const gameModule = getGameModule(game.game_type)
  const GameIcon = gameModule?.icon ?? GameControllerIcon
  const HostView = gameModule?.HostView
  const live = useLive()
  const act = useHostAct(game.id)
  const call = useHostCall()
  const [pending, setPending] = useState<'stage' | 'end' | null>(null)
  const [open, setOpen] = useState(true)
  const session = snapshot.session!
  const held = snapshot.states?.[game.id]
  const prompts = useMemo(() => promptsOf(snapshot, game.id), [snapshot, game.id])

  async function run(id: 'stage' | 'end', request: () => Promise<unknown>) {
    if (pending) return
    setPending(id)
    await call(request)
    setPending(null)
  }

  return (
    <Card className={cn(onStage && 'ring-primary/40')}>
      <CardHeader className="flex flex-wrap items-center gap-x-3 gap-y-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
          <GameIcon weight="duotone" className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg leading-snug font-semibold">{game.title}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <StatusBadge status="active" />
            {onStage ? (
              <Badge variant="outline" className="border-primary/50 text-primary">
                <TelevisionSimpleIcon />
                On the TV
              </Badge>
            ) : (
              <span className="text-xs text-muted-foreground">In the background</span>
            )}
            {held && held.round > 1 && <span className="text-xs text-muted-foreground">Round {held.round}</span>}
          </p>
        </div>
        {/* Beside the title on a laptop; on a phone a row of their own, under it, so the title keeps its room. */}
        <div className="order-last flex w-full flex-wrap items-center gap-2 sm:order-none sm:w-auto">
          {!onStage && (
            <Button
              variant="secondary"
              size="lg"
              isPending={pending === 'stage'}
              disabled={pending !== null}
              onClick={() => void run('stage', () => setSpotlight(session.id, game.id))}
            >
              <TelevisionSimpleIcon />
              Show on the TV
            </Button>
          )}
          <Confirm
            title={`End ${game.title}?`}
            description="It finishes now and shows how it stood."
            confirmLabel="End"
            onConfirm={() => void run('end', () => callGame({ type: 'end', gameId: game.id }))}
          >
            <Button variant="secondary" size="lg" isPending={pending === 'end'} disabled={pending !== null}>
              <StopIcon />
              End
            </Button>
          </Confirm>
        </div>
        <Button
          variant="ghost"
          size="icon-lg"
          aria-expanded={open}
          aria-label={open ? `Hide the controls of ${game.title}` : `Show the controls of ${game.title}`}
          onClick={() => setOpen((shown) => !shown)}
        >
          <CaretDownIcon className={cn('transition-transform', open && 'rotate-180')} />
        </Button>
      </CardHeader>
      {open && (
        <CardContent className="min-w-0 border-t pt-4">
          {!gameModule ? (
            <p className="text-sm text-muted-foreground">
              This app doesn't know the game type “{game.game_type}”. End it here, or reload once the app is updated.
            </p>
          ) : !HostView ? (
            <p className="text-sm text-muted-foreground">{game.title} runs by itself: it has no controls of its own.</p>
          ) : (
            <GameViewBoundary title={game.title}>
              <HostView
                session={session}
                game={game}
                players={snapshot.players}
                publicState={game.public_state}
                prompts={prompts}
                serverNow={live.serverNow}
                mediaUrl={gameMediaUrl}
                state={held ? held.state : null}
                config={held ? held.config : null}
                tallies={talliesOf(live.tallies, game.id)}
                gamePoints={gamePointsOf(snapshot, game.id)}
                act={act}
              />
            </GameViewBoundary>
          )}
        </CardContent>
      )}
    </Card>
  )
}
