import { useId, useState } from 'react'
import { addSummary, keptNote, someNames } from '@/components/host/guestListWords'
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
import { foldName } from '@/lib/format'
import { GameCallError } from '@/lib/gameApi'
import { MAX_NAMES_PER_ADD, namesFromText } from '@/lib/guestList'
import { addGuests } from '@/lib/queries'
import { toast } from '@/lib/toast'
import { useLive } from '@/lib/useLive'

/**
 * Add guests (docs/guest-list.md, 7.2): one name per line, typed or pasted
 * (a plain list, a Markdown table or rows copied from a table), added to the
 * guest list as still expected. The names as they will be stored show under
 * the field before Add. Names already in the party are left out and named in
 * the toast; names over 40 characters and names repeated in the paste stay in
 * the field to be fixed, and names past the first 100 stay for another Add.
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
  const [leftOver, setLeftOver] = useState<string[]>([])
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
    const keep = [...summary.tooLong, ...summary.repeated, ...pasted.rest]
    if (keep.length === 0) return onDone()
    setText(keep.join('\n'))
    setLeftOver(keptNote({ tooLong: summary.tooLong.length, repeated: summary.repeated, over: pasted.rest.length }))
    setPending(false)
  }

  const counted =
    pasted.over > 0
      ? `Over ${MAX_NAMES_PER_ADD} names: add the rest after these`
      : pasted.names.length > 0
        ? `${pasted.names.length} ${pasted.names.length === 1 ? 'name' : 'names'}` +
          (pasted.repeated.length > 0
            ? `. On more than one line: ${someNames(pasted.repeated.map((r) => r.name))}. Two people? Add a last name or an initial.`
            : '')
        : ''
  const repeatedKeys = new Set(pasted.repeated.map((r) => foldName(r.name)))

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
        {leftOver.map((note) => (
          <p key={note} className="text-sm font-bold text-paper" role="status">
            {note}
          </p>
        ))}
        <Textarea
          id={`${id}-names`}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setError(undefined)
            setLeftOver([])
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
        {/* What goes on the list, as read from the paste: a table's pipes, header row and notes are gone. */}
        {pasted.names.length > 0 && (
          <ol aria-label="Names to add" className="max-h-36 overflow-y-auto rounded-md bg-overlay px-3 py-1.5 text-sm">
            {pasted.names.map((name, i) => (
              <li key={i} className="flex items-baseline gap-2 py-0.5">
                <span className="tv-num w-6 shrink-0 text-right text-paper-3">{i + 1}</span>
                <span className="min-w-0 truncate font-bold">{name}</span>
                {repeatedKeys.has(foldName(name)) && <span className="shrink-0 text-paper-2">repeated</span>}
              </li>
            ))}
          </ol>
        )}
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
