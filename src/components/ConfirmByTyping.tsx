import { useState, type ReactNode } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/**
 * For actions that can't be undone: the confirm button only unlocks once the
 * host has typed the exact name of the thing being destroyed, GitHub style.
 */
export default function ConfirmByTyping({
  open,
  onOpenChange,
  title,
  children,
  confirmText,
  actionLabel,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** What will be lost. */
  children: ReactNode
  /** The exact text the host must type. */
  confirmText: string
  actionLabel: string
  onConfirm: () => void
}) {
  const [typed, setTyped] = useState('')
  const matches = typed.trim() === confirmText.trim()

  function change(next: boolean) {
    if (!next) setTyped('')
    onOpenChange(next)
  }

  return (
    <AlertDialog open={open} onOpenChange={change}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">{children}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!matches) return
            onConfirm()
            change(false)
          }}
        >
          <Label htmlFor="confirm-by-typing">
            Type <strong className="font-mono text-foreground">{confirmText}</strong> to confirm
          </Label>
          <Input
            id="confirm-by-typing"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoFocus
          />
        </form>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          {/* Solid red once armed. Important (!) because the destructive variant's dark: styles would win otherwise. */}
          <AlertDialogAction
            variant="destructive"
            disabled={!matches}
            className={cn(matches && 'bg-destructive! text-background! hover:bg-destructive/90!')}
            onClick={onConfirm}
          >
            {actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
