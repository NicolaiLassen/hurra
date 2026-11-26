// Participant fusion's parts for a guest's phone only (spec 6.3; docs/identity.md,
// Participant fusion on a phone): the asked picture's header with the seconds
// left, the name picker and its lock bar, the card that says where you are
// with the picture (locked in, time's up), a guess row and your place. While
// a guest picks, names only: no photos and no tokens, which would make it
// easier (the owner's call, 26 Nov). The parts every screen shares (the
// picture, its label chip, a pair) are in parts.tsx.
import { CheckIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'
import { useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { sameName } from '@/games/core/names'
import { LabelChip, PictureArt } from '@/games/fusion/parts'
import { barNames, TILE_NAME_CHARS, tileNameLines, type Part } from '@/games/fusion/phoneLines'
import type { FusionPublicPicture } from '@/games/fusion/shapes'
import { namesFor, shortName } from '@/games/fusion/view'
import { useServerTime } from '@/lib/gameClock'
import { cn } from '@/lib/utils'

type MediaUrl = (path: string, size?: 'full' | 'thumb') => string

/** The seconds turn gold for their last five, as the TV's countdown does. */
const URGENT_MS = 5000

/** Over this many names to pick from, a search field stands above them. */
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
 * The names to pick two of: everyone who has joined and every name in the
 * pictures, never your own, A to Z, as plain tiles with the name and nothing
 * else (no photo, no token: names only make it harder); over SEARCH_FROM
 * names, a search above them. A tap picks, a picked tile turns paper with a
 * check, and a third tap replaces the oldest pick. Picking from a search
 * clears it for the next name; Enter picks the first match. While the lock is
 * on its way, the tiles not picked fade and nothing takes a tap.
 */
export function NamePicker({
  names,
  short,
  pick,
  busy,
  onToggle,
}: {
  /** The names offered, your own left out, in the order to show (guessOptions). */
  names: readonly string[]
  /** What each name is called on its tile (shortNames). */
  short: ReadonlyMap<string, string>
  pick: readonly string[]
  /** The lock is on its way (or can't be sent any more): no taps. */
  busy: boolean
  onToggle: (name: string) => void
}) {
  const [query, setQuery] = useState('')
  const field = useRef<HTMLInputElement>(null)
  const searching = names.length > SEARCH_FROM
  const shown = namesFor(names, searching ? query : '')
  const picked = (name: string) => pick.some((p) => sameName(p, name))

  function choose(name: string) {
    if (busy) return
    onToggle(name)
    if (searching && query !== '') {
      setQuery('')
      // Ready for the second name; with two picked, the keyboard goes so Lock in shows.
      const willHave = picked(name) ? pick.length - 1 : Math.min(2, pick.length + 1)
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
                choose(shown[0])
              }
            }}
            placeholder="Find a name"
            aria-label="Find a name"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
            className="h-12 rounded-phone pl-11 text-base md:text-base"
          />
        </div>
      )}
      <ul aria-label="Names" className={TILES}>
        {shown.map((name) => (
          <li key={name}>
            <NameTile name={shortName(short, name)} full={name} picked={picked(name)} busy={busy} onPick={() => choose(name)} />
          </li>
        ))}
        {shown.length === 0 && (
          <li className="col-span-full py-6 text-center text-paper-2">{query ? `Nobody called “${query.trim()}”.` : 'Nobody else has joined yet.'}</li>
        )}
      </ul>
    </div>
  )
}

/** The picker's tiles: two across, three from 360 px. */
const TILES = 'grid grid-cols-2 gap-2 min-[360px]:grid-cols-3'

/** One name to pick, and nothing else; paper with a check once picked. */
function NameTile({ name, full, picked, busy, onPick }: { name: string; full: string; picked: boolean; busy: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      data-name-tile=""
      aria-pressed={picked}
      aria-label={full}
      aria-disabled={busy || undefined}
      onClick={onPick}
      className={cn(
        // No transition onto the pick: it shows on the very next frame.
        'relative flex h-full min-h-14 w-full items-center justify-center rounded-phone bg-overlay px-2 py-2.5 text-paper outline-none select-none focus-visible:ring-3 focus-visible:ring-gold/50',
        'transition-opacity duration-150 motion-reduce:transition-none',
        !busy && !picked && 'active:bg-rule',
        picked && 'bg-paper text-ink',
        busy && !picked && 'opacity-35',
      )}
    >
      <TileName name={name} />
      {picked && (
        <span aria-hidden className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-chip bg-ink text-paper">
          <CheckIcon weight="bold" className="size-3.5" />
        </span>
      )}
    </button>
  )
}

/** A name on a picker tile (tileNameLines): a line over TILE_NAME_CHARS characters steps down from 17 to 15 px. */
function TileName({ name }: { name: string }) {
  const lines = tileNameLines(name)
  const long = lines.some((line) => line.length > TILE_NAME_CHARS)
  return (
    <span className={cn('grid w-full text-center leading-tight font-bold', long ? 'text-[0.9375rem]' : 'text-[1.0625rem]')}>
      {lines.map((line, i) => (
        <span key={i} className="truncate">
          {line}
        </span>
      ))}
    </span>
  )
}

/**
 * The lock bar, at the bottom of the screen while the picker is up, on the
 * ground (solid, no blur): the two picks' names and the gold Lock in, the
 * screen's one next step, until two are picked. Sending: the button says so
 * and takes no tap. Names only, as the picker.
 *
 * Fixed to the screen's foot, where Show my code stands at other times (it
 * steps aside for the timed prompt), and never mid-screen on a short picker:
 * the phone's toasts stack from 96 px up, and an open one there could take the
 * Lock in tap. A spacer keeps the last row of names above it. Fixed through
 * `[position:fixed]`, not the `fixed` class, which PhoneHome shows even while
 * the game's view is held out of sight (that is for layers a guest opened).
 */
export function LockBar({ names, sending, canLock, onLock }: { names: readonly string[]; sending: boolean; canLock: boolean; onLock: () => void }) {
  return (
    <>
      <div aria-hidden className="h-20" />
      <div data-lock-bar="" className="inset-x-0 bottom-0 z-40 bg-ground pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] [position:fixed]">
        <div className="mx-auto flex max-w-md items-center gap-3 px-4">
          <span className={cn('min-w-0 flex-1 truncate text-[1.0625rem] font-semibold', names.length === 0 && 'text-paper-2')}>{barNames(names)}</span>
          <Button size="xl" className="shrink-0 px-6" disabled={!canLock} isPending={sending} onClick={onLock}>
            {sending ? 'Sending…' : 'Lock in'}
          </Button>
        </div>
      </div>
    </>
  )
}

/**
 * Where you are with the picture being asked, once there is nothing to pick:
 * locked in, or time's up. One size and weight for both, on the raised
 * surface with no gold.
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

/** A lock's two names side by side on overlay tiles, as the picker showed them: names only until the reveal. */
export function TwoNames({ names }: { names: readonly string[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3">
      {names.map((name, i) => (
        <li key={`${i}:${name}`} className="flex min-h-14 min-w-0 items-center justify-center rounded-phone bg-overlay px-3 py-2">
          <span className="min-w-0 truncate text-lg font-bold">{name}</span>
        </li>
      ))}
    </ul>
  )
}

/** "You have 3 points, 4th of the face detectives so far.": the rank gold only for the leader. */
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
