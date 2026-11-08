import { CrownIcon, DetectiveIcon, QrCodeIcon, SkullIcon, SwordIcon, type Icon } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { toast } from '@/lib/toast'
import ScanSheet from '@/components/ScanSheet'
import SecretCard from '@/components/SecretCard'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import type { EliminationGame, Method } from '@/games/elimination/logic'
import SurvivorMeter from '@/games/elimination/SurvivorMeter'
import WhoIsLeft from '@/games/elimination/WhoIsLeft'
import type { PlayerViewProps } from '@/games/types'
import type { Player } from '@/lib/types'
import { cn } from '@/lib/utils'

export default function PlayerView({
  game,
  player,
  players,
  publicState,
  view,
  act,
  scannedCode,
  onScanHandled,
}: PlayerViewProps<EliminationGame>) {
  const [scanning, setScanning] = useState(false)
  const [target, setTarget] = useState<Player | null>(null)
  const [busy, setBusy] = useState(false)

  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? 'Someone'
  const total = publicState.alive.length + publicState.out.length

  // A code scanned with the camera app opens the same dialog as a scan in the sheet.
  const scannedPlayer = scannedCode ? players.find((p) => p.code === scannedCode) : undefined
  let scanProblem: string | null = null
  if (scannedCode && view !== undefined && players.length > 0) {
    if (!scannedPlayer) scanProblem = "That code isn't from this party"
    else if (scannedPlayer.id === player.id) scanProblem = "That's your own code"
    else if (view?.status === 'out') scanProblem = "You're out, so you can't knock anyone out"
    else if (view?.status === 'winner') scanProblem = 'The game is over'
    else if (view?.status !== 'alive') scanProblem = "You'll be dealt in next round"
  }
  const scanTarget = scannedCode && !scanProblem && view?.status === 'alive' ? (scannedPlayer ?? null) : null
  const dialogTarget = target ?? scanTarget

  useEffect(() => {
    if (!scanProblem) return
    toast.error(scanProblem)
    onScanHandled?.()
  }, [scanProblem, onScanHandled])

  function onCode(code: string) {
    setScanning(false)
    const scanned = players.find((p) => p.code === code)
    if (!scanned) return toast.error("That code isn't from this party")
    if (scanned.id === player.id) return toast.error("That's your own code")
    setTarget(scanned)
  }

  function closeDialog() {
    setTarget(null)
    if (scannedCode) onScanHandled?.()
  }

  async function knockOut(scanned: Player, method: Method) {
    setBusy(true)
    try {
      // The game announces the result to both players (with a sound); nothing to add here.
      await act({ type: method, target: scanned.id })
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
      closeDialog()
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-semibold tracking-widest text-primary uppercase">Now playing</p>
        <h2 className="truncate text-2xl font-bold">{game.title}</h2>
      </header>

      <SurvivorMeter alive={publicState.alive.length} total={total} />

      {view === undefined && <p className="py-8 text-center text-muted-foreground">Dealing tasks…</p>}

      {view?.status === 'alive' && (
        <>
          <SecretCard label="task">{view.task}</SecretCard>
          <Button size="xl" className="w-full" onClick={() => setScanning(true)}>
            <QrCodeIcon />
            Got someone? Scan their code
          </Button>
          <ul className="grid gap-2.5 text-sm text-muted-foreground">
            <li className="flex gap-2.5">
              <SwordIcon weight="duotone" className="mt-0.5 size-5 shrink-0 text-confetti-pink" />
              <span>
                <span className="font-semibold text-foreground">Tag:</span> get someone to do your task. They're out and
                their task is yours.
              </span>
            </li>
            <li className="flex gap-2.5">
              <DetectiveIcon weight="duotone" className="mt-0.5 size-5 shrink-0 text-confetti-teal" />
              <span>
                <span className="font-semibold text-foreground">Catch:</span> spot someone trying their task on you.
                They're out and you keep yours.
              </span>
            </li>
          </ul>
          {view.knockouts > 0 && (
            <p className="text-center text-sm font-semibold">You've knocked out {view.knockouts} so far.</p>
          )}
        </>
      )}

      {view?.status === 'out' && (
        <div className="space-y-4 rounded-3xl bg-destructive/10 p-6 text-center ring-1 ring-destructive/30">
          <SkullIcon weight="duotone" className="mx-auto size-16 text-destructive" />
          <div>
            <p className="text-3xl font-black">You're out</p>
            <p className="mt-2 text-muted-foreground">
              {view.method === 'catch'
                ? `${nameOf(view.by)} caught you trying “${view.task}”`
                : `${nameOf(view.by)} got you with “${view.task}”`}
            </p>
          </div>
          <p className="text-sm">
            {publicState.winner ? (
              <span className="inline-flex items-center gap-1.5">
                <CrownIcon weight="fill" className="text-primary" />
                {nameOf(publicState.winner)} is the last one standing.
              </span>
            ) : (
              `${publicState.alive.length} still standing. Cheer them on!`
            )}
            {view.knockouts > 0 && ` You knocked out ${view.knockouts} before that.`}
          </p>
        </div>
      )}

      {view?.status === 'winner' && (
        <div className="space-y-3 rounded-3xl bg-primary/15 p-6 text-center ring-1 ring-primary/40">
          <CrownIcon weight="duotone" className="mx-auto size-16 text-primary" />
          <p className="text-3xl font-black">Last one standing!</p>
          <p className="text-muted-foreground">You knocked out {view.knockouts} and nobody got you.</p>
        </div>
      )}

      {(view === null || view?.status === 'spectator') && (
        <p className="py-6 text-center text-muted-foreground">
          This round started before you joined. You'll be dealt in next time.
        </p>
      )}

      <section className="space-y-2 border-t pt-4">
        <h3 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">Players</h3>
        <WhoIsLeft players={players} publicState={publicState} meId={player.id} />
      </section>

      {scanning && (
        <ScanSheet
          player={player}
          hint="Scan the code of the person you got, or caught"
          onCode={onCode}
          onClose={() => setScanning(false)}
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
    </div>
  )
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
