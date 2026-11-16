import {
  ArrowCounterClockwiseIcon,
  ArrowSquareOutIcon,
  CrownIcon,
  FilmStripIcon,
  GameControllerIcon,
  RankingIcon,
  TelevisionSimpleIcon,
  TrophyIcon,
  type Icon,
} from '@phosphor-icons/react'
import { useState } from 'react'
import Confirm from '@/components/Confirm'
import { useHostCall } from '@/components/host/hostCalls'
import PairTvButton from '@/components/host/PairTvButton'
import { formatCountdown, screensLine, stageWords } from '@/components/host/scene'
import TvSoundControl from '@/components/host/TvSoundControl'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { getGameModule } from '@/games/registry'
import { setSpotlight, setTvScene, unpairScreens } from '@/lib/queries'
import { tvScene, type TvScene } from '@/lib/stage'
import { tvTabWindow, useTvTabOpen } from '@/lib/tvTab'
import type { Snapshot } from '@/lib/types'
import { useServerNow } from '@/lib/useLive'
import { cn } from '@/lib/utils'

/**
 * "On the TV now" (docs/engine-v2.md, 7.3): what the TV shows, in words and as
 * a small screen, with the ways to change it (Back to standings, the recap),
 * the paired TVs and how loud the TV plays its sound effects. Its own clock
 * ticks every second for the final screen's countdown, so only this panel
 * re-renders with it.
 */
export default function StagePanel({ snapshot, className }: { snapshot: Snapshot; className?: string }) {
  const now = useServerNow(1000)
  const session = snapshot.session!
  const scene = tvScene(snapshot, now)
  const words = stageWords(scene, snapshot.players, now)
  const call = useHostCall()
  const [pending, setPending] = useState<string | null>(null)
  const screens = snapshot.screens ?? 0
  // A TV shown in a tab of this browser (Show the TV here), for when no second device can be paired.
  const tvTab = useTvTabOpen(session.join_code)

  async function run(id: string, request: () => Promise<unknown>, success?: string) {
    if (pending) return
    setPending(id)
    await call(request, success)
    setPending(null)
  }

  const backToStandings = (
    <Button
      size="lg"
      // Gold while a finished game's final screen holds the TV: it is what the host most likely wants next.
      variant={scene.kind === 'final' ? 'default' : 'secondary'}
      isPending={pending === 'standings'}
      disabled={pending !== null}
      onClick={() => void run('standings', () => setSpotlight(session.id, null))}
    >
      <RankingIcon />
      Back to standings
    </Button>
  )

  return (
    <Card className={className}>
      <CardContent className="grid gap-4">
        <div className="flex items-start gap-4">
          <MiniScreen scene={scene} now={now} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              <TelevisionSimpleIcon className="size-3.5" />
              On the TV now
            </p>
            <h2 className="mt-1 text-xl leading-tight font-bold break-words">{words.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{words.detail}</p>
          </div>
        </div>

        {(scene.kind === 'live' || scene.kind === 'final' || scene.kind === 'recap' || snapshot.recap) && (
          <div className="flex flex-wrap gap-2">
            {(scene.kind === 'live' || scene.kind === 'final') && backToStandings}
            {scene.kind === 'recap' ? (
              <Button
                size="lg"
                isPending={pending === 'party'}
                disabled={pending !== null}
                onClick={() => void run('party', () => setTvScene(session.id, 'live'))}
              >
                <ArrowCounterClockwiseIcon />
                Back to the party
              </Button>
            ) : (
              snapshot.recap && (
                <Button
                  variant="secondary"
                  size="lg"
                  isPending={pending === 'recap'}
                  disabled={pending !== null}
                  onClick={() => void run('recap', () => setTvScene(session.id, 'recap'))}
                >
                  <FilmStripIcon />
                  Show the recap on the TV
                </Button>
              )
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <span className={cn('size-2 rounded-full', screens > 0 || tvTab ? 'bg-confetti-teal' : 'bg-muted-foreground')} aria-hidden />
            {screensLine(snapshot.screens, tvTab)}
          </p>
          <div className="ml-auto flex flex-wrap items-center gap-1">
            <Button asChild variant="ghost">
              <a
                href={`/tv/${session.join_code}?mirror=1`}
                target={tvTabWindow(session.join_code)}
                title="Opens the TV in a new tab of this browser: cast that tab, or move it to the TV as a second screen"
              >
                Show the TV here
                <ArrowSquareOutIcon />
              </a>
            </Button>
            {screens > 0 && (
              <Confirm
                title={screens === 1 ? 'Unpair the TV?' : `Unpair all ${screens} TVs?`}
                description="It goes back to its pairing screen. Pair it again with a new code from this page."
                confirmLabel="Unpair"
                onConfirm={() => void run('unpair', () => unpairScreens(session.id), 'Unpaired')}
              >
                <Button variant="ghost" isPending={pending === 'unpair'}>
                  Unpair
                </Button>
              </Confirm>
            )}
            <PairTvButton
              sessionId={session.id}
              joinCode={session.join_code}
              screens={snapshot.screens}
              label={screens > 0 ? 'Pair another TV' : 'Pair a TV'}
              variant={screens > 0 ? 'ghost' : 'default'}
              size="default"
            />
          </div>
        </div>

        <TvSoundControl sessionId={session.id} volume={session.sound_volume} tvOpen={screens > 0 || tvTab} />
      </CardContent>
    </Card>
  )
}

/** The scene as a tiny TV: the game's icon while it is live, a crown and the countdown on its final screen. */
function MiniScreen({ scene, now }: { scene: TvScene; now: number }) {
  let icon: Icon
  let label: string
  let tone: string
  switch (scene.kind) {
    case 'live':
      icon = getGameModule(scene.game.game_type)?.icon ?? GameControllerIcon
      label = 'Live'
      tone = 'text-confetti-teal ring-confetti-teal/50'
      break
    case 'final':
      icon = CrownIcon
      label = formatCountdown(scene.until - now)
      tone = 'text-primary ring-primary/50'
      break
    case 'recap':
      icon = FilmStripIcon
      label = 'Recap'
      tone = 'text-confetti-violet ring-confetti-violet/50'
      break
    case 'over':
      icon = TrophyIcon
      label = 'Final'
      tone = 'text-primary ring-foreground/15'
      break
    case 'standings':
      icon = RankingIcon
      label = 'Standings'
      tone = 'text-muted-foreground ring-foreground/15'
      break
  }
  const SceneIcon = icon
  return (
    <div
      aria-hidden
      className={cn(
        'relative grid aspect-video w-24 shrink-0 place-items-center content-center gap-1 rounded-lg bg-background ring-2 sm:w-32',
        tone,
      )}
    >
      <SceneIcon weight="duotone" className="size-7 sm:size-9" />
      <span className="flex items-center gap-1 text-[0.65rem] font-bold tracking-wider uppercase sm:text-xs">
        {scene.kind === 'live' && <span className="size-1.5 animate-pulse rounded-full bg-confetti-teal motion-reduce:animate-none" />}
        {label}
      </span>
      {/* The stand, so it reads as a TV. */}
      <span className="absolute -bottom-2 left-1/2 h-1 w-8 -translate-x-1/2 rounded-full bg-foreground/15" />
    </div>
  )
}
