import {
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  ArrowSquareOutIcon,
  CaretDownIcon,
  CaretRightIcon,
  CopyIcon,
  DotsThreeIcon,
  GearSixIcon,
  LockIcon,
  LockOpenIcon,
  PlayIcon,
  PlusIcon,
  SpinnerIcon,
  StopIcon,
  TrashIcon,
} from '@phosphor-icons/react'
import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from '@/lib/toast'
import Avatar from '@/components/Avatar'
import Confirm from '@/components/Confirm'
import ConfirmByTyping from '@/components/ConfirmByTyping'
import { Screen } from '@/components/layout'
import QueryGate from '@/components/QueryGate'
import ProfileBadges from '@/components/ProfileBadges'
import Qr from '@/components/Qr'
import RankBadge from '@/components/RankBadge'
import StatusBadge from '@/components/StatusBadge'
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
import type { GameModule } from '@/games/types'
import { withRanks } from '@/lib/format'
import { callGame } from '@/lib/gameApi'
import { useGameState, usePlayers, useScoreboard, useSession, useSessionGames } from '@/lib/queries'
import { supabase } from '@/lib/supabase'
import type { Session, SessionGame } from '@/lib/types'
import { useLoaderHold } from '@/lib/loader'
import { joinUrl } from '@/lib/urls'
import SessionMenu from '@/pages/host/SessionMenu'
import { SessionNotFound } from '@/pages/NotFound'

type Result = PromiseLike<{ error: { message: string } | null }>

async function run(action: Result) {
  const { error } = await action
  if (error) toast.error(error.message)
}

async function copyJoinLink(joinCode: string) {
  try {
    await navigator.clipboard.writeText(joinUrl(joinCode))
    toast.success('Join link copied')
  } catch {
    // Clipboard access can be refused; show the link so it can be copied by hand.
    toast(joinUrl(joinCode))
  }
}

export default function HostSession() {
  const sessionId = useParams().sessionId ?? ''
  const sessionQuery = useSession(sessionId)
  return (
    <QueryGate query={sessionQuery} notFound={<SessionNotFound />}>
      {(session) => <SessionPage session={session} />}
    </QueryGate>
  )
}

