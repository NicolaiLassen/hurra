import { useState } from 'react'
import { errorMessage } from '@/components/host/hostCalls'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** A name field in a dialog: for a party, a game or a player. A refusal shows under the field. */
export default function RenameDialog({
  open,
  onOpenChange,
  title,
  description,
  label = 'Name',
  initial,
  maxLength,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  label?: string
  initial: string
  maxLength: number
  /** Saves the trimmed name; throws with the reason when it can't. */
  onSave: (name: string) => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Mounted only while open, so the field starts from the current name each time. */}
        <RenameForm
          title={title}
          description={description}
          label={label}
          initial={initial}
          maxLength={maxLength}
          onSave={onSave}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function RenameForm({
  title,
  description,
  label,
  initial,
  maxLength,
  onSave,
  onDone,
}: {
  title: string
  description?: string
  label: string
  initial: string
  maxLength: number
  onSave: (name: string) => Promise<void>
  onDone: () => void
}) {
  const [name, setName] = useState(initial)
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)
  const trimmed = name.trim()
  const unchanged = trimmed === initial.trim()

  async function save() {
    if (!trimmed || pending) return
    if (unchanged) return onDone()
    setPending(true)
    setError(undefined)
    try {
      await onSave(trimmed)
      onDone()
    } catch (caught) {
      setError(errorMessage(caught))
      setPending(false)
    }
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <DialogHeader>
        <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="rename-field">{label}</Label>
        <Input
          id="rename-field"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setError(undefined)
          }}
          maxLength={maxLength}
          autoComplete="off"
          autoFocus
          aria-invalid={!!error}
          aria-describedby={error ? 'rename-error' : undefined}
        />
        {error && (
          <p id="rename-error" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" size="lg">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" size="lg" disabled={!trimmed} isPending={pending}>
          Save
        </Button>
      </DialogFooter>
    </form>
  )
}
