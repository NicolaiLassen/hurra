import { CheckIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { ordinal } from '@/components/phone/text'
import { pointsPerSong } from '@/games/soundtrack/logic'
import { letterOf, type SoundtrackPlayerView, type SoundtrackPublicState } from '@/games/soundtrack/types'
import { cn } from '@/lib/utils'
import { LetterChip, PhotoImage } from './Wall'
import { eventLine, gotItLine, nextLine, ownPhotoLine, partCounts, partLine, soFarWords, storyLine } from './words'

// The reveal on a guest's phone (spec 4.11), for the song just revealed: the
// story first, heads up to the TV; then how the song went for this guest,
// part by part, with what they typed and whether it counted; their Lydspor
// points and place; a tally of every song; and what they have on the next.
// When the host accepts a close answer during the story, the row turns to
// paper in place: no sound, no toast.

/** Sets the quoted typed text in a line in bold: “Papir Lanterner”. */
function withQuotes(line: string, counted: boolean) {
  return line.split(/(“[^”]*”)/).map((part, i) =>
    part.startsWith('“') ? (
      <b key={i} className={cn('font-bold', counted ? 'text-ink' : 'text-paper')}>
        {part}
      </b>
    ) : (
      part
    ),
  )
}

export function Reveal({
  pub,
  view,
  mediaUrl,
  onStage,
}: {
  pub: SoundtrackPublicState
  view: SoundtrackPlayerView | null
  mediaUrl: (path: string, size?: 'full' | 'thumb') => string
  onStage: boolean
}) {
  const reveal = pub.reveal
  if (!reveal) return <p className="text-paper-2">The first song is about to be revealed.</p>
  const i = reveal.n - 1
  const song = view?.songs[i] ?? null
  const mine = view?.mine ?? null
  const played = pub.playedAt.length
  const most = pointsPerSong(pub.points)
  const photo = pub.wall[reveal.event]
  const standings = pub.phase === 'standings'
  const head = standings ? 'Lydspor’s top 5 is on the TV.' : storyLine(pub.storyteller)
  const points = view?.points ?? 0
  const place = view?.rank ? ordinal(view.rank) : null
  // Once every song is revealed, the points count the own average, as the TV's top 5 does.
  const credit = view && view.credit > 0 ? ownPhotoLine(view.credit) : null
  const next = reveal.n < played ? nextLine(reveal.n + 1, mine) : null

  return (
    <div className="grid grid-cols-1">
      <p className="text-[20px] leading-[1.25] font-extrabold">
        {head}
        {onStage && !standings && <span className="block font-semibold text-paper-2">Look at the TV.</span>}
      </p>
      <p className="mt-3 text-[24px] leading-[1.12] font-extrabold tracking-[-0.01em]">
        {song?.inPhoto ? `Song ${reveal.n}: you’re in the photo.` : `Song ${reveal.n}: ${song?.points ?? 0} of ${most} points.`}
      </p>

      <div className="relative mt-3 h-[132px] overflow-hidden rounded-phone bg-overlay">
        {photo && <HeroPhoto thumb={mediaUrl(photo.path, 'thumb')} full={mediaUrl(photo.path, 'full')} />}
        {reveal.event >= 0 && <LetterChip index={reveal.event} size="hero" />}
        {reveal.caption && (
          <span className="absolute bottom-3 left-0 z-[2] h-8 max-w-[calc(100%-1rem)] truncate bg-paper pr-3.5 pl-3 text-[17px] leading-8 font-extrabold text-ink">
            {reveal.caption}
          </span>
        )}
      </div>

      {song?.inPhoto ? (
        <p className="mt-3 rounded-phone bg-overlay px-4 py-3.5 text-[17px] leading-snug font-bold">
          You’re in this one. It counts as your own average at the end.
        </p>
      ) : (
        <ul className="mt-2.5 grid gap-1.5" aria-label={`How song ${reveal.n} went for you`}>
          <ResultRow
            label="Event"
            truth={reveal.event >= 0 ? `Photo ${letterOf(reveal.event)}` : 'The photo'}
            counted={song?.event === 'right'}
            points={pub.points.event}
            sub={eventLine(song?.event ?? 'none', mine?.event[i] ?? null)}
            count={gotItLine(reveal.counts.event, reveal.scoring)}
          />
          <ResultRow
            label="Title"
            truth={reveal.title}
            counted={partCounts(song?.title ?? 'none')}
            points={pub.points.title}
            sub={partLine(song?.title ?? 'none', mine?.title[i] ?? null)}
            count={gotItLine(reveal.counts.title, reveal.scoring)}
          />
          <ResultRow
            label="Singer"
            truth={reveal.singer}
            counted={partCounts(song?.singer ?? 'none')}
            points={pub.points.singer}
            sub={partLine(song?.singer ?? 'none', mine?.singer[i] ?? null)}
            count={gotItLine(reveal.counts.singer, reveal.scoring)}
          />
        </ul>
      )}

      <p className="mt-3.5 flex items-baseline gap-2">
        <span className={cn('text-[30px] leading-none tv-num', view?.rank === 1 && 'text-gold')}>{points}</span>
        <span className="text-[17px] font-bold">{soFarWords(points, place)}</span>
      </p>
      {credit && <p className="mt-1 text-base leading-snug font-semibold text-paper-2">{credit}</p>}
      <Tally played={played} revealed={pub.revealed} songs={view?.songs ?? []} />
      <p className="mt-3 text-base leading-snug text-pretty text-paper-2">
        {next ? (
          <>
            {next.lead} You have{' '}
            {next.have ? <b className="font-bold text-paper">{next.have}</b> : <b className="font-bold text-paper">no answer for it</b>}.
          </>
        ) : reveal.n >= pub.total || reveal.n >= played ? (
          'That was the last song. The winner is crowned next.'
        ) : null}
      </p>
    </div>
  )
}

/**
 * The revealed song's photo across the phone: the thumbnail at once, then the
 * full photo over it once it has loaded, so a real photo is sharp on a 3x
 * screen. If the full one fails, the thumbnail stays.
 */
function HeroPhoto({ thumb, full }: { thumb: string; full: string }) {
  const [loaded, setLoaded] = useState<string | null>(null)
  return (
    <>
      <PhotoImage src={thumb} className="absolute inset-0 size-full" />
      {full !== '' && (
        <img
          src={full}
          alt=""
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(full)}
          className={cn(
            'absolute inset-0 size-full object-cover transition-opacity duration-300 motion-reduce:transition-none',
            loaded === full ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}
    </>
  )
}

/** One part of the song just revealed: on paper with a check and its points when it counted, else on the overlay with 0. */
function ResultRow({
  label,
  truth,
  counted,
  points,
  sub,
  count,
}: {
  label: string
  truth: string
  counted: boolean
  points: number
  sub: string | null
  count: string
}) {
  return (
    <li
      className={cn(
        'flex min-h-[58px] items-center gap-3 rounded-phone py-2 pr-3.5 pl-3 transition-colors duration-300 motion-reduce:transition-none',
        counted ? 'bg-paper text-ink' : 'bg-overlay',
      )}
    >
      <span className={cn('w-[62px] shrink-0 on-air text-[13px] max-[379px]:w-[54px] max-[379px]:text-[12px]', counted ? 'text-ink' : 'text-paper-2')}>
        {label}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[17px] leading-[1.2] font-extrabold [overflow-wrap:anywhere]">
          {truth}
          {counted && <CheckIcon weight="bold" aria-label="counted" className="size-[17px] shrink-0" />}
        </p>
        <p className={cn('mt-px text-[14.5px] leading-[1.25] font-semibold', counted ? 'text-ink' : 'text-paper-2')}>
          {sub && withQuotes(sub, counted)}
          <span className={cn('block', sub && 'mt-0.5')}>{count}</span>
        </p>
      </div>
      <span className={cn('shrink-0 text-[26px] leading-none tv-num', !counted && 'text-paper-3')}>{counted ? `+${points}` : '0'}</span>
    </li>
  )
}

/** Every song played: revealed ones on paper with their points under them, the next outlined with "Next", the rest outlined. */
function Tally({ played, revealed, songs }: { played: number; revealed: number; songs: SoundtrackPlayerView['songs'] }) {
  if (played < 2) return null
  return (
    <ol
      aria-label="Your songs so far"
      className={cn('mt-2 grid gap-1.5', played > 8 && 'gap-1')}
      style={{ gridTemplateColumns: `repeat(${played}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: played }, (_, i) => {
        const song = songs[i]
        const done = i < revealed
        const next = i === revealed
        return (
          <li key={i} className="grid justify-items-center gap-[3px]">
            <span
              className={cn(
                'grid h-[34px] w-full place-items-center rounded-[6px] text-[20px] leading-none tv-num',
                done ? 'bg-paper text-ink' : 'text-paper-3 shadow-[inset_0_0_0_2px_var(--color-rule)]',
                played > 8 && 'text-[17px]',
              )}
            >
              {i + 1}
            </span>
            <span className="h-4 text-[16px] leading-4 text-paper-2 tv-num">
              {done ? (song?.inPhoto ? 'Avg' : `+${song?.points ?? 0}`) : next ? 'Next' : ''}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
