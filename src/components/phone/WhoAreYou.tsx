import {
  ArrowLeftIcon,
  KeyIcon,
  MagnifyingGlassIcon,
  SpinnerIcon,
  UserPlusIcon,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Avatar from '@/components/Avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { matchNames, sortNames } from '@/lib/guestList'
import type { PublicSession } from '@/lib/types'
import { SEARCH_FROM } from '@/pages/joinScreen'

/** A note at the top of a join screen: a solid panel with an icon (docs/identity.md, The host room: wells and notes). */
export function JoinNote({ icon: Icon, children }: { icon: PhosphorIcon; children: ReactNode }) {
  return (
    <p className="mt-6 flex items-start gap-3 rounded-phone bg-raised p-4">
      <Icon weight="bold" className="mt-0.5 size-5 shrink-0 text-paper-2" />
      <span>{children}</span>
    </p>
  )
}

/** A search that finds no free name reads the list again after this pause: a name the host just added shows at once. */
const NO_MATCH_READ_MS = 400

/**
 * Who are you? (docs/guest-list.md, 6.2): the party's free names, sorted the
 * Danish way, as big rows; a search from 9 names; "I'm not on the list" in the
 * thumb zone for a guest the host didn't list. The rows are the action: no
 * gold button here. No logo and the party on one small line, so a small phone
 * shows several names above "I'm not on the list".
 */
export function WhoAreYou({
  party,
  names,
  notes,
  query,
  onQuery,
  onChoose,
  onNotOnList,
  onClaimCode,
  onNoMatch,
}: {
  party: Pick<PublicSession, 'name'>
  names: readonly string[]
  /** The freed note and a refused claim's note, at the top. */
  notes?: ReactNode
  /** The search, kept by the page so "No, go back" finds it as it was. */
  query: string
  onQuery: (query: string) => void
  onChoose: (name: string) => void
  onNotOnList: () => void
  onClaimCode: () => void
  /** The search found no free name: read the list again, in case the host just added it. */
  onNoMatch?: () => void
}) {
  const sorted = useMemo(() => sortNames(names), [names])
  const searching = names.length >= SEARCH_FROM
  const shown = searching ? matchNames(sorted, query) : sorted
  const noMatch = searching && shown.length === 0 && query.trim() !== ''

  useEffect(() => {
    if (!noMatch || !onNoMatch) return
    const timer = setTimeout(onNoMatch, NO_MATCH_READ_MS)
    return () => clearTimeout(timer)
  }, [noMatch, onNoMatch, query])

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pt-6">
      <p className="truncate text-paper-2">You're joining {party.name}</p>
      {notes}

      <h1 className="mt-4 text-3xl font-bold">Who are you?</h1>
      <p className="text-paper-2">Tap your name. Taken names aren't shown.</p>

      {searching && (
        <div className="sticky top-0 z-10 -mx-4 mt-2 bg-ground px-4 py-2">
          <div className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-paper-2" />
            <Input
              type="search"
              value={query}
              onChange={(event) => onQuery(event.target.value)}
              placeholder="Find your name"
              aria-label="Find your name"
              enterKeyHint="search"
              autoComplete="off"
              className="h-12 pl-11 text-lg md:text-lg"
            />
          </div>
        </div>
      )}

      <ul className={searching ? 'mt-1 grid gap-2' : 'mt-4 grid gap-2'}>
        {shown.map((name) => (
          <li key={name}>
            <button
              type="button"
              onClick={() => onChoose(name)}
              className="flex min-h-14 w-full items-center gap-3 rounded-phone bg-raised px-3 py-2 text-left transition-colors outline-none hover:bg-overlay focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-overlay"
            >
              <Avatar name={name} className="size-10" />
              <span className="min-w-0 truncate text-lg font-bold">{name}</span>
            </button>
          </li>
        ))}
      </ul>
      {shown.length === 0 && (
        <p className="py-4 text-paper-2">
          No free name matches “{query.trim()}”. If someone took yours, ask the host to free it.
        </p>
      )}

      <Button variant="ghost" size="lg" className="mt-4 self-center text-paper-2" onClick={onClaimCode}>
        <KeyIcon />
        Got a code from the host?
      </Button>

      <div className="sticky bottom-0 -mx-4 mt-auto bg-ground px-4 pt-3 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
        <Button size="xl" variant="secondary" className="w-full" onClick={onNotOnList}>
          <UserPlusIcon />
          I'm not on the list
        </Button>
      </div>
    </main>
  )
}

/**
 * You're Ana? (docs/guest-list.md, 6.3): the guest's token big, and the one
 * gold step. `onConfirm` takes the name and resolves with the words to show
 * under the button, or null once the page has moved on.
 */
export function ConfirmName({
  name,
  onConfirm,
  onBack,
}: {
  name: string
  onConfirm: () => Promise<string | null>
  onBack: () => void
}) {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setSending(true)
    setError(null)
    const refused = await onConfirm()
    if (refused !== null) {
      setError(refused)
      setSending(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-8">
      <div className="grid justify-items-center gap-3 text-center">
        <Avatar name={name} className="size-32" />
        <h1 className="mt-3 text-3xl font-bold text-balance break-words">You're {name}?</h1>
        <p className="text-lg text-balance text-paper-2">
          Everyone sees you as {name} tonight: on the TV, in the games and in the standings.
        </p>
      </div>
      <div className="mt-8 grid gap-2">
        <Button
          size="xl"
          className="h-auto min-h-13.5 w-full py-3 whitespace-normal"
          isPending={sending}
          onClick={() => void confirm()}
          aria-describedby={error ? 'confirm-error' : undefined}
        >
          {sending && <SpinnerIcon className="animate-spin" />}
          {sending ? 'Joining…' : `Yes, I'm ${name}`}
        </Button>
        {error && (
          <p id="confirm-error" role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button variant="ghost" size="lg" className="self-center text-paper-2" onClick={onBack} disabled={sending}>
          <ArrowLeftIcon />
          No, go back
        </Button>
      </div>
    </main>
  )
}
