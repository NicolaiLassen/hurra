import { PlusIcon, XIcon } from '@phosphor-icons/react'
import { useState, type ClipboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * Edits a list of short texts (tasks, prompts, questions): change rows in
 * place, remove them, or add new ones. Pasting several lines adds them all.
 */
export default function EditableList({
  items,
  onChange,
  itemLabel,
  placeholder,
}: {
  items: string[]
  onChange: (items: string[]) => void
  /** Singular noun for labels, e.g. "task". */
  itemLabel: string
  placeholder?: string
}) {
  const [draft, setDraft] = useState('')

  function add(texts: string[]) {
    const clean = texts.map((text) => text.trim()).filter(Boolean)
    if (clean.length) onChange([...items, ...clean])
    setDraft('')
  }

  function addPastedLines(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text')
    if (!text.includes('\n')) return
    e.preventDefault()
    add(text.split(/\r?\n/))
  }

  const remove = (index: number) => onChange(items.filter((_, i) => i !== index))

  return (
    <div className="grid gap-2">
      {items.length > 0 && (
        <ol className="grid gap-1.5">
          {items.map((item, i) => (
            <li
              key={i}
              className="flex h-10 items-center gap-2 rounded-lg border border-input bg-background/40 pr-1 pl-3 transition-colors focus-within:border-ring"
            >
              <span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
              <input
                // 16px on phones like the shared Input: smaller text makes iOS zoom in.
                className="h-full min-w-0 flex-1 bg-transparent text-base outline-none md:text-sm"
                value={item}
                aria-label={`${itemLabel} ${i + 1}`}
                onChange={(e) => onChange(items.map((it, j) => (j === i ? e.target.value : it)))}
                // A row emptied by editing disappears when you leave it.
                onBlur={() => !item.trim() && remove(i)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Remove ${itemLabel} ${i + 1}`}
                onClick={() => remove(i)}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ol>
      )}
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={addPastedLines}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            add([draft])
          }}
          placeholder={placeholder ?? `Add a ${itemLabel}`}
          aria-label={`New ${itemLabel}`}
        />
        <Button type="button" variant="secondary" size="lg" disabled={!draft.trim()} onClick={() => add([draft])}>
          <PlusIcon />
          Add
        </Button>
      </div>
    </div>
  )
}
