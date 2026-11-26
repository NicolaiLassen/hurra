import { MagnifyingGlassIcon, PlusIcon, XIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import Avatar from '@/components/Avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { GameGuest, PlayerId } from '@/games/core/Game'
import { foldName } from '@/lib/format'
import { sortNames } from '@/lib/guestList'
import { cn } from '@/lib/utils'

/** How many matches the search lists at once. */
const SHOWN = 8

/**
 * A list of guests, for "Doesn't play this game" and "Who's in this photo"
 * (party-night 3.7): the picked guests as chips with their token and a
 * remove button, and Add someone, which searches the guest list by name
 * (accents and Danish letters folded, so "soren" finds Søren). It lists the
 * whole guest list, so the host can set it up before the party: a guest who
 * hasn't joined is marked "(not here yet)", in the list and on their chip
 * (docs/guest-list.md, 9.3). Someone picked who has left the list shows as
 * "A guest who left", still removable.
 */
export default function PeopleField({
  label,
  guests,
  value,
  onChange,
  max,
  empty = 'Nobody',
  disabled = false,
}: {
  label: string
  /** Everyone on the guest list, joined or not. */
  guests: readonly GameGuest[]
  value: readonly PlayerId[]
  onChange: (ids: PlayerId[]) => void
  /** At most this many. */
  max?: number
  /** Shown while nobody is picked. */
  empty?: string
  disabled?: boolean
}) {
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const full = max !== undefined && value.length >= max
  const picked = new Set(value)
  const folded = foldName(query)
  const matches = sortNames(guests.filter((g) => !picked.has(g.id) && (folded === '' || foldName(g.name).includes(folded))))
  const guestOf = (id: PlayerId) => guests.find((g) => g.id === id) ?? null

  function add(id: PlayerId) {
    onChange([...value, id])
    setQuery('')
    if (max !== undefined && value.length + 1 >= max) setAdding(false)
  }

  return (
    <div className="grid grid-cols-1 gap-2" role="group" aria-label={label}>
      <ul className="flex flex-wrap items-center gap-1.5">
        {value.length === 0 && <li className="text-sm text-paper-2">{empty}</li>}
        {value.map((id) => {
          const guest = guestOf(id)
          const name = guest?.name ?? null
          return (
            <li key={id} className="flex h-8 items-center gap-1.5 rounded-control bg-overlay pr-0.5 pl-1">
              {name ? <Avatar name={name} playerId={id} className="size-6" /> : null}
              <span className={cn('max-w-56 truncate text-sm font-bold', !name && 'pl-1.5 text-paper-2')}>
                {name ?? 'A guest who left'}
                {guest && !guest.joined && <NotHereYet />}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={disabled}
                aria-label={`Remove ${name ?? 'the guest who left'}`}
                onClick={() => onChange(value.filter((x) => x !== id))}
              >
                <XIcon />
              </Button>
            </li>
          )
        })}
        {!adding && (
          <li>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || full || guests.length === 0}
              onClick={() => setAdding(true)}
            >
              <PlusIcon />
              {full ? `${max} at most` : 'Add someone'}
            </Button>
          </li>
        )}
      </ul>
      {guests.length === 0 && <p className="text-sm text-paper-2">Add guests to the guest list, or wait for them to join.</p>}
      {adding && (
        <div className="grid grid-cols-1 gap-1.5">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-paper-3" />
              <Input
                autoFocus
                type="search"
                value={query}
                placeholder="Search by name"
                aria-label={`${label}: search by name`}
                className="h-9 pl-9"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    e.stopPropagation()
                    setAdding(false)
                    setQuery('')
                  } else if (e.key === 'Enter' && matches.length > 0) {
                    e.preventDefault()
                    add(matches[0].id)
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
          <ul className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
            {matches.slice(0, SHOWN).map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={disabled}
                  className="flex h-9 w-full items-center gap-2 rounded-control px-1.5 text-left text-sm font-bold hover:bg-overlay focus-visible:bg-overlay focus-visible:outline-none disabled:opacity-50"
                  onClick={() => add(p.id)}
                >
                  <Avatar name={p.name} playerId={p.id} className="size-6" />
                  <span className="min-w-0 truncate">
                    {p.name}
                    {!p.joined && <NotHereYet />}
                  </span>
                </button>
              </li>
            ))}
            {matches.length === 0 && (
              <li className="px-1.5 py-2 text-sm text-paper-2">{query ? `Nobody called “${query}”` : 'Everyone is on the list'}</li>
            )}
          </ul>
          {matches.length > SHOWN && <p className="px-1.5 text-xs text-paper-2">and {matches.length - SHOWN} more: type a name to find them.</p>}
        </div>
      )}
    </div>
  )
}

/** The mark of a guest on the list who hasn't joined yet. */
function NotHereYet() {
  return (
    <>
      {' '}
      <span className="font-medium text-paper-3">(not here yet)</span>
    </>
  )
}
