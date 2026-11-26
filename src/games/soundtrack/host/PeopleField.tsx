import { MagnifyingGlassIcon, PlusIcon, XIcon } from '@phosphor-icons/react'
import { useState, type ReactNode } from 'react'
import Avatar from '@/components/Avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { GameGuest } from '@/games/core/Game'
import { cleanName, MAX_NAME_LENGTH, nameFromSetting, nameKey, uniqueNames } from '@/games/core/names'
import { foldName } from '@/lib/format'
import { sortNames } from '@/lib/guestList'
import { cn } from '@/lib/utils'
import { sitOutNames } from '../people'

/** How many suggestions show at once. */
const SHOWN = 8

/** Someone a name can be suggested from: a guest on the list, or a player. */
type Named = { readonly id: string; readonly name: string }

/**
 * A list of typed names, for "Doesn't play this game" (party-night 3.7): the
 * names as chips with a remove button, and Add someone, a name field with
 * suggestions from the guest list and the guests who joined (accents and
 * Danish letters folded, so "soren" finds Søren), so a name is spelled the way
 * the guest joins with it. A name is plain text, not tied to the list: one
 * nobody has joined with yet is kept, and a guest who joins later with it is
 * matched by name. Each chip says whether the name is someone here, someone
 * on the list who hasn't joined ("not here yet"), or nobody on the list yet.
 * A guest's id saved before names reads as their name, and the next change
 * saves it as one; an id on neither list shows as "A guest who left".
 */
export default function PeopleField({
  label,
  guests,
  players = [],
  value,
  onChange,
  empty = 'Nobody',
  disabled = false,
}: {
  label: string
  /** Everyone on the guest list, joined or not: suggestions, and how to read an old id. */
  guests: readonly GameGuest[]
  /** The guests who joined, for suggestions on a party without a list. */
  players?: readonly Named[]
  /** The names as saved (an old setting may hold ids). */
  value: readonly string[]
  /** The new list, as names, each once. */
  onChange: (names: string[]) => void
  /** Shown while nobody is on it. */
  empty?: string
  disabled?: boolean
}) {
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const chips = value.map((saved) => ({ saved, name: nameFromSetting(saved, guests, players) }))
  const taken = new Set(chips.flatMap((chip) => (chip.name === null ? [] : [nameKey(chip.name)])))
  const folded = foldName(query)
  const typed = cleanName(query)
  const known = sortNames(uniqueNames([...players.map((p) => p.name), ...guests.map((g) => g.name)]))
  const matches = known.filter((name) => !taken.has(nameKey(name)) && (folded === '' || foldName(name).includes(folded)))
  // The typed name itself, when it isn't one of the suggestions: kept as typed.
  const exact = known.find((name) => nameKey(name) === nameKey(typed))
  const offerTyped = typed !== '' && exact === undefined && !taken.has(nameKey(typed))
  const tooLong = Array.from(typed).length > MAX_NAME_LENGTH

  function save(next: readonly string[]) {
    onChange(sitOutNames(next, guests, players))
  }

  function add(name: string) {
    if (taken.has(nameKey(name)) || Array.from(cleanName(name)).length > MAX_NAME_LENGTH) return
    save([...value, name])
    setQuery('')
  }

  return (
    <div className="grid grid-cols-1 gap-2" role="group" aria-label={label}>
      <ul className="flex flex-wrap items-center gap-1.5">
        {value.length === 0 && <li className="text-sm text-paper-2">{empty}</li>}
        {chips.map(({ saved, name }) => (
          <li key={saved} className="flex h-8 items-center gap-1.5 rounded-control bg-overlay pr-0.5 pl-1">
            {name ? <Avatar name={name} className="size-6" /> : null}
            <span className={cn('max-w-56 truncate text-sm font-bold', !name && 'pl-1.5 text-paper-2')}>
              {name ?? 'A guest who left'}
              {name && <Mark name={name} guests={guests} players={players} />}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={disabled}
              aria-label={`Remove ${name ?? 'the guest who left'}`}
              onClick={() => save(value.filter((x) => x !== saved))}
            >
              <XIcon />
            </Button>
          </li>
        ))}
        {!adding && (
          <li>
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setAdding(true)}>
              <PlusIcon />
              Add someone
            </Button>
          </li>
        )}
      </ul>
      {adding && (
        <div className="grid grid-cols-1 gap-1.5">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-paper-3" />
              <Input
                autoFocus
                type="search"
                value={query}
                placeholder="Type a name"
                aria-label={`${label}: type a name`}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                className="h-9 pl-9"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    e.stopPropagation()
                    setAdding(false)
                    setQuery('')
                  } else if (e.key === 'Enter' && typed !== '') {
                    // The name as the list spells it when it is on the list, else as typed.
                    e.preventDefault()
                    add(exact ?? typed)
                  }
                }}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setAdding(false)
                setQuery('')
              }}
            >
              Done
            </Button>
          </div>
          {tooLong && <p className="px-1.5 text-sm text-paper-2">Names are at most {MAX_NAME_LENGTH} characters.</p>}
          <ul className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
            {offerTyped && !tooLong && (
              <li>
                <SuggestionButton disabled={disabled} onClick={() => add(typed)}>
                  <PlusIcon className="size-4 shrink-0 text-paper-2" />
                  <span className="min-w-0 truncate">Add “{typed}”</span>
                </SuggestionButton>
              </li>
            )}
            {matches.slice(0, SHOWN).map((name) => (
              <li key={name}>
                <SuggestionButton disabled={disabled} onClick={() => add(name)}>
                  <Avatar name={name} className="size-6" />
                  <span className="min-w-0 truncate">
                    {name}
                    <Mark name={name} guests={guests} players={players} />
                  </span>
                </SuggestionButton>
              </li>
            ))}
            {matches.length === 0 && !offerTyped && (
              <li className="px-1.5 py-2 text-sm text-paper-2">
                {known.length === 0 ? 'Type their name as they will join with it.' : query ? 'Already on it' : 'Everyone on the list is on it'}
              </li>
            )}
          </ul>
          {matches.length > SHOWN && <p className="px-1.5 text-xs text-paper-2">and {matches.length - SHOWN} more: type a name to find them.</p>}
        </div>
      )}
    </div>
  )
}

function SuggestionButton({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="flex h-9 w-full items-center gap-2 rounded-control px-1.5 text-left text-sm font-bold hover:bg-overlay focus-visible:bg-overlay focus-visible:outline-none disabled:opacity-50"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/**
 * How a name stands: nothing for someone here, "(not here yet)" for a guest
 * on the list who hasn't joined, "(not on the list)" for a name nobody on the
 * list has. Only a hint for the spelling: the name is kept either way.
 */
function Mark({ name, guests, players }: { name: string; guests: readonly GameGuest[]; players: readonly Named[] }) {
  const key = nameKey(name)
  const here = players.some((p) => nameKey(p.name) === key) || guests.some((g) => g.joined && nameKey(g.name) === key)
  if (here) return null
  const listed = guests.some((g) => nameKey(g.name) === key)
  return (
    <>
      {' '}
      <span className="font-medium text-paper-3">{listed ? '(not here yet)' : '(not on the list)'}</span>
    </>
  )
}
