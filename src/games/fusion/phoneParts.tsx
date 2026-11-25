// Participant fusion's parts for a guest's phone only (spec 6.3; docs/identity.md,
// Participant fusion on a phone): the asked picture's header with the seconds
// left, the guest picker and its lock bar, the card that says where you are
// with the picture (locked in, in it, time's up), a guess row and your place.
// The parts every screen shares (the picture, its label chip, a pair) are in
// parts.tsx.
import { CheckIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'
import { useRef, useState, type ReactNode } from 'react'
import Avatar from '@/components/Avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PlayerId } from '@/games/core/Game'
import { LabelChip, PictureArt } from '@/games/fusion/parts'
import { barNames, type Part } from '@/games/fusion/phoneLines'
import type { FusionPublicPicture } from '@/games/fusion/shapes'
import { candidatesFor } from '@/games/fusion/view'
import { useServerTime } from '@/lib/gameClock'
import type { Player } from '@/lib/types'
import { cn } from '@/lib/utils'

type MediaUrl = (path: string, size?: 'full' | 'thumb') => string

/** The seconds turn gold for their last five, as the TV's countdown does. */
const URGENT_MS = 5000

/** Over this many guests to pick from, a search field stands above them. */
export const SEARCH_FROM = 16

/**
 * "16 s left": the seconds in condensed figures, gold for the last five, then
 * "Time's up", also sooner when the picture has `closed` (the host revealed it).
 */
export function SecondsLeft({
  endsAt,
  serverNow,
  closed = false,
  className,
}: {
  endsAt: number
  serverNow: () => number
  closed?: boolean
  className?: string
}) {
  const now = useServerTime(serverNow, 250, !closed)
  const left = closed ? 0 : endsAt - now
  // Spans, so it can sit inside a button (Guess, on the section's row).
  if (left <= 0) return <span className={cn('text-[1.0625rem] font-semibold whitespace-nowrap text-paper-2', className)}>Time's up</span>
  return (
    <span className={cn('inline-flex items-baseline gap-1.5 text-[1.0625rem] font-semibold whitespace-nowrap text-paper-2', className)}>
      <span className={cn('text-[1.75rem] leading-none tv-num', left <= URGENT_MS ? 'text-gold' : 'text-paper')}>
        {Math.ceil(left / 1000)}
      </span>
      s left
    </span>
  )
}

/**
 * The picture being guessed, at the top of the phone: its thumbnail (the TV
 * is the show; this is for the guests at the back), its label chip, "Who is
 * in it?" and the seconds left at the right.
 */
export function AskHeader({
  picture,
  endsAt,
  closed,
  serverNow,
  mediaUrl,
}: {
  picture: FusionPublicPicture
  endsAt: number
  /** The picture takes no more locks: the seconds say "Time's up". */
  closed: boolean
  serverNow: () => number
  mediaUrl: MediaUrl
}) {
  return (
    <div className="flex items-center gap-3.5">
      <PictureArt picture={picture} mediaUrl={mediaUrl} size="thumb" className="size-16 shrink-0 rounded-tile" labelClassName="text-[1.375rem]" />
      <div className="grid min-w-0 flex-1 grid-cols-1 justify-items-start gap-1.5">
        <LabelChip label={picture.label} className="text-[1.0625rem]" />
        <p className="text-phone-head leading-tight font-extrabold">Who is in it?</p>
      </div>
      <SecondsLeft endsAt={endsAt} serverNow={serverNow} closed={closed} className="shrink-0 self-start pt-1" />
    </div>
  )
}

/**
 * Everyone but you, to pick two of: a token (with the guest's photo when they
 * have one) and a first name on each tile, by name; over SEARCH_FROM guests, a
 * search above them. A tap picks, a picked tile turns paper with a check, and
 * a third tap replaces the oldest pick. Picking from a search clears it for the
 * next name; Enter picks the first match. While the lock is on its way, the
 * tiles not picked fade and nothing takes a tap.
 */
export function GuestPicker({
  players,
  meId,
  names,
  pick,
  busy,
  onToggle,
}: {
  players: readonly Player[]
  meId: PlayerId
  /** What each guest is called on the tiles (shortNames). */
  names: ReadonlyMap<PlayerId, string>
  pick: readonly PlayerId[]
  /** The lock is on its way (or can't be sent any more): no taps. */
  busy: boolean
  onToggle: (id: PlayerId) => void
}) {
  const [query, setQuery] = useState('')
  const field = useRef<HTMLInputElement>(null)
  const others = players.filter((p) => p.id !== meId)
  const searching = others.length > SEARCH_FROM
  const shown = candidatesFor(players, meId, searching ? query : '')

  function choose(id: PlayerId) {
    if (busy) return
    onToggle(id)
    if (searching && query !== '') {
      setQuery('')
      // Ready for the second name; with two picked, the keyboard goes so Lock in shows.
      const willHave = pick.includes(id) ? pick.length - 1 : Math.min(2, pick.length + 1)
      if (willHave < 2) field.current?.focus()
      else field.current?.blur()
    }
  }

  return (
    <div className="grid grid-cols-1 gap-3">
      {searching && (
        <div className="relative">
          <MagnifyingGlassIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-paper-3" />
          <Input
            ref={field}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && query.trim() !== '' && shown[0]) {
                event.preventDefault()
                choose(shown[0].id)
              }
            }}
            placeholder="Find a guest"
            aria-label="Find a guest"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
            className="h-12 rounded-phone pl-11 text-base md:text-base"
          />
        </div>
      )}
      <ul aria-label="Guests" className="grid grid-cols-3 gap-2 min-[360px]:grid-cols-4">
        {shown.map((p) => {
          const picked = pick.includes(p.id)
          return (
            <li key={p.id}>
              <button
                type="button"
                data-guest-tile=""
                aria-pressed={picked}
                aria-disabled={busy || undefined}
                onClick={() => choose(p.id)}
                className={cn(
                  // No transition onto the pick: it shows on the very next frame.
                  'relative flex w-full flex-col items-center gap-1.5 rounded-phone bg-overlay px-1 pt-2.5 pb-2 text-paper outline-none select-none focus-visible:ring-3 focus-visible:ring-gold/50',
                  'transition-opacity duration-150 motion-reduce:transition-none',
                  !busy && !picked && 'active:bg-rule',
                  picked && 'bg-paper text-ink',
                  busy && !picked && 'opacity-35',
                )}
              >
                <span className="relative">
                  {/* Ink round a picked token, so a paper guest's token stays a token on the paper tile. */}
                  <Avatar name={p.name} playerId={p.id} className={cn('size-11', picked && 'ring-2 ring-ink')} />
                  {picked && (
                    <span aria-hidden className="absolute -right-1.5 -bottom-1.5 grid size-5 place-items-center rounded-chip bg-ink text-paper">
                      <CheckIcon weight="bold" className="size-3.5" />
                    </span>
                  )}
                </span>
                <span className="w-full truncate text-center text-[0.9375rem] leading-tight font-semibold">{names.get(p.id) ?? p.name}</span>
              </button>
            </li>
          )
        })}
        {shown.length === 0 && (
          <li className="col-span-full py-6 text-center text-paper-2">
            {query ? `Nobody called “${query.trim()}”.` : 'Nobody else has joined yet.'}
          </li>
        )}
      </ul>
    </div>
  )
}

