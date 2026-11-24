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
import GameSettings from '@/components/host/GameSettings'
import { errorMessage, useHostCall } from '@/components/host/hostCalls'
import RenameDialog from '@/components/host/RenameDialog'
import { nextPosition, winnersChip } from '@/components/host/scene'
import StartButton from '@/components/host/StartButton'
import StateChip from '@/components/host/StateChip'
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
import { tvScene } from '@/lib/stage'
import { toast } from '@/lib/toast'
import type { SessionGame, Snapshot } from '@/lib/types'
import { useLive, useServerNow } from '@/lib/useLive'

/**
 * The night's program (docs/engine-v2.md, 7.3): games not started yet (Start
 * on the TV or in the background), finished ones (who won, Show on the TV,
 * Restart), the archive, and Add game. Live games have their own cards above.
 */
export default function GamesPanel({
  snapshot,
  program,
  archived,
}: {
  snapshot: Snapshot
  program: SessionGame[]
  archived: SessionGame[]
}) {
  const session = snapshot.session!
  const { refresh } = useLive()
  const call = useHostCall()
  // The game whose settings are open, as it stood: starting it closes them, and they stay closed once it finishes.
  const [settingsFor, setSettingsFor] = useState<{ id: string; startedAt: number | null }>()
  const [showArchived, setShowArchived] = useState(false)
  const renaming = useDialogTarget<SessionGame>()
  const restarting = useDialogTarget<SessionGame>()
  const deleting = useDialogTarget<SessionGame>()

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
    onSettings: (game: SessionGame) =>
      setSettingsFor((open) => (open?.id === game.id ? undefined : { id: game.id, startedAt: game.started_at })),
    onRename: renaming.show,
    onRestart: restarting.show,
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
              <GameRow
                key={game.id}
                game={game}
                settingsOpen={settingsFor?.id === game.id && settingsFor.startedAt === game.started_at}
                onCloseSettings={() => setSettingsFor(undefined)}
                {...rowProps}
              />
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
                  <GameRow key={game.id} game={game} settingsOpen={false} onCloseSettings={() => {}} {...rowProps} />
                ))}
              </ul>
            )}
          </div>
        )}

        <AddGame sessionId={session.id} games={snapshot.games} />
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
  settingsOpen,
  onCloseSettings,
  onSettings,
  onRename,
  onRestart,
  onArchive,
  onDelete,
}: {
  game: SessionGame
  snapshot: Snapshot
  settingsOpen: boolean
  onCloseSettings: () => void
  onSettings: (game: SessionGame) => void
  onRename: (game: SessionGame) => void
  onRestart: (game: SessionGame) => void
  onArchive: (game: SessionGame, archive: boolean) => void
  onDelete: (game: SessionGame) => void
}) {
  const gameModule = getGameModule(game.game_type)
  const GameIcon = gameModule?.icon ?? GameControllerIcon
  const archived = game.archived_at !== null
  const finished = game.status === 'finished'
  const live = game.status === 'active'
  const chip = finished ? winnersChip(game, snapshot.players) : null
  const canEditSettings = Boolean(gameModule?.ConfigEditor) && !live && !archived

  return (
    <li className="grid grid-cols-1 gap-3 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
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
        </div>
        {/* Beside the title on a laptop; on a phone a row of their own, under it, so the title keeps its room. */}
        <div className="order-last flex w-full flex-wrap items-center gap-2 pl-12 sm:order-none sm:w-auto sm:pl-0">
          {/* A phone has no room to spare: its Start button says the game hasn't started. */}
          <StateChip state={archived ? 'archived' : game.status} className={!archived && game.status === 'pending' ? 'max-sm:hidden' : undefined} />
          {!archived && game.status === 'pending' && <StartButton game={game} />}
          {!archived && finished && <FinishedOnTv snapshot={snapshot} game={game} />}
        </div>
        {/* Not modal, so the dialogs it opens don't fight it for focus. */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-lg" aria-label={`More actions for ${game.title}`}>
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
            {canEditSettings && (
              <DropdownMenuItem onSelect={() => onSettings(game)}>
                <GearSixIcon />
                {settingsOpen ? 'Close settings' : 'Settings'}
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
      </div>
      {gameModule && settingsOpen && canEditSettings && (
        <GameSettings
          session={snapshot.session!}
          game={game}
          gameModule={gameModule}
          players={snapshot.players}
          onClose={onCloseSettings}
        />
      )}
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

/** Add game: a type and an optional title. It goes last in the program. */
function AddGame({ sessionId, games }: { sessionId: string; games: SessionGame[] }) {
  const { refresh } = useLive()
  const [gameType, setGameType] = useState(gameModules[0].logic.type)
  const [title, setTitle] = useState('')
  const [pending, setPending] = useState(false)

  async function add() {
    const fallback = getGameModule(gameType)?.name ?? gameType
    setPending(true)
    try {
      await addGame(sessionId, gameType, title.trim() || fallback, nextPosition(games))
      setTitle('')
      refresh()
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
