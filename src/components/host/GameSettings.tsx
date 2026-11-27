import { ArrowClockwiseIcon, ArrowLeftIcon, CheckCircleIcon, GameControllerIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { UNSAFE_DataRouterContext, useBlocker } from 'react-router'
import Confirm from '@/components/Confirm'
import { errorMessage } from '@/components/host/hostCalls'
import { useProgramSettings } from '@/components/host/programSettings'
import TeamPlaySetting from '@/components/host/TeamPlaySetting'
import { Button } from '@/components/ui/button'
import { canPlayInTeams, configOf, setupStatusOf, startProblemOf } from '@/games/registry'
import type { GameModule, SetupStatus } from '@/games/types'
import { guestsOf } from '@/lib/guestList'
import { countingUploads, gameMediaUrl, uploadGameMedia } from '@/lib/media'
import { toast } from '@/lib/toast'
import type { SessionGame, Snapshot } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * A game's settings as a page of its own in the control room (its
 * ConfigEditor), opened from Settings or Set up on its row, and at once for a
 * game just added. The game's name and readiness sit on a bar that stays at
 * the top while the editor scrolls, with Cancel and Save, so they are always
 * in reach; the arrow and Cancel go back to the room, where the host left it.
 * The settings are frozen into the game when it starts, so they're edited
 * while it isn't live. The editor gets the whole guest list, so settings can
 * name guests who haven't joined yet (docs/guest-list.md). Images are
 * re-encoded in the browser and uploaded to the public game-media bucket.
 * A game that can be played in teams (GameModule.teamPlay) has Play in teams
 * above its editor, saved at once, apart from Save (TeamPlaySetting).
 */
export default function GameSettings({
  snapshot,
  game,
  gameModule,
  onClose,
}: {
  snapshot: Snapshot
  game: SessionGame
  gameModule: GameModule
  /** Back to the room: after a save, a cancel, or the arrow. */
  onClose: () => void
}) {
  const settings = useProgramSettings()
  const saved = settings.saved(game.id)
  const GameIcon = gameModule.icon ?? GameControllerIcon
  const head = { title: game.title, kind: gameModule.name !== game.title ? gameModule.name : null, icon: <GameIcon weight="duotone" className="size-6" /> }

  if (saved === undefined) {
    return (
      <SettingsPage {...head} status={null} onBack={onClose} actions={null}>
        {settings.error ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <p className="flex-1 text-paper">{settings.error}</p>
            <Button variant="secondary" onClick={settings.retry}>
              <ArrowClockwiseIcon />
              Try again
            </Button>
          </div>
        ) : (
          <p className="text-sm text-paper-2">Loading the settings…</p>
        )}
      </SettingsPage>
    )
  }
  return <SettingsForm key={game.id} snapshot={snapshot} game={game} gameModule={gameModule} head={head} initial={configOf(gameModule, saved)} onClose={onClose} />
}

function SettingsForm({
  snapshot,
  game,
  gameModule,
  head,
  initial,
  onClose,
}: {
  snapshot: Snapshot
  game: SessionGame
  gameModule: GameModule
  head: { title: string; kind: string | null; icon: ReactNode }
  initial: Record<string, unknown>
  onClose: () => void
}) {
  const settings = useProgramSettings()
  const session = snapshot.session!
  const [config, setConfig] = useState<unknown>(initial)
  const [saving, setSaving] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  // Uploads in flight: an image's path reaches the settings only when its upload
  // ends, so Save waits for them, and Cancel asks first.
  const [uploads, setUploads] = useState(0)
  const media = useMemo(
    () => ({
      upload: countingUploads(
        (file: File) => uploadGameMedia(session.id, game.id, file),
        (change) => setUploads((n) => n + change),
      ),
      url: gameMediaUrl,
    }),
    [session.id, game.id],
  )
  const guests = useMemo(() => guestsOf(snapshot), [snapshot])
  const dirty = useMemo(() => JSON.stringify(config) !== JSON.stringify(initial), [config, initial]) || uploads > 0
  // The readiness as the host edits: the line their row will show once saved.
  const status = setupStatusOf(game.game_type, config as Record<string, unknown>, guests)
  // Set once the host chose to leave, so the guard lets that one navigation through.
  const leaving = useRef(false)
  const dataRouter = useContext(UNSAFE_DataRouterContext) !== null
  const Editor = gameModule.ConfigEditor

  // A reload or a closed tab would lose the changes: the browser asks first.
  useEffect(() => {
    if (!dirty) return
    const ask = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', ask)
    return () => window.removeEventListener('beforeunload', ask)
  }, [dirty])

  if (!Editor) return null

  function leave() {
    leaving.current = true
    onClose()
  }

  async function save() {
    setSaving(true)
    try {
      await settings.save(game.id, config as Record<string, unknown>)
    } catch (error) {
      toast.error(errorMessage(error))
      setSaving(false)
      return
    }
    // The same check the game runs when it starts, so a problem shows now, not on Start.
    const problem = startProblemOf(gameModule, config as Record<string, unknown>)
    if (problem) toast.warning('Settings saved', { description: `Before you start: ${problem}` })
    else toast.success('Settings saved', status && !status.ready ? { description: status.line } : undefined)
    leave()
  }

  const back = () => (dirty ? setDiscarding(true) : leave())

  return (
    <SettingsPage
      {...head}
      status={status}
      onBack={back}
      actions={
        <>
          <Button variant="ghost" size="lg" className="max-sm:px-2.5" disabled={saving} onClick={back}>
            Cancel
          </Button>
          {/* The page's one next step, gold only once there is something to save. */}
          <Button size="lg" className="max-sm:px-3" disabled={!dirty} isPending={saving || uploads > 0} onClick={() => void save()}>
            {uploads > 0 ? 'Uploading…' : 'Save'}
          </Button>
        </>
      }
    >
      {canPlayInTeams(game.game_type) && <TeamPlaySetting snapshot={snapshot} game={game} />}
      <Editor config={config} onChange={setConfig} session={session} game={game} players={snapshot.players} guests={guests} media={media} />
      <Confirm
        open={discarding}
        onOpenChange={setDiscarding}
        title="Throw away your changes?"
        description={`The settings of ${game.title} stay as they were saved.`}
        confirmLabel="Throw away"
        cancelLabel="Keep editing"
        onConfirm={leave}
      />
      {dataRouter && <LeaveGuard when={dirty && !saving} leaving={leaving} title={game.title} />}
    </SettingsPage>
  )
}

