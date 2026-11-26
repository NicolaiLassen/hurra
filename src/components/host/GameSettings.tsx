import { ArrowClockwiseIcon } from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import Confirm from '@/components/Confirm'
import { errorMessage } from '@/components/host/hostCalls'
import { Button } from '@/components/ui/button'
import type { GameGuest } from '@/games/core/Game'
import type { GameModule } from '@/games/types'
import { countingUploads, gameMediaUrl, uploadGameMedia } from '@/lib/media'
import { readGameSettings, saveGameSettings } from '@/lib/queries'
import { toast } from '@/lib/toast'
import type { Player, Session, SessionGame } from '@/lib/types'

/**
 * A game's own settings editor (its ConfigEditor), loaded from game_settings
 * and saved there (hosts only: the quiz's answers, who is in each picture).
 * The settings are frozen into the game when it starts, so they're edited
 * while it isn't live. The editor gets the whole guest list, so settings can
 * name guests who haven't joined yet (docs/guest-list.md). Images are re-encoded in the browser and uploaded to the
 * public game-media bucket.
 */
export default function GameSettings({
  session,
  game,
  gameModule,
  players,
  guests,
  onClose,
}: {
  session: Session
  game: SessionGame
  gameModule: GameModule
  players: Player[]
  /** Everyone on the guest list, joined or still expected, for editors that name guests. */
  guests: readonly GameGuest[]
  onClose: () => void
}) {
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<{ attempt: number; config?: Record<string, unknown>; error?: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    readGameSettings(game.id).then(
      (saved) => {
        // The game's defaults under what was saved, as the engine merges them at start.
        if (!cancelled) setLoaded({ attempt, config: { ...(gameModule.logic.defaultConfig as Record<string, unknown>), ...(saved ?? {}) } })
      },
      (error: unknown) => {
        if (!cancelled) setLoaded({ attempt, error: errorMessage(error) })
      },
    )
    return () => {
      cancelled = true
    }
  }, [game.id, gameModule, attempt])

  const current = loaded?.attempt === attempt ? loaded : null
  if (current?.error) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-overlay p-4 text-sm">
        <p className="flex-1 text-destructive">{current.error}</p>
        <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
          <ArrowClockwiseIcon />
          Try again
        </Button>
      </div>
    )
  }
  if (!current?.config) return <p className="rounded-lg bg-overlay p-4 text-sm text-paper-2">Loading the settings…</p>
  return (
    <SettingsForm
      session={session}
      game={game}
      gameModule={gameModule}
      players={players}
      guests={guests}
      initial={current.config}
      onClose={onClose}
    />
  )
}

function SettingsForm({
  session,
  game,
  gameModule,
  players,
  guests,
  initial,
  onClose,
}: {
  session: Session
  game: SessionGame
  gameModule: GameModule
  players: Player[]
  guests: readonly GameGuest[]
  initial: Record<string, unknown>
  onClose: () => void
}) {
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
  const dirty = useMemo(() => JSON.stringify(config) !== JSON.stringify(initial), [config, initial]) || uploads > 0
  const Editor = gameModule.ConfigEditor
  if (!Editor) return null

  async function save() {
    setSaving(true)
    try {
      await saveGameSettings(game.id, config as Record<string, unknown>)
    } catch (error) {
      toast.error(errorMessage(error))
      setSaving(false)
      return
    }
    // The same check the game runs when it starts, so a problem shows now, not on Start.
    const problem = startProblem(gameModule, config)
    if (problem) toast.warning('Settings saved', { description: `Before you start: ${problem}` })
    else toast.success('Settings saved')
    onClose()
  }

  return (
    // A solid well in the games panel; the editors' cards inside it stand on raised, their fields on overlay (docs/identity.md).
    <div className="grid w-full min-w-0 gap-4 rounded-lg bg-overlay p-4">
      <Editor config={config} onChange={setConfig} session={session} game={game} players={players} guests={guests} media={media} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="lg" disabled={saving} onClick={() => (dirty ? setDiscarding(true) : onClose())}>
          Cancel
        </Button>
        <Button size="lg" isPending={saving || uploads > 0} onClick={() => void save()}>
          {uploads > 0 ? 'Uploading…' : 'Save settings'}
        </Button>
      </div>
      <Confirm
        open={discarding}
        onOpenChange={setDiscarding}
        title="Throw away your changes?"
        description={`The settings of ${game.title} stay as they were saved.`}
        confirmLabel="Throw away"
        cancelLabel="Keep editing"
        onConfirm={onClose}
      />
    </div>
  )
}

/** The game's own check of its settings (parseConfig), as the engine runs it at start; null when they would start. */
function startProblem(gameModule: GameModule, config: unknown): string | null {
  try {
    gameModule.logic.parseConfig?.(config as Record<string, unknown>)
    return null
  } catch (error) {
    return errorMessage(error)
  }
}