function SessionPage({ session }: { session: Session }) {
  const navigate = useNavigate()
  const { data: games, error: gamesError } = useSessionGames(session.id)
  const { data: scores, error: scoresError } = useScoreboard(session.id)
  // The games and players lists come with the first screen, not a moment after it.
  useLoaderHold((!games && !gamesError) || (!scores && !scoresError))

  const open = session.status === 'open'

  return (
    <Screen wide>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 font-mono text-sm text-muted-foreground">
            {session.join_code}
            {session.archived_at && (
              <StatusBadge status="archived" className="font-sans" />
            )}
          </p>
          <h1 className="text-3xl font-bold">{session.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="lg"
            onClick={() =>
              void run(
                supabase
                  .from('sessions')
                  .update({ status: open ? 'closed' : 'open' })
                  .eq('id', session.id),
              )
            }
          >
            {open ? <LockIcon /> : <LockOpenIcon />}
            {open ? 'Close joining' : 'Open joining'}
          </Button>
          <Button asChild size="lg">
            <Link to={`/host/s/${session.id}/scoreboard`} target="_blank">
              Scoreboard
              <ArrowSquareOutIcon />
            </Link>
          </Button>
          <SessionMenu
            session={session}
            size="icon-lg"
            variant="secondary"
            onDeleted={() => navigate('/host', { replace: true })}
          />
        </div>
      </header>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[18rem_1fr]">
        <Card className="order-last text-center lg:order-none">
          <CardHeader>
            <CardTitle>{open ? 'Scan to join' : 'Joining is closed'}</CardTitle>
          </CardHeader>
          <CardContent className="grid justify-items-center gap-3">
            <div className={open ? '' : 'opacity-30'}>
              <Qr value={joinUrl(session.join_code)} size={200} />
            </div>
            <div>
              <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">Join code</p>
              <p className="font-mono text-3xl font-black tracking-[0.2em] text-primary">{session.join_code}</p>
            </div>
            <Button
              variant="secondary"
              size="lg"
              className="w-full"
              onClick={() => void copyJoinLink(session.join_code)}
            >
              <CopyIcon />
              Copy join link
            </Button>
          </CardContent>
        </Card>

        <div className="grid gap-6">
          <GamesPanel session={session} games={games ?? []} />

          <Card>
            <CardHeader>
              <CardTitle>Players ({scores?.length ?? 0})</CardTitle>
              {scores?.length === 0 && <CardDescription>Nobody has joined yet.</CardDescription>}
            </CardHeader>
            {scores && scores.length > 0 && (
              <CardContent>
                <ul className="divide-y">
                  {withRanks(scores).map((row) => (
                    <li key={row.player_id} className="flex items-center gap-3 py-1.5">
                      <RankBadge rank={row.rank} className="mx-0.5" />
                      <Avatar name={row.name} className="size-8 text-xs" />
                      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                        {/* Padded to a 32px tap target without making the row taller. */}
                        <Link to={`/p/${row.code}`} className="truncate py-1.5 font-medium hover:text-primary">
                          {row.name}
                        </Link>
                        <ProfileBadges profile={row.profile} />
                      </span>
                      <span className="font-bold text-primary tabular-nums">{row.points}</span>
                      <Confirm
                        title={`Remove ${row.name}?`}
                        description="Their points are removed too. They can join again with a new name."
                        confirmLabel="Remove"
                        onConfirm={() => void run(supabase.from('players').delete().eq('id', row.player_id))}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-destructive"
                          aria-label={`Remove ${row.name}`}
                        >
                          <TrashIcon />
                        </Button>
                      </Confirm>
                    </li>
                  ))}
                </ul>
              </CardContent>
            )}
          </Card>
        </div>
      </div>
    </Screen>
  )
}

async function startGame(game: SessionGame) {
  try {
    await callGame({ gameId: game.id, type: 'start' })
  } catch (error) {
    toast.error((error as Error).message)
  }
}

/** Through the engine, so the game's onEnd callback can wrap up. */
async function endGame(game: SessionGame) {
  try {
    await callGame({ gameId: game.id, type: 'end' })
  } catch (error) {
    toast.error((error as Error).message)
  }
}

async function setArchived(game: SessionGame, archived: boolean) {
  const { error } = await supabase
    .from('session_games')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', game.id)
  if (error) return toast.error(error.message)
  if (archived) {
    toast(`Archived ${game.title}`, {
      description: 'Its points still count.',
      action: { label: 'Undo', onClick: () => void setArchived(game, false) },
    })
  } else {
    toast(`${game.title} is back in the list`)
  }
}

function GamesPanel({ session, games }: { session: Session; games: SessionGame[] }) {
  const [gameType, setGameType] = useState(gameModules[0].logic.type)
  const [title, setTitle] = useState('')
  const [settingsFor, setSettingsFor] = useState<string>()
  const [showArchived, setShowArchived] = useState(false)
  // Kept after the dialog closes so its text doesn't change while it animates out.
  const [deleting, setDeleting] = useState<SessionGame>()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const activeGame = games.find((g) => g.status === 'active')
  const current = games.filter((g) => !g.archived_at)
  const archived = games.filter((g) => g.archived_at)

  function addGame() {
    const fallbackTitle = getGameModule(gameType)?.name ?? gameType
    void run(
      supabase.from('session_games').insert({
        session_id: session.id,
        game_type: gameType,
        title: title.trim() || fallbackTitle,
        position: games.length,
      }),
    )
    setTitle('')
  }

  function askToDelete(game: SessionGame) {
    setDeleting(game)
    setDeleteOpen(true)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Games</CardTitle>
        {current.length === 0 && <CardDescription>No games yet. Add one below.</CardDescription>}
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4">
        {activeGame && getGameModule(activeGame.game_type)?.HostView && (
          <div className="rounded-xl border border-primary/40 p-4">
            <LiveHostView session={session} game={activeGame} />
          </div>
        )}

        {current.length > 0 && (
          <ul className="divide-y">
            {current.map((game) => (
              <GameRow
                key={game.id}
                game={game}
                settingsOpen={settingsFor === game.id}
                onToggleSettings={() => setSettingsFor(settingsFor === game.id ? undefined : game.id)}
                onDelete={() => askToDelete(game)}
              />
            ))}
          </ul>
        )}

        {archived.length > 0 && (
          <div>
            <Button
              variant="ghost"
              className="-ml-2.5 text-muted-foreground"
              aria-expanded={showArchived}
              onClick={() => setShowArchived((open) => !open)}
            >
              {showArchived ? <CaretDownIcon /> : <CaretRightIcon />}
              Archived ({archived.length})
            </Button>
            {showArchived && (
              <ul className="divide-y opacity-80">
                {archived.map((game) => (
                  <GameRow key={game.id} game={game} onDelete={() => askToDelete(game)} />
                ))}
              </ul>
            )}
          </div>
        )}

        <form
          className="grid gap-2 border-t pt-4 sm:grid-cols-[12rem_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault()
            addGame()
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
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (optional)"
            maxLength={80}
            aria-label="Title"
          />
          <Button type="submit" variant="secondary" size="lg">
            <PlusIcon />
            Add game
          </Button>
        </form>
      </CardContent>

      <ConfirmByTyping
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${deleting?.title ?? 'game'}?`}
        confirmText={deleting?.title ?? ''}
        actionLabel="Delete this game"
        onConfirm={() => deleting && void run(supabase.from('session_games').delete().eq('id', deleting.id))}
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
  settingsOpen = false,
  onToggleSettings,
  onDelete,
}: {
  game: SessionGame
  settingsOpen?: boolean
  onToggleSettings?: () => void
  onDelete: () => void
}) {
  const gameModule = getGameModule(game.game_type)
  const archived = game.archived_at !== null
  const live = game.status === 'active'
  const canEditSettings = Boolean(gameModule?.ConfigEditor && onToggleSettings && !live && !archived)

  return (
    <li className="flex flex-wrap items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{game.title}</p>
        {/* The game type, unless the title already says it. */}
        {gameModule?.name !== game.title && (
          <p className="text-xs text-muted-foreground">{gameModule?.name ?? `Unknown type “${game.game_type}”`}</p>
        )}
      </div>
      <StatusBadge status={archived ? 'archived' : game.status} />
      {!archived && <PrimaryGameAction game={game} />}
      {/* Not modal, so the delete dialog it opens doesn't fight it for focus. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`More actions for ${game.title}`}>
            <DotsThreeIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          {canEditSettings && (
            <DropdownMenuItem onSelect={onToggleSettings}>
              <GearSixIcon />
              {settingsOpen ? 'Close settings' : 'Settings'}
            </DropdownMenuItem>
          )}
          {archived ? (
            <DropdownMenuItem onSelect={() => void setArchived(game, false)}>
              <ArrowCounterClockwiseIcon />
              Unarchive
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled={live} onSelect={() => void setArchived(game, true)}>
              <ArchiveIcon />
              {live ? 'End the game to archive it' : 'Archive'}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <TrashIcon />
            Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {gameModule && settingsOpen && canEditSettings && onToggleSettings && (
        <GameSettings game={game} gameModule={gameModule} onClose={onToggleSettings} />
      )}
    </li>
  )
}

/** Start, restart or end: the one thing the host most likely wants to do with a game. */
function PrimaryGameAction({ game }: { game: SessionGame }) {
  // In flight: disabled, so a double tap can't deal the game twice.
  const [pending, setPending] = useState(false)
  async function send(request: (game: SessionGame) => Promise<void>) {
    setPending(true)
    try {
      await request(game)
    } finally {
      setPending(false)
    }
  }
  const icon = (idle: ReactNode) => (pending ? <SpinnerIcon className="animate-spin" /> : idle)

  if (game.status === 'active') {
    return (
      <Button variant="secondary" isPending={pending} onClick={() => void send(endGame)}>
        {icon(<StopIcon />)}
        End
      </Button>
    )
  }
  if (game.status === 'finished') {
    return (
      <Confirm
        title={`Restart ${game.title}?`}
        description="It starts again from the beginning and its scores start over. Points you gave by hand stay."
        confirmLabel="Restart"
        onConfirm={() => void send(startGame)}
      >
        {/* Not gold like Start: it wipes the game's scores. */}
        <Button variant="secondary" isPending={pending}>
          {icon(<PlayIcon />)}
          Restart
        </Button>
      </Confirm>
    )
  }
  return (
    <Button isPending={pending} onClick={() => void send(startGame)}>
      {icon(<PlayIcon />)}
      Start
    </Button>
  )
}

/** The live game's host screen, fed the full game state (only hosts can read it). */
function LiveHostView({ session, game }: { session: Session; game: SessionGame }) {
  const gameModule = getGameModule(game.game_type)
  const { data: state } = useGameState(game.id)
  const { data: players } = usePlayers(session.id)
  if (!gameModule?.HostView) return null
  return <gameModule.HostView session={session} game={game} players={players ?? []} state={state} />
}

/** The game's own settings editor, saved to session_games.config. */
function GameSettings({
  game,
  gameModule,
  onClose,
}: {
  game: SessionGame
  gameModule: GameModule
  onClose: () => void
}) {
  const [config, setConfig] = useState<unknown>(() => ({
    ...(gameModule.logic.defaultConfig as object),
    ...game.config,
  }))
  const Editor = gameModule.ConfigEditor
  if (!Editor) return null

  async function save() {
    const { error } = await supabase.from('session_games').update({ config }).eq('id', game.id)
    if (error) return toast.error(error.message)
    toast.success('Settings saved')
    onClose()
  }

  return (
    <div className="grid w-full gap-4 rounded-xl bg-muted/40 p-4">
      <Editor config={config} onChange={setConfig} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void save()}>Save settings</Button>
      </div>
    </div>
  )
}
