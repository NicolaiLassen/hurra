import { useId, useState } from 'react'
import { addSummary } from '@/components/host/guestListWords'
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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { GameCallError } from '@/lib/gameApi'
import { MAX_NAMES_PER_ADD, namesFromText } from '@/lib/guestList'
import { addGuests } from '@/lib/queries'
import { toast } from '@/lib/toast'
import { useLive } from '@/lib/useLive'

/**
 * Add guests (docs/guest-list.md, 7.2): one name per line, typed or pasted,
 * added to the guest list as still expected. Names already in the party are
 * left out and named in the toast; names over 40 characters stay in the field
 * to be shortened, and names past the first 100 stay for another Add.
 */
export default function AddGuestsDialog({
  sessionId,
  listed,
  open,
  onOpenChange,
}: {
  sessionId: string
  /** Every name on the list now, so a name left out reads as the list has it. */
  listed: readonly string[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Mounted only while open, so the field starts empty each time. */}
        <AddGuestsForm sessionId={sessionId} listed={listed} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function AddGuestsForm({ sessionId, listed, onDone }: { sessionId: string; listed: readonly string[]; onDone: () => void }) {
  const { refresh } = useLive()
  const id = useId()
  const [text, setText] = useState('')
  const [error, setError] = useState<string>()
  // Left in the field after an Add: why they are still there.
  const [leftOver, setLeftOver] = useState<{ why: 'too_long' | 'over'; count: number } | null>(null)
  const [pending, setPending] = useState(false)
  const pasted = namesFromText(text)
  const unique = pasted.names.length - pasted.repeats

  async function add() {
    if (unique === 0 || pending) return
    setPending(true)
    setError(undefined)
    let summary
    try {
      summary = addSummary(await addGuests(sessionId, pasted.names), listed)
    } catch (caught) {
      const code = caught instanceof GameCallError ? caught.code : ''
      setError(
        code === 'archived' ? 'This party is over.' : code === 'too_many' ? `Add at most ${MAX_NAMES_PER_ADD} names at a time.` : errorMessage(caught),
      )
      setPending(false)
      return
    }
    refresh()
    if (summary.title) (summary.added ? toast.success : toast.info)(summary.title, { description: summary.description })
    const keep = [...summary.tooLong, ...pasted.rest]
    if (keep.length === 0) return onDone()
    setText(keep.join('\n'))
    setLeftOver(summary.tooLong.length > 0 ? { why: 'too_long', count: summary.tooLong.length } : { why: 'over', count: keep.length })
    setPending(false)
  }

  const counted =
    pasted.over > 0
      ? `Over ${MAX_NAMES_PER_ADD} names: add the rest after these`
      : pasted.names.length > 0
        ? `${pasted.names.length} ${pasted.names.length === 1 ? 'name' : 'names'}${pasted.repeats > 0 ? `, ${pasted.repeats} repeated` : ''}`
        : ''

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        void add()
      }}
    >
      <DialogHeader>
        <DialogTitle className="text-lg font-semibold">Add guests</DialogTitle>
        <DialogDescription>One name per line. Paste your whole list, or add a few at a time.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor={`${id}-names`}>Names</Label>
        {leftOver && (
          <p className="text-sm font-bold text-paper" role="status">
            {leftOver.why === 'over'
              ? `These are the names after the first ${MAX_NAMES_PER_ADD}. Add them now.`
              : leftOver.count === 1
                ? 'This name is over 40 characters. Shorten it and add it again.'
                : 'These are over 40 characters. Shorten them and add them again.'}
          </p>
        )}
        <Textarea
          id={`${id}-names`}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setError(undefined)
          }}
          onKeyDown={(e) => {
            // Enter starts a new name; Cmd or Ctrl with Enter adds them.
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void add()
            }
          }}
          rows={10}
          autoFocus
          autoComplete="off"
          autoCapitalize="words"
          spellCheck={false}
          placeholder={'Ana\nBo\nMads Holm'}
          className="max-h-[50dvh] resize-y field-sizing-fixed"
          aria-invalid={!!error}
          aria-describedby={`${id}-count${error ? ` ${id}-error` : ''}`}
        />
        <p id={`${id}-count`} className="min-h-5 text-sm text-paper-2" aria-live="polite">
          {counted}
        </p>
        {error && (
          <p id={`${id}-error`} className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="ghost" size="lg">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" size="lg" disabled={unique === 0} isPending={pending}>
          {unique === 0 ? 'Add guests' : unique === 1 ? 'Add 1 guest' : `Add ${unique} guests`}
        </Button>
      </DialogFooter>
    </form>
  )
}