/**
 * The lock bar, at the bottom of the screen while the picker is up, on the
 * ground (solid, no blur): the two picks as tokens (or empty rule squares),
 * their names, and the gold Lock in, the screen's one next step, until two
 * are picked. Sending: the button says so and takes no tap.
 */
export function LockBar({
  pick,
  players,
  names,
  sending,
  canLock,
  onLock,
}: {
  pick: readonly PlayerId[]
  players: readonly Player[]
  names: readonly string[]
  sending: boolean
  canLock: boolean
  onLock: () => void
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 bg-ground px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex shrink-0 gap-1.5">
          {[0, 1].map((slot) => {
            const id = pick[slot]
            const player = id ? players.find((p) => p.id === id) : undefined
            return player ? (
              <Avatar key={player.id} name={player.name} playerId={player.id} className="size-10" />
            ) : (
              <span key={`empty-${slot}`} className="size-10 rounded-token border-2 border-rule" />
            )
          })}
        </span>
        <span className="min-w-0 flex-1 truncate text-[1.0625rem] font-semibold">{barNames(names)}</span>
        <Button size="xl" className="shrink-0 px-6" disabled={!canLock} isPending={sending} onClick={onLock}>
          {sending ? 'Sending…' : 'Lock in'}
        </Button>
      </div>
    </div>
  )
}

