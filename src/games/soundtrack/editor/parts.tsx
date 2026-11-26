import { ImageIcon, InfoIcon, PlusIcon, UploadSimpleIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react'
import { useState, type ChangeEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { MAX_ALSO } from '../logic'
import { MAX_TYPED } from '../types'
import { startText } from '../host/cue'
import { parseStart, type Issue } from './settings'

/** Problems (the start refuses them) and warnings (it doesn't), each with its icon and never by colour alone. */
export function Issues({ issues, className }: { issues: readonly Issue[]; className?: string }) {
  if (issues.length === 0) return null
  return (
    <ul className={cn('grid gap-1 text-sm', className)}>
      {issues.map((issue) => (
        <li key={`${issue.kind}:${issue.text}`} className={cn('flex items-start gap-1.5', issue.kind === 'problem' ? 'text-destructive' : 'text-paper-2')}>
          {issue.kind === 'problem' ? (
            <WarningCircleIcon weight="fill" className="mt-0.5 shrink-0" aria-label="To fix:" />
          ) : (
            <InfoIcon weight="fill" className="mt-0.5 shrink-0" aria-label="Note:" />
          )}
          <span className="min-w-0">{issue.text}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * A photo with its upload: the square thumbnail (or a quiet tile), and Add
 * photo or Replace. Phones' photos are re-encoded and stripped of their
 * metadata on the way up (the game-media upload).
 */
export function PhotoPicker({
  url,
  label,
  uploading,
  disabled,
  onUpload,
  onRemove,
  className,
}: {
  /** The thumbnail's URL, or null without a photo. */
  url: string | null
  label: string
  uploading: boolean
  disabled?: boolean
  onUpload: (file: File) => void
  onRemove?: () => void
  className?: string
}) {
  const [failed, setFailed] = useState<string | null>(null)
  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = '' // the same file can be picked again after a failure
    if (file) onUpload(file)
  }
  return (
    <div className={cn('grid content-start gap-2', className)}>
      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-overlay">
        {url && failed !== url ? (
          <img src={url} alt={label} width={400} height={400} className="size-full object-cover" onError={() => setFailed(url)} />
        ) : (
          <span className="grid size-full place-items-center text-paper-3" aria-hidden>
            <ImageIcon className="size-8" />
          </span>
        )}
        {uploading && (
          <span className="absolute inset-0 grid place-items-center bg-black/70 text-sm font-bold text-paper">Uploading…</span>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        <Button asChild variant="secondary" size="sm" className={cn('flex-1', (uploading || disabled) && 'pointer-events-none opacity-50')}>
          <label>
            <UploadSimpleIcon />
            {url ? 'Replace' : 'Add photo'}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={uploading || disabled}
              aria-label={url ? `Replace ${label}` : `Add ${label}`}
              onChange={onFile}
            />
          </label>
        </Button>
        {onRemove && url && !uploading && (
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${label}`} disabled={disabled} onClick={onRemove}>
            <XIcon />
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * Other answers that count for a title or a singer: a short list of fields,
 * up to MAX_ALSO, each removable. Empty rows are ignored at the start.
 */
export function AlsoList({
  label,
  items,
  placeholder,
  onChange,
}: {
  label: string
  items: readonly string[]
  placeholder: string
  onChange: (items: string[]) => void
}) {
  const [focus, setFocus] = useState<number | null>(null)
  return (
    <div className="grid grid-cols-1 content-start gap-1.5" role="group" aria-label={label}>
      <p className="text-sm font-medium">{label}</p>
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1">
          <Input
            value={item}
            maxLength={MAX_TYPED}
            placeholder={placeholder}
            aria-label={`${label}, ${i + 1}`}
            autoFocus={focus === i}
            onFocus={() => focus !== null && setFocus(null)}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${label.toLowerCase()} ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <XIcon />
          </Button>
        </div>
      ))}
      {items.length < MAX_ALSO && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="justify-self-start"
          onClick={() => {
            setFocus(items.length)
            onChange([...items, ''])
          }}
        >
          <PlusIcon />
          {items.length === 0 ? 'Add one' : 'Add another'}
        </Button>
      )}
    </div>
  )
}

/**
 * Where the hook starts, as m:ss ("0:48") or whole seconds. While it is
 * typed the field keeps the text; a valid one saves as seconds, and leaving
 * the field shows it as m:ss again.
 */
export function StartField({ id, seconds, onChange }: { id: string; seconds: number; onChange: (seconds: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const invalid = draft !== null && draft.trim() !== '' && parseStart(draft) === null
  return (
    <div className="grid grid-cols-1 content-start gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        Hook starts at
      </label>
      <Input
        id={id}
        inputMode="numeric"
        placeholder="0:48"
        className="tv-num w-24 text-lg md:text-lg"
        value={draft ?? startText(seconds)}
        aria-invalid={invalid || undefined}
        // Typing replaces what is there: a song still at the start opens empty
        // (its placeholder shows the form), and a set time is selected. Typed
        // after "0:00", "0:48" would read "0:000:48" and be dropped on leaving.
        onFocus={(e) => {
          const text = seconds === 0 ? '' : startText(seconds)
          setDraft(text)
          if (text) e.currentTarget.select()
        }}
        onBlur={() => setDraft(null)}
        onChange={(e) => {
          setDraft(e.target.value)
          const parsed = e.target.value.trim() === '' ? 0 : parseStart(e.target.value)
          if (parsed !== null) onChange(parsed)
        }}
      />
      {invalid && <p className="text-sm text-destructive">Use m:ss, like 1:02, within the first hour.</p>}
    </div>
  )
}

/** A label over its field, with an optional quiet line under it. */
export function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 content-start gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-sm text-paper-2">{hint}</p>}
    </div>
  )
}
