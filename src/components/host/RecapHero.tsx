import {
  ChatCircleDotsIcon,
  CrownIcon,
  GameControllerIcon,
  HandCoinsIcon,
  LightningIcon,
  SparkleIcon,
  TrophyIcon,
  UsersThreeIcon,
  type Icon,
} from '@phosphor-icons/react'
import type { CSSProperties, ReactNode } from 'react'
import Avatar from '@/components/Avatar'
import { formatCount, nightHeadline, ordinal, podiumPlaces } from '@/components/host/recapView'
import { PLACE_TONES } from '@/components/placeTones'
import { numberTiles, type NumberTile } from '@/components/tv/recapSlides'
import type { RecapDoc } from '@/lib/recap'
import { cn } from '@/lib/utils'

const NUMBER_ICONS: Record<NumberTile['key'], Icon> = {
  guests: UsersThreeIcon,
  games: GameControllerIcon,
  answers: ChatCircleDotsIcon,
  moves: LightningIcon,
  awards: HandCoinsIcon,
}

/**
 * The top of the recap page (docs/engine-v2.md, 7.4): the night's headline,
 * its numbers and its podium over a soft glow, with a little confetti drifting
 * through (none with reduced motion). `children` is the band under it: where
 * the recap stands and what the host can do with it. Without a night (its read
 * gave up) it is only the party's name and the band.
 */
