import {
  ChatCircleDotsIcon,
  CrownIcon,
  GameControllerIcon,
  HandCoinsIcon,
  LightningIcon,
  TrophyIcon,
  UsersThreeIcon,
  type Icon,
} from '@phosphor-icons/react'
import type { ReactNode } from 'react'
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
 * its numbers and its podium on a solid panel, with no glow and no falling
 * confetti (docs/identity.md). `children` is the band under it: where the
 * recap stands and what the host can do with it. Without a night (its read
 * gave up) it is only the party's name and the band.
 */
export default function RecapHero({ doc, partyName, children }: { doc: RecapDoc | null; partyName: string; children?: ReactNode }) {
  const headline = doc ? nightHeadline(doc) : null
  return (
    <section aria-labelledby="recap-party" className="relative overflow-hidden rounded-xl bg-raised">

      <div className="grid grid-cols-1 gap-x-8 gap-y-6 p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-end">
        <div className="min-w-0">
          <p className="on-air text-xs text-paper-2">Recap of the night</p>
          <h1 id="recap-party" className="mt-1 text-2xl font-extrabold break-words">
            {partyName}
          </h1>
          {headline && (
            <div className="duration-500 animate-in fade-in slide-in-from-bottom-3 motion-reduce:animate-none">
              {/* The leader or winner: one of gold's jobs, in the big words' face, with no glow. */}
              <p className="wide mt-5 text-3xl leading-[1.05] text-balance break-words text-gold sm:text-4xl">{headline.title}</p>
              <p className="mt-3 max-w-xl text-base text-pretty text-paper-2 sm:text-lg">{headline.line}</p>
            </div>
          )}
          {doc && (
            <ul aria-label="The night in numbers" className="mt-6 flex flex-wrap gap-2">
              {numberTiles(doc).map((tile) => {
                const TileIcon = NUMBER_ICONS[tile.key]
                return (
                  <li key={tile.key} className="flex items-center gap-2 rounded-chip bg-overlay py-1.5 pr-3 pl-2.5 text-sm">
                    <TileIcon weight="duotone" className="size-4 text-paper-2" />
                    <span className="tv-num text-lg leading-none">{formatCount(tile.value)}</span>
                    <span className="text-paper-2">{tile.label}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        {doc && <Podium doc={doc} />}
      </div>

      {children && <div className="border-t border-rule px-5 py-4 sm:px-8">{children}</div>}
    </section>
  )
}

// The list is in place order, for screen readers; on screen, left to right: 2nd, 1st, 3rd.
const ORDER = ['order-2', 'order-1', 'order-3']
// Steps of clearly different heights, in paper as on the TV's podium (docs/identity.md); the points in the place tones.
const STEPS = [
  { avatar: 'size-16', pedestal: 'h-20' },
  { avatar: 'size-12', pedestal: 'h-14' },
  { avatar: 'size-12', pedestal: 'h-10' },
]

/**
 * The top three on their steps, as the TV's last slide has them: everyone tied
 * first wears the crown. A screen reader hears each place and points in words.
 */
function Podium({ doc }: { doc: RecapDoc }) {
  const places = podiumPlaces(doc)
  if (places.length === 0) {
    return (
      <div className="grid justify-items-center gap-2 rounded-lg bg-overlay p-6 text-center text-sm text-paper-2">
        <TrophyIcon weight="duotone" className="size-10 text-paper-3" />
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
                <CrownIcon weight="fill" className="mb-1 size-8 text-gold" />
              </span>
            )}
            <Avatar name={row.name} playerId={row.playerId} className={step.avatar} />
            <p className="mt-2 w-full truncate text-center text-sm font-bold">{row.name}</p>
            <p className={cn('tv-num text-xl leading-tight', tone.text)}>
              {formatCount(row.points)}
              <span className="sr-only">{row.points === 1 ? ' point' : ' points'}</span>
            </p>
            <div className={cn('mt-2 grid w-full place-items-center rounded-t-md bg-paper', step.pedestal)}>
              <span aria-hidden className="wide text-2xl text-ink">
                {place}
              </span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