/**
 * Where you are with the picture being asked, once there is nothing to pick:
 * locked in, in the picture, or time's up. One size and weight for all, on
 * the raised surface with no colour, so a glance from the next seat can't
 * tell "This one is you." from "Locked in".
 */
export function MomentCard({ head, line, children }: { head: string; line: string | null; children?: ReactNode }) {
  return (
    <div className="grid min-h-52 grid-cols-1 content-start gap-4 rounded-phone bg-raised p-5 duration-300 animate-in fade-in-0 motion-reduce:animate-none">
      <div className="grid grid-cols-1 gap-1.5">
        <p className="text-phone-head leading-tight font-extrabold text-balance break-words">{head}</p>
        {line && <p className="text-[1.0625rem] leading-snug text-paper-2">{line}</p>}
      </div>
      {children}
    </div>
  )
}

/** Two guests side by side, 64 px tokens and their names: a lock, or who it was. */
export function TwoTokens({ people, players, names }: { people: readonly PlayerId[]; players: readonly Player[]; names: readonly string[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3">
      {people.map((id, i) => (
        <li key={id} className="flex min-w-0 items-center gap-3">
          <Avatar name={players.find((p) => p.id === id)?.name ?? names[i]} playerId={id} className="size-16 shrink-0" />
          <span className="min-w-0 truncate text-lg font-bold">{names[i]}</span>
        </li>
      ))}
    </ul>
  )
}

/** "You have 3 points, 4th so far.": the rank gold only for the leader. */
export function PlaceLine({ parts, className }: { parts: Part[] | null; className?: string }) {
  if (!parts) return null
  return (
    <p className={cn('text-lg font-semibold', className)}>
      {parts.map((part, i) => (
        <span key={i} className={cn(part.leader && 'text-gold')}>
          {part.text}
        </span>
      ))}
    </p>
  )
}

/**
 * One revealed picture in "Your guesses": its thumbnail, label chip, who it
 * was, and how it went for you, the points in paper when it scored.
 */
export function GuessRow({
  picture,
  who,
  outcome,
  scored,
  mediaUrl,
}: {
  picture: FusionPublicPicture
  who: string
  outcome: string
  scored: boolean
  mediaUrl: MediaUrl
}) {
  return (
    <li className="flex min-h-14 items-center gap-3 rounded-phone bg-raised py-2 pr-3 pl-2">
      <PictureArt picture={picture} mediaUrl={mediaUrl} size="thumb" className="size-10 shrink-0 rounded-tile" labelClassName="text-sm" />
      <div className="grid min-w-0 flex-1 grid-cols-1 gap-0.5">
        <p className="flex min-w-0 items-center gap-2">
          <LabelChip label={picture.label} className="shrink-0 text-sm" />
          <span className="min-w-0 truncate font-semibold">{who}</span>
        </p>
        <p className={cn('text-sm', scored ? 'font-semibold text-paper' : 'text-paper-2')}>{outcome}</p>
      </div>
    </li>
  )
}
