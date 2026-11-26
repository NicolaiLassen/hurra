import { useId } from 'react'
import { Input } from '@/components/ui/input'
import { MAX_NAME_LENGTH } from '@/games/core/names'
import type { NameStatus } from '@/games/fusion/people'
import { cn } from '@/lib/utils'

const STATUS_WORDS: Record<Exclude<NameStatus, 'empty'>, string> = {
  here: 'Here',
  expected: 'On the guest list, not here yet',
  unknown: 'Nobody here or on the guest list by this name: check the spelling',
}

/**
 * One person in a picture, as a typed name: a text field with the guest
 * list's names as suggestions (the browser's own list, so it works the same
 * on a phone and a laptop), stored as the text typed. Under it, where that
 * name stands, so a spelling that no guest will join with shows before the
 * night: case, accents and spaces never matter.
 */
export function NameField({
  value,
  onChange,
  suggestions,
  status,
  label,
  placeholder = 'Type a name',
  disabled,
  className,
}: {
  value: string
  onChange: (name: string) => void
  suggestions: readonly string[]
  status: NameStatus
  label: string
  placeholder?: string
  disabled?: boolean
  className?: string
}) {
  const id = useId()
  return (
    <div className={cn('grid min-w-0 grid-cols-1 gap-1', className)}>
      <Input
        value={value}
        list={`${id}-names`}
        maxLength={MAX_NAME_LENGTH}
        placeholder={placeholder}
        aria-label={label}
        aria-describedby={status === 'empty' ? undefined : `${id}-status`}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id={`${id}-names`}>
        {suggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {status !== 'empty' && (
        <p id={`${id}-status`} className={cn('text-xs', status === 'unknown' ? 'font-semibold text-paper' : 'text-paper-2')}>
          {STATUS_WORDS[status]}
        </p>
      )}
    </div>
  )
}
