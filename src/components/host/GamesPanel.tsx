import {
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  CaretDownIcon,
  CaretRightIcon,
  CrownIcon,
  DotsThreeIcon,
  GameControllerIcon,
  GearSixIcon,
  PencilSimpleIcon,
  PlayIcon,
  PlusIcon,
  TelevisionSimpleIcon,
  TrashIcon,
} from '@phosphor-icons/react'
import { useState } from 'react'
import Confirm from '@/components/Confirm'
import ConfirmByTyping from '@/components/ConfirmByTyping'
import { ReadinessLine } from '@/components/host/GameSettings'
import { errorMessage, useHostCall } from '@/components/host/hostCalls'
import { useProgramSettings, useRoomStep } from '@/components/host/programSettings'
import RenameDialog from '@/components/host/RenameDialog'
import { nextPosition, rowPlan, winnersChip, type RoomStep } from '@/components/host/scene'
import StartButton from '@/components/host/StartButton'
import StateChip, { InTeamsChip } from '@/components/host/StateChip'
import { useDialogTarget } from '@/components/host/useDialogTarget'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { gameModules, getGameModule } from '@/games/registry'
import { addGame, archiveGame, callGame, deleteGame, renameGame, setSpotlight } from '@/lib/queries'
import { teamPlayOn } from '@/lib/teams'
import { tvScene } from '@/lib/stage'
import { toast } from '@/lib/toast'
import type { SessionGame, Snapshot } from '@/lib/types'
import { useLive, useServerNow } from '@/lib/useLive'

/**
 * The night's program (docs/engine-v2.md, 7.3): games not started yet, each
 * with whether its settings are ready (GameModule.setupStatus), its Settings
 * and its Start (on the TV or in the background), or Set up in the Start's
 * place while it isn't ready; finished ones (who won, Settings, Show on the
 * TV, Restart); the archive; and Add game, which opens the new game's
 * settings. Live games have their own cards above. A game's settings open as
 * a page of their own (`onOpenSettings`).
 */