/**
 * The browser's back button (or a phone's back gesture) on a page with
 * changes: the same question as Cancel. Only under the app's data router,
 * which can hold a navigation; a test's plain router has no back button.
 */
function LeaveGuard({ when, leaving, title }: { when: boolean; leaving: { current: boolean }; title: string }) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      when && !leaving.current && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
  )
  return (
    <Confirm
      open={blocker.state === 'blocked'}
      onOpenChange={(open) => {
        if (!open && blocker.state === 'blocked') blocker.reset()
      }}
      title="Throw away your changes?"
      description={`The settings of ${title} stay as they were saved.`}
      confirmLabel="Throw away"
      cancelLabel="Keep editing"
      onConfirm={() => {
        if (blocker.state === 'blocked') blocker.proceed()
      }}
    />
  )
}

/**
 * The page: a bar on the ground that stays at the top (back, the game's icon,
 * name and readiness, then the actions), over the editor in an overlay well
 * on a raised panel (docs/identity.md, The host room). The bar is solid, so
 * the editor slides under it, told apart by value.
 */
function SettingsPage({
  title,
  kind,
  icon,
  status,
  onBack,
  actions,
  children,
}: {
  title: string
  kind: string | null
  icon: ReactNode
  status: SetupStatus | null
  onBack: () => void
  actions: ReactNode
  children: ReactNode
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  // The page takes the focus as it opens, so a screen reader starts at its name.
  useEffect(() => heading.current?.focus({ preventScroll: true }), [])
  return (
    <div className="pb-16">
      <div className="sticky top-0 z-30 bg-ground">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-4 py-3 sm:gap-3">
          <Button variant="ghost" size="icon-lg" className="-ml-2 shrink-0" aria-label="Back to the room" title="Back to the room" onClick={onBack}>
            <ArrowLeftIcon />
          </Button>
          <span className="grid size-10 shrink-0 place-items-center rounded-control bg-overlay text-paper-2 max-sm:hidden">{icon}</span>
          <div className="min-w-0 flex-1">
            <h1 ref={heading} tabIndex={-1} className="truncate text-lg leading-tight font-extrabold outline-none sm:text-2xl">
              {title}
            </h1>
            <p className="mt-0.5 truncate text-xs text-paper-2 sm:text-sm">
              {kind ?? 'Settings'}
              {kind && <span className="max-sm:hidden"> settings</span>}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">{actions}</div>
        </div>
        {status && (
          <div className="mx-auto w-full max-w-5xl px-4 pb-3">
            <ReadinessLine status={status} className="text-sm" />
          </div>
        )}
      </div>
      <main className="mx-auto w-full max-w-5xl px-4 pt-1">
        {/* A solid well in a raised panel; the editors' cards inside it stand on raised, their fields on overlay (docs/identity.md). */}
        <section className="rounded-xl bg-raised p-2 sm:p-4" aria-label={`Settings of ${title}`}>
          <div className="grid min-w-0 gap-4 rounded-lg bg-overlay p-3 sm:p-5">{children}</div>
        </section>
      </main>
    </div>
  )
}

/**
 * A game's readiness as a line: a check and the words when it is ready, a
 * warning circle and the words in paper when it isn't (a state never rests on
 * colour alone, and danger is for destructive steps only).
 */
export function ReadinessLine({ status, className }: { status: SetupStatus; className?: string }) {
  const Glyph = status.ready ? CheckCircleIcon : WarningCircleIcon
  return (
    <p className={cn('flex min-w-0 items-start gap-1.5', status.ready ? 'text-paper-2' : 'font-semibold text-paper', className)}>
      <Glyph weight={status.ready ? 'bold' : 'fill'} aria-hidden className="mt-[0.15em] size-[1.1em] shrink-0" />
      <span className="min-w-0">
        <span className="sr-only">{status.ready ? 'Ready: ' : 'Not ready: '}</span>
        {status.line}
      </span>
    </p>
  )
}
