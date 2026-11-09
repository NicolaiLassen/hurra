import { ArrowSquareOutIcon, CopyIcon, TelevisionSimpleIcon } from '@phosphor-icons/react'
import { useCallback, useEffect, useState, type ComponentProps } from 'react'
import IssuedCodeView from '@/components/host/IssuedCodeView'
import { useIssuedCode } from '@/components/host/useIssuedCode'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { issueScreenCode } from '@/lib/queries'
import { toast } from '@/lib/toast'

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('Address copied')
  } catch {
    // Clipboard access can be refused: show it so it can be copied by hand.
    toast(text)
  }
}

/**
 * Pair a TV (docs/engine-v2.md, 7.2 and 7.3): a button and its dialog.
 * Opening the dialog issues a pairing code for the party; on the TV laptop,
 * /tv/<join code> asks for it. The dialog closes by itself once the party has
 * one more paired screen.
 */
export default function PairTvButton({
  sessionId,
  joinCode,
  screens,
  label = 'Pair a TV',
  ...button
}: {
  sessionId: string
  joinCode: string
  /** snapshot.screens: the party's paired TVs. */
  screens: number | null
  label?: string
} & Omit<ComponentProps<typeof Button>, 'onClick' | 'children'>) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  return (
    <>
      <Button variant="secondary" size="lg" {...button} onClick={() => setOpen(true)}>
        <TelevisionSimpleIcon />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          {/* Mounted only while open, so each opening issues a fresh code. */}
          <PairTv sessionId={sessionId} joinCode={joinCode} screens={screens} onPaired={close} />
        </DialogContent>
      </Dialog>
    </>
  )
}

function PairTv({
  sessionId,
  joinCode,
  screens,
  onPaired,
}: {
  sessionId: string
  joinCode: string
  screens: number | null
  onPaired: () => void
}) {
  const issue = useCallback(() => issueScreenCode(sessionId), [sessionId])
  const code = useIssuedCode(issue)
  // The screens there were when the dialog opened: one more means the TV typed the code.
  const [before] = useState(() => screens ?? 0)
  const paired = (screens ?? 0) > before

  useEffect(() => {
    if (!paired) return
    toast.success('The TV is paired', { description: 'It shows the party now.' })
    onPaired()
  }, [paired, onPaired])

  const address = `${window.location.origin}/tv/${joinCode}`

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-lg font-semibold">Pair a TV</DialogTitle>
        <DialogDescription>
          On the TV laptop, open this address and type the code. This closes by itself once the TV is paired.
        </DialogDescription>
      </DialogHeader>
      <div className="flex items-center gap-2 rounded-xl bg-muted/60 py-1 pr-1 pl-3">
        <span className="min-w-0 flex-1 truncate font-mono text-sm">{address}</span>
        <Button variant="ghost" size="icon-lg" aria-label="Copy the TV address" onClick={() => void copy(address)}>
          <CopyIcon />
        </Button>
      </div>
      <IssuedCodeView code={code} className="py-2" />
      <DialogFooter>
        <Button asChild variant="outline" size="lg">
          <a href={`/tv/${joinCode}`} target="_blank" rel="noreferrer">
            Preview the TV
            <ArrowSquareOutIcon />
          </a>
        </Button>
        <DialogClose asChild>
          <Button size="lg">Done</Button>
        </DialogClose>
      </DialogFooter>
    </>
  )
}