export default function GamesPanel({
  snapshot,
  program,
  archived,
  onOpenSettings,
}: {
  snapshot: Snapshot
  program: SessionGame[]
  archived: SessionGame[]
  onOpenSettings: (gameId: string) => void
}) {
  const session = snapshot.session!
  const { refresh } = useLive()
  const call = useHostCall()
  const step = useRoomStep(snapshot)
  const [showArchived, setShowArchived] = useState(false)
  const renaming = useDialogTarget<SessionGame>()
  const restarting = useDialogTarget<SessionGame>()
  const startingAnyway = useDialogTarget<SessionGame>()
  const deleting = useDialogTarget<SessionGame>()
  const settings = useProgramSettings()

  async function setArchived(game: SessionGame, archive: boolean) {
    const done = await call(() => archiveGame(game.id, archive))
    if (!done) return
    if (archive) {
      toast(`Archived ${game.title}`, {
        description: 'Its points still count.',
        action: { label: 'Undo', onClick: () => void setArchived(game, false) },
      })
    } else {
      toast(`${game.title} is back in the program`)
    }
  }

  const rowProps = {
    snapshot,
    step,
    onSettings: (game: SessionGame) => onOpenSettings(game.id),
    onRename: renaming.show,
    onRestart: restarting.show,
    onStartAnyway: startingAnyway.show,
    onArchive: (game: SessionGame, archive: boolean) => void setArchived(game, archive),
    onDelete: deleting.show,
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Games</CardTitle>
        {program.length === 0 && (
          <CardDescription>
            {snapshot.games.some((g) => g.archived_at === null)
              ? 'Every game is live right now.'
              : archived.length > 0
                ? 'Every game is archived. Add one below, or unarchive one.'
                : 'No games yet. Add one below.'}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4">
        {program.length > 0 && (
          <ul className="divide-y divide-rule">
            {program.map((game) => (
              <GameRow key={game.id} game={game} {...rowProps} />
            ))}
          </ul>
        )}

        {archived.length > 0 && (
          <div>
            <Button
              variant="ghost"
              className="-ml-2.5 text-paper-2"
              aria-expanded={showArchived}
              onClick={() => setShowArchived((open) => !open)}
            >
              {showArchived ? <CaretDownIcon /> : <CaretRightIcon />}
              Archived ({archived.length})
            </Button>
            {showArchived && (
              <ul className="divide-y divide-rule">
                {archived.map((game) => (
                  <GameRow key={game.id} game={game} {...rowProps} />
                ))}
              </ul>
            )}
          </div>
        )}

        <AddGame
          sessionId={session.id}
          games={snapshot.games}
          // A new game opens its settings at once: setting it up is what comes next.
          onAdded={(id, gameType) => {
            if (getGameModule(gameType)?.ConfigEditor) onOpenSettings(id)
          }}
        />
      </CardContent>

      <RenameDialog
        open={renaming.open}
        onOpenChange={renaming.onOpenChange}
        title={`Rename ${renaming.target?.title ?? 'the game'}`}
        description="Phones and the TV show the new title."
        label="Title"
        initial={renaming.target?.title ?? ''}
        maxLength={80}
        onSave={async (title) => {
          if (!renaming.target) return
          await renameGame(renaming.target.id, title)
          refresh()
        }}
      />

      <Confirm
        open={restarting.open}
        onOpenChange={restarting.onOpenChange}
        title={`Restart ${restarting.target?.title ?? 'the game'}?`}
        description="It starts again and its points start over. Points you gave by hand stay."
        confirmLabel="Restart"
        onConfirm={() => {
          const game = restarting.target
          // Started as the game presents itself: the quiz takes the TV, Last one standing runs in the background.
          if (game) void call(() => callGame({ type: 'start', gameId: game.id }))
        }}
      />

      <Confirm
        open={startingAnyway.open}
        onOpenChange={startingAnyway.onOpenChange}
        title={`Start ${startingAnyway.target?.title ?? 'the game'} anyway?`}
        description={
          startingAnyway.target
            ? `${settings.status(startingAnyway.target.id)?.line ?? 'Its settings are not ready'}. It starts with its settings as they are.`
            : undefined
        }
        confirmLabel="Start anyway"
        variant="default"
        onConfirm={() => {
          const game = startingAnyway.target
          // Started as the game presents itself: the quiz takes the TV, Last one standing runs in the background.
          if (game) void call(() => callGame({ type: 'start', gameId: game.id }))
        }}
      />

      <ConfirmByTyping
        open={deleting.open}
        onOpenChange={deleting.onOpenChange}
        title={`Delete ${deleting.target?.title ?? 'game'}?`}
        confirmText={deleting.target?.title ?? ''}
        actionLabel="Delete this game"
        onConfirm={() => {
          const game = deleting.target
          if (game) void call(() => deleteGame(game.id), `Deleted ${game.title}`)
        }}
      >
        <p>
          This permanently deletes the game and everything it kept track of. The points players scored in it disappear
          from the scoreboard; points you gave by hand stay.
        </p>
        <p>To tidy it away and keep the points, archive it instead.</p>
      </ConfirmByTyping>
    </Card>
  )
}

function GameRow({
  game,
  snapshot,
  step,
  onSettings,
  onRename,
  onRestart,
  onStartAnyway,
  onArchive,
  onDelete,
}: {
  game: SessionGame
  snapshot: Snapshot
  step: RoomStep
  onSettings: (game: SessionGame) => void
  onRename: (game: SessionGame) => void
  onRestart: (game: SessionGame) => void
  onStartAnyway: (game: SessionGame) => void
  onArchive: (game: SessionGame, archive: boolean) => void
  onDelete: (game: SessionGame) => void
}) {
  const gameModule = getGameModule(game.game_type)
  const GameIcon = gameModule?.icon ?? GameControllerIcon
  const settings = useProgramSettings()
  const archived = game.archived_at !== null
  const finished = game.status === 'finished'
  const live = game.status === 'active'
  const chip = finished ? winnersChip(game, snapshot.players) : null
  const plan = rowPlan(game, {
    editable: Boolean(gameModule?.ConfigEditor),
    status: settings.status(game.id),
    step,
    startable: settings.startProblem(game.id) === null,
  })

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-control bg-overlay text-paper-2">
          <GameIcon weight="duotone" className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{game.title}</p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-paper-2">
            {/* The game type, unless the title already says it. */}
            {gameModule?.name !== game.title && <span>{gameModule?.name ?? `Unknown type “${game.game_type}”`}</span>}
            {chip && (
              <span className="inline-flex items-center gap-1 font-bold text-paper">
                {/* The winner's crown: gold's job (docs/identity.md). */}
                <CrownIcon weight="fill" className="text-gold" />
                {chip}
              </span>
            )}
            {finished && !chip && <span>No winner</span>}
          </p>
          {plan.status && <ReadinessLine status={plan.status} className="mt-1 text-xs" />}
        </div>
        {/* Not modal, so the dialogs it opens don't fight it for focus. */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-lg" className="-my-0.5" aria-label={`More actions for ${game.title}`}>
              <DotsThreeIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto min-w-48">
            {finished && !archived && (
              <DropdownMenuItem onSelect={() => onRestart(game)}>
                <PlayIcon />
                Restart…
              </DropdownMenuItem>
            )}
            {plan.startAnyway && (
              <DropdownMenuItem onSelect={() => onStartAnyway(game)}>
                <PlayIcon />
                Start anyway…
              </DropdownMenuItem>
            )}
            {!archived && (
              <DropdownMenuItem onSelect={() => onRename(game)}>
                <PencilSimpleIcon />
                Rename…
              </DropdownMenuItem>
            )}
            {archived ? (
              <DropdownMenuItem onSelect={() => onArchive(game, false)}>
                <ArrowCounterClockwiseIcon />
                Unarchive
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem disabled={live} onSelect={() => onArchive(game, true)}>
                <ArchiveIcon />
                {live ? 'End the game to archive it' : 'Archive'}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(game)}>
              <TrashIcon />
              Delete…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {/*
          A row of their own under the name and its readiness, so both keep their room. When they don't fit on one
          line (a phone), the Start or Show on the TV goes on top: wrap-reverse puts the line that holds it first.
        */}
        <div className="flex w-full flex-wrap-reverse items-center gap-2 pl-12">
          {/* A phone has no room to spare: its Start button says the game hasn't started. */}
          <StateChip state={archived ? 'archived' : game.status} className={!archived && game.status === 'pending' ? 'max-sm:hidden' : undefined} />
          {/* Switched on in its settings: it is played in teams once the party has them. */}
          {!archived && teamPlayOn(game) && <InTeamsChip />}
          {plan.settings && (
            <Button
              // Set up is the row's next step while the game isn't ready: gold when it is the room's (roomStep).
              variant={plan.settings.gold ? 'default' : plan.settings.label === 'Set up' ? 'secondary' : 'outline'}
              size="lg"
              data-settings-for={game.id}
              aria-label={`${plan.settings.label === 'Set up' ? 'Set up' : 'Settings of'} ${game.title}`}
              onClick={() => onSettings(game)}
            >
              <GearSixIcon />
              {plan.settings.label}
            </Button>
          )}
          {plan.start && <StartButton game={game} gold={plan.start.gold} />}
          {!archived && finished && <FinishedOnTv snapshot={snapshot} game={game} />}
        </div>
      </div>
    </li>
  )
}

/**
 * A finished game on the TV: "On the TV" while its final screen shows, else
 * Show on the TV, which shows it again for 3 minutes from now. The final
 * screen counts from the moment the spotlight changes, so a game that is still
 * the spotlight (its 3 minutes over) is taken off first.
 */
function FinishedOnTv({ snapshot, game }: { snapshot: Snapshot; game: SessionGame }) {
  const now = useServerNow(1000)
  const call = useHostCall()
  const [pending, setPending] = useState(false)
  const session = snapshot.session!
  const scene = tvScene(snapshot, now)
  // An archived party's TV shows the final standings whatever the spotlight is.
  if (scene.kind === 'over') return null
  if (scene.kind === 'final' && scene.game.id === game.id) {
    return (
      // On air: gold's job (docs/identity.md).
      <Badge>
        <TelevisionSimpleIcon />
        On the TV
      </Badge>
    )
  }

  async function show() {
    setPending(true)
    await call(async () => {
      if (session.spotlight_game_id === game.id) await setSpotlight(session.id, null)
      await setSpotlight(session.id, game.id)
    })
    setPending(false)
  }

  return (
    <Button variant="secondary" size="lg" isPending={pending} onClick={() => void show()}>
      <TelevisionSimpleIcon />
      Show on the TV
    </Button>
  )
}

/** Add game: a type and an optional title. It goes last in the program; `onAdded` hears its id. */
function AddGame({
  sessionId,
  games,
  onAdded,
}: {
  sessionId: string
  games: SessionGame[]
  onAdded: (id: string, gameType: string) => void
}) {
  const { refresh } = useLive()
  const [gameType, setGameType] = useState(gameModules[0].logic.type)
  const [title, setTitle] = useState('')
  const [pending, setPending] = useState(false)

  async function add() {
    const fallback = getGameModule(gameType)?.name ?? gameType
    setPending(true)
    try {
      const { id } = await addGame(sessionId, gameType, title.trim() || fallback, nextPosition(games))
      setTitle('')
      refresh()
      onAdded(id, gameType)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      className="grid gap-2 border-t border-rule pt-4 sm:grid-cols-[12rem_1fr_auto]"
      onSubmit={(e) => {
        e.preventDefault()
        void add()
      }}
    >
      <Select value={gameType} onValueChange={setGameType}>
        <SelectTrigger className="w-full" aria-label="Game type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {gameModules.map((m) => (
            <SelectItem key={m.logic.type} value={m.logic.type}>
              {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" maxLength={80} aria-label="Title" />
      <Button type="submit" variant="secondary" size="lg" isPending={pending}>
        <PlusIcon />
        Add game
      </Button>
    </form>
  )
}
