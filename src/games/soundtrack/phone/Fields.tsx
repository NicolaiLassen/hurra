import { CheckIcon, XIcon } from '@phosphor-icons/react'
import type { KeyboardEvent } from 'react'
import { MAX_TYPED, promptKey, type TypedPart } from '@/games/soundtrack/types'
import { fieldState, type FieldState } from '@/games/soundtrack/typing'
import { cn } from '@/lib/utils'
import { FIELD_PART, FIELD_SONG, fieldId } from './model'
import type { Answers } from './useAnswers'

// A song's two typed fields (spec 4.3 and 4.6.1), the same on Now playing and
// in a board row: "1 Title" and "2 Who sings it", one under the other, so the
// keyboard's Next moves from the title to the singer without closing. Each
// saves when it is left (useAnswers), never per letter.

const LABEL: Record<TypedPart, string> = { title: 'Title', singer: 'Who sings it' }
const PLACEHOLDER: Record<TypedPart, string> = { title: 'Type the title', singer: 'Type the singer or band' }
const STATE_WORD: Record<Exclude<FieldState, null>, string> = { saved: 'Saved', saving: 'Saving', unsent: 'Not sent' }

export function SongFields({
  n,
  idPrefix,
  answers,
  focusedKey,
  onFocusKey,
  onDone,
  outlined = [],
  className,
}: {
  n: number
  idPrefix: string
  answers: Answers
  /** The prompt key whose field has the focus, if any. */
  focusedKey: string | null
  onFocusKey: (key: string | null) => void
  /** The singer's Done: after it saves and the keyboard closes. */
  onDone: () => void
  /** Labels outlined because their part is still missing ("Song 5 needs its title."). */
  outlined?: readonly TypedPart[]
  className?: string
}) {
  const field = (part: TypedPart, number: number, enterKeyHint: 'next' | 'done') => {
    const key = promptKey(n, part)
    const focused = focusedKey === key
    const value = answers.fieldText(n, part)
    return (
      <Field
        key={part}
        id={fieldId(idPrefix, n, part)}
        n={n}
        part={part}
        number={number}
        value={value}
        focused={focused}
        state={fieldState({ focused, field: value, saved: answers.savedText(n, part), saving: answers.saving(n, part) })}
        under={answers.under(n, part)}
        outlined={outlined.includes(part)}
        enterKeyHint={enterKeyHint}
        onChange={(text) => answers.change(n, part, text)}
        onFocus={() => onFocusKey(key)}
        onBlur={(text) => {
          onFocusKey(null)
          answers.leave(n, part, text)
        }}
        onEnter={(input) => {
          if (part === 'title') {
            // Next: the singer takes the focus in this same handler, so the keyboard stays up. Leaving the title saves it.
            document.getElementById(fieldId(idPrefix, n, 'singer'))?.focus()
          } else {
            // Done: leaving the singer saves it and closes the keyboard.
            input.blur()
            onDone()
          }
        }}
        onClear={() => answers.change(n, part, '')}
      />
    )
  }
  return (
    <div className={cn('grid gap-3', className)}>
      {field('title', 1, 'next')}
      {field('singer', 2, 'done')}
    </div>
  )
}

function Field({
  id,
  n,
  part,
  number,
  value,
  focused,
  state,
  under,
  outlined,
  enterKeyHint,
  onChange,
  onFocus,
  onBlur,
  onEnter,
  onClear,
}: {
  id: string
  n: number
  part: TypedPart
  number: number
  value: string
  focused: boolean
  state: FieldState
  under: string | null
  outlined: boolean
  enterKeyHint: 'next' | 'done'
  onChange: (text: string) => void
  onFocus: () => void
  onBlur: (text: string) => void
  onEnter: (input: HTMLInputElement) => void
  onClear: () => void
}) {
  const underId = `${id}-under`
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // keyCode 229: a keyboard still composing a word sends its own Enter after it.
    if (event.key !== 'Enter' || event.nativeEvent.keyCode === 229) return
    event.preventDefault()
    onEnter(event.currentTarget)
  }
  return (
    <div className="grid grid-cols-1">
      <div className="flex min-h-[22px] items-center gap-2">
        <label
          htmlFor={id}
          className={cn(
            'on-air text-[13px] leading-none text-paper-2',
            outlined && 'rounded-chip px-1.5 py-1 shadow-[inset_0_0_0_1.5px_var(--color-paper-2)]',
          )}
        >
          <span className="mr-1 text-paper-3">{number}</span>
          {LABEL[part]}
        </label>
        <span aria-live="polite" className={cn('ml-auto inline-flex items-center gap-1 text-[13px] font-bold', state === 'unsent' ? 'text-paper' : 'text-paper-2')}>
          {state === 'saved' && <CheckIcon weight="bold" className="size-3.5" />}
          {state && STATE_WORD[state]}
        </span>
      </div>
      <div className="relative mt-1.5">
        <input
          id={id}
          name={`lydspor-s${n}-${part}`}
          type="text"
          inputMode="text"
          autoCapitalize="words"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          maxLength={MAX_TYPED}
          enterKeyHint={enterKeyHint}
          placeholder={PLACEHOLDER[part]}
          value={value}
          aria-describedby={under ? underId : undefined}
          {...{ [FIELD_SONG]: n, [FIELD_PART]: part }}
          onChange={(event) => onChange(event.target.value)}
          onFocus={onFocus}
          onBlur={(event) => onBlur(event.currentTarget.value)}
          onKeyDown={onKeyDown}
          className={cn(
            // 20 px text: 16 px or more stops iOS zooming in on focus.
            'h-14 w-full min-w-0 rounded-phone bg-overlay pl-3.5 text-[20px] font-semibold text-paper outline-none placeholder:font-medium placeholder:text-paper-3',
            'shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-paper-3)_60%,transparent)] focus:shadow-[inset_0_0_0_2px_var(--color-paper)]',
            focused && value !== '' ? 'pr-14' : 'pr-3.5',
          )}
        />
        {focused && value !== '' && (
          <button
            type="button"
            aria-label="Clear"
            tabIndex={-1}
            // Keeps the focus in the field: clearing sends nothing until the field is left.
            onPointerDown={(event) => event.preventDefault()}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onClear}
            className="absolute top-1.5 right-1.5 grid size-11 place-items-center rounded-[12px] text-paper-2"
          >
            <span className="grid size-[22px] place-items-center rounded-full bg-rule">
              <XIcon weight="bold" className="size-3 text-paper" />
            </span>
          </button>
        )}
      </div>
      {under && (
        <p id={underId} className="mt-1.5 text-sm leading-snug font-semibold text-paper-2">
          {under}
        </p>
      )}
    </div>
  )
}
