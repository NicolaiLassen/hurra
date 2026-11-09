import { DetectiveIcon, SwordIcon, type Icon } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import ScanSheet from '@/components/ScanSheet'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type {
  EliminationAction,
  EliminationPlayerView,
  EliminationPublicState,
  Method,
} from '@/games/elimination/logic'
import { toast } from '@/lib/toast'
import type { Player } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * How a knockout is made, from the full view or the compact card: the scan
 * sheet, then "What happened?" with tag or catch. A code scanned with the
 * camera app (`scannedCode`) opens the same dialog. Both choices are disabled
 * while the knockout is being sent.
 */
export default function KnockoutFlow({
  player,
  players,
  publicState,
  view,
  act,
  scanning,
  onCloseScanner,
  scannedCode,
  onScanHandled,
}: {
  player: Player
  players: Player[]
  publicState: EliminationPublicState
  view: EliminationPlayerView | null | undefined
  act: (action: EliminationAction) => Promise<void>
  /** Whether the scan sheet is open. */
  scanning: boolean
  onCloseScanner: () => void
  scannedCode?: string
  onScanHandled?: () => void
}) {
  const [target, setTarget] = useState<Player | null>(null)
  const [busy, setBusy] = useState(false)

  // A code scanned with the camera app opens the same dialog as a scan in the sheet.
  const ready = Boolean(scannedCode) && view !== undefined && players.length > 0
  const scanned = ready ? players.find((p) => p.code === scannedCode) : undefined
  const scanProblem = ready ? problemWith(scanned, player, view, publicState) : null
  const scanTarget = ready && !scanProblem ? (scanned ?? null) : null
  const dialogTarget = target ?? scanTarget

  useEffect(() => {
    if (!scanProblem) return
    toast.error(scanProblem)
    onScanHandled?.()
  }, [scanProblem, onScanHandled])

  function onCode(code: string) {
    onCloseScanner()
    const found = players.find((p) => p.code === code)
    const problem = problemWith(found, player, view, publicState)
    if (problem || !found) return toast.error(problem ?? "That code isn't from this party")
    setTarget(found)
  }

  function closeDialog() {
    setTarget(null)
    if (scannedCode) onScanHandled?.()
  }

  async function knockOut(scanned: Player, method: Method) {
    setBusy(true)
    // Keep the dialog on this player and use up a camera-scanned code now, so
    // this knockout's own result (e.g. winning) can't re-run the checks above.
    setTarget(scanned)
    if (scannedCode) onScanHandled?.()
    try {
      // The game announces the result to both players (with a sound); nothing to add here.
      await act({ type: method, target: scanned.id })
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
      setTarget(null) // the camera code, if any, is already used up
    }
  }

  return (
    <>
      {scanning && (
        <ScanSheet
          player={player}
          hint="Scan the code of the person you got, or caught"
          onCode={onCode}
          onClose={onCloseScanner}
        />
      )}

      <AlertDialog open={dialogTarget !== null} onOpenChange={(open) => !open && !busy && closeDialog()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>You scanned {dialogTarget?.name}</AlertDialogTitle>
            <AlertDialogDescription>What happened? Only knock them out if it really did.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2">
            <Choice
              icon={SwordIcon}
              tone="pink"
              title="They did my task"
              detail={view?.status === 'alive' ? `“${view.task}”` : undefined}
              disabled={busy}
              onClick={() => dialogTarget && void knockOut(dialogTarget, 'tag')}
            />
            <Choice
              icon={DetectiveIcon}
              tone="teal"
              title="I caught them trying theirs on me"
              detail="You keep your own task"
              disabled={busy}
              onClick={() => dialogTarget && void knockOut(dialogTarget, 'catch')}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Neither, cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/**
 * Why a scanned code can't become a knockout, or null when it can. The game
 * checks again when the knockout arrives; this catches the common cases on the
 * phone, with the other player's name.
 */
function problemWith(
  scanned: Player | undefined,
  me: Player,
  view: EliminationPlayerView | null | undefined,
  publicState: EliminationPublicState,
): string | null {
  if (!scanned) return "That code isn't from this party"
  if (scanned.id === me.id) return "That's your own code"
  if (view?.status === 'out') return "You're out, so you can't knock anyone out"
  if (view?.status === 'winner' || publicState.winner) return 'The game is over'
  if (view?.status !== 'alive') return "You'll be dealt in next round"
  if (publicState.out.includes(scanned.id)) return `${scanned.name} is already out`
  if (!publicState.alive.includes(scanned.id)) return `${scanned.name} joined after this round started`
  return null
}

function Choice({
  icon: ChoiceIcon,
  tone,
  title,
  detail,
  disabled,
  onClick,
}: {
  icon: Icon
  tone: 'pink' | 'teal'
  title: string
  detail?: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 rounded-2xl p-4 text-left ring-1 transition-colors disabled:opacity-50',
        tone === 'pink'
          ? 'bg-confetti-pink/10 ring-confetti-pink/30 hover:bg-confetti-pink/20'
          : 'bg-confetti-teal/10 ring-confetti-teal/30 hover:bg-confetti-teal/20',
      )}
    >
      <ChoiceIcon
        weight="duotone"
        className={cn('size-6 shrink-0', tone === 'pink' ? 'text-confetti-pink' : 'text-confetti-teal')}
      />
      <span>
        <span className="block font-bold">{title}</span>
        {detail && <span className="block text-sm text-muted-foreground">{detail}</span>}
      </span>
    </button>
  )
}