export default function RecapHero({ doc, partyName, children }: { doc: RecapDoc | null; partyName: string; children?: ReactNode }) {
  const headline = doc ? nightHeadline(doc) : null
  return (
    <section aria-labelledby="recap-party" className="relative isolate overflow-hidden rounded-3xl bg-card ring-1 ring-foreground/10">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(70%_60%_at_30%_0%,color-mix(in_oklch,var(--primary)_18%,transparent),transparent),radial-gradient(45%_60%_at_0%_100%,color-mix(in_oklch,var(--confetti-violet)_16%,transparent),transparent),radial-gradient(40%_55%_at_100%_80%,color-mix(in_oklch,var(--confetti-pink)_12%,transparent),transparent)]"
      />
      {doc && <Confetti />}

      <div className="grid grid-cols-1 gap-x-8 gap-y-6 p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-end">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-semibold tracking-widest text-primary uppercase">
            <SparkleIcon weight="fill" className="size-3.5" />
            Recap of the night
          </p>
          <h1 id="recap-party" className="mt-1 text-2xl font-bold break-words">
            {partyName}
          </h1>
          {headline && (
            <div className="duration-500 animate-in fade-in slide-in-from-bottom-3 motion-reduce:animate-none">
              <p className="mt-5 text-4xl leading-[1.05] font-black tracking-tight text-balance break-words text-primary [text-shadow:0_0_36px_color-mix(in_oklab,var(--color-gold)_35%,transparent)] sm:text-5xl">
                {headline.title}
              </p>
              <p className="mt-3 max-w-xl text-base text-pretty text-muted-foreground sm:text-lg">{headline.line}</p>
            </div>
          )}
          {doc && (
            <ul aria-label="The night in numbers" className="mt-6 flex flex-wrap gap-2">
              {numberTiles(doc).map((tile) => {
                const TileIcon = NUMBER_ICONS[tile.key]
                return (
                  <li
                    key={tile.key}
                    className="flex items-center gap-2 rounded-full bg-background/50 py-1.5 pr-3.5 pl-2.5 text-sm ring-1 ring-foreground/10 backdrop-blur-sm"
                  >
                    <TileIcon weight="duotone" className="size-4 text-primary" />
                    <span className="font-bold">{formatCount(tile.value)}</span>
                    <span className="text-muted-foreground">{tile.label}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        {doc && <Podium doc={doc} />}
      </div>

      {children && <div className="border-t border-foreground/10 bg-background/45 px-5 py-4 backdrop-blur-sm sm:px-8">{children}</div>}
    </section>
  )
}

// The list is in place order, for screen readers; on screen, left to right: 2nd, 1st, 3rd.
const ORDER = ['order-2', 'order-1', 'order-3']
// In the place tones (src/components/placeTones.ts).
const STEPS = [
  { avatar: 'size-16 text-xl ring-4', pedestal: 'h-20' },
  { avatar: 'size-12 text-base ring-[3px]', pedestal: 'h-14' },
  { avatar: 'size-12 text-base ring-[3px]', pedestal: 'h-10' },
]

/**
 * The top three on their steps, as the TV's last slide has them: everyone tied
 * first wears the crown. A screen reader hears each place and points in words.
 */
function Podium({ doc }: { doc: RecapDoc }) {
  const places = podiumPlaces(doc)
  if (places.length === 0) {
    return (
      <div className="grid justify-items-center gap-2 rounded-2xl bg-background/40 p-6 text-center text-sm text-muted-foreground ring-1 ring-foreground/10">
        <TrophyIcon weight="duotone" className="size-10 text-primary/70" />
        The podium fills up as guests score.
      </div>
    )
  }
  return (
    <ol aria-label="The podium" className="flex min-w-0 items-end justify-center gap-3">
      {places.map((guest, slot) => {
        const { row, place } = guest
        const step = STEPS[guest.step]
        const tone = PLACE_TONES[guest.step]
        return (
          <li
            key={row.playerId}
            // Third, then second, then first rises onto its step.
            style={{ animationDelay: `${250 + (2 - slot) * 150}ms` }}
            className={cn(
              'flex min-w-0 max-w-24 flex-1 flex-col items-center duration-500 ease-out animate-in fill-mode-both fade-in slide-in-from-bottom-6 motion-reduce:animate-none',
              ORDER[slot],
            )}
          >
            <span className="sr-only">{`${ordinal(place)} place: `}</span>
            {place === 1 && (
              <span
                aria-hidden
                style={{ animationDelay: '850ms' }}
                className="duration-500 ease-out animate-in fill-mode-both zoom-in-50 fade-in -spin-in-12 motion-reduce:animate-none"
              >
                <CrownIcon weight="fill" className="mb-1 size-8 text-primary drop-shadow-[0_0_14px_color-mix(in_oklab,var(--color-gold)_60%,transparent)]" />
              </span>
            )}
            <Avatar name={row.name} className={cn(step.avatar, tone.ring)} />
            <p className="mt-2 w-full truncate text-center text-sm font-semibold">{row.name}</p>
            <p className={cn('text-lg leading-tight font-black', tone.text)}>
              {formatCount(row.points)}
              <span className="sr-only">{row.points === 1 ? ' point' : ' points'}</span>
            </p>
            <div className={cn('mt-2 grid w-full place-items-center rounded-t-xl bg-linear-to-b to-transparent', step.pedestal, tone.step)}>
              <span aria-hidden className={cn('text-2xl font-black opacity-70', tone.text)}>
                {place}
              </span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

// A fixed scatter (not random), so the pieces keep their paths on every render.
// Negative waits start each piece part way down, so the hero opens with confetti in the air.
const PIECES = Array.from({ length: 16 }, (_, i) => ({
  style: {
    left: `${(i * 37 + 9) % 100}%`,
    '--fall': `${12 + ((i * 7) % 6)}s`,
    '--wait': `${-((i * 1.7) % 14)}s`,
    '--drift': `${((i * 29) % 61) - 30}px`,
    '--turn': `${200 + ((i * 47) % 320)}deg`,
  } as CSSProperties,
  className: cn(
    ['bg-primary', 'bg-confetti-pink', 'bg-confetti-teal', 'bg-confetti-violet'][i % 4],
    ['size-2 rounded-full', 'h-3 w-1.5 rounded-sm', 'h-1.5 w-3 rounded-sm'][i % 3],
  ),
}))

/** A few pieces of confetti drifting down behind the headline, slowly, all evening (none with reduced motion: .recap-drift). */
function Confetti() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {PIECES.map((piece, i) => (
        <span key={i} className={cn('recap-drift absolute -top-4 opacity-60', piece.className)} style={piece.style} />
      ))}
    </div>
  )
}
