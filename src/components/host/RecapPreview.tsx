import {
  ClockCountdownIcon,
  CrownIcon,
  DeviceMobileIcon,
  GameControllerIcon,
  ListChecksIcon,
  TelevisionSimpleIcon,
} from '@phosphor-icons/react'
import { useMemo, useState, type ReactNode } from 'react'
import AnnouncementIconView from '@/components/AnnouncementIconView'
import Avatar from '@/components/Avatar'
import RaceChart from '@/components/host/RaceChart'
import RecapAwards from '@/components/host/RecapAwards'
import RecapHero from '@/components/host/RecapHero'
import RecapSection from '@/components/host/RecapSection'
import {
  chapterStory,
  clockTime,
  durationText,
  formatCount,
  nightAwards,
  podiumPlaces,
  timeSpan,
  tvPeek,
  type TvPeekSlide,
} from '@/components/host/recapView'
import YourNight from '@/components/phone/YourNight'
import { PLACE_TONES } from '@/components/placeTones'
import { numberTiles, raceFrames, shownLeadChanges } from '@/components/tv/recapSlides'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Highlight } from '@/games/core/Game'
import { getGameModule } from '@/games/registry'
import { listNames, type RecapDoc } from '@/lib/recap'
import { cn } from '@/lib/utils'

/**
 * The recap as the room will see it (docs/engine-v2.md, 7.4): the hero with
 * the night's headline, numbers and podium (`band` under it: the page's status
 * and actions), the night's awards, the race, a chapter per round with its
 * highlights, a peek at the TV's slides and any guest's "Your night" on a
 * phone, and the timeline. `tvNote` says where the TV stands with it; while
 * a Rebuild loads, the night below the hero stays, a little faded (`faded`).
 */
export default function RecapPreview({
  doc,
  partyName = doc.session.name,
  band,
  tvNote = 'Once published, Show on the TV plays it on a loop.',
  faded = false,
}: {
  doc: RecapDoc
  partyName?: string
  band?: ReactNode
  tvNote?: string
  faded?: boolean
}) {
  const awards = useMemo(() => nightAwards(doc), [doc])
  return (
    <div className="grid grid-cols-1 gap-10">
      <RecapHero doc={doc} partyName={partyName}>
        {band}
      </RecapHero>

      <div className={cn('grid grid-cols-1 gap-10 transition-opacity', faded && 'opacity-60')}>
        <RecapAwards awards={awards} />

        <RecapSection
          id="recap-race"
          icon={ClockCountdownIcon}
          title="The race"
          note={`Running totals of the top ${Math.min(8, doc.standings.length)}, through the night.`}
          card
        >
          <RaceChart doc={doc} />
        </RecapSection>

        <RecapSection id="recap-chapters" icon={GameControllerIcon} title="Game by game" note={chaptersNote(doc)}>
          {doc.chapters.length === 0 ? (
            <p className="text-sm text-muted-foreground">No game has started yet.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {doc.chapters.map((chapter) => (
                <Chapter key={`${chapter.gameId}-${chapter.round}`} chapter={chapter} />
              ))}
            </div>
          )}
        </RecapSection>

        <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8">
          <TvPeek doc={doc} note={tvNote} />
          <div className="lg:row-span-2">
            <YourNightPreview doc={doc} />
          </div>
          <Timeline doc={doc} />
        </div>
      </div>
    </div>
  )
}

/**
 * A game's or a moment's icon on the page: a solid circle in paper-2. The
 * games no longer wear gold, pink, teal and violet here, since those colours
 * have jobs (docs/identity.md); a win alone is gold.
 */
const ICON_CIRCLE = 'bg-overlay text-paper-2'

/** "3 rounds", "1 round". */
const count = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`

function chaptersNote(doc: RecapDoc): string | undefined {
  if (doc.chapters.length === 0) return undefined
  const running = doc.chapters.filter((c) => c.finishedAt === null).length
  const rounds = count(doc.chapters.length, 'round', 'rounds')
  return running > 0 ? `${rounds}, ${running} still running: those show only who leads.` : `${rounds}, each with what its game saw.`
}

function HighlightRow({ highlight }: { highlight: Highlight }) {
  const minor = highlight.weight === 'line'
  return (
    <li className="flex gap-2.5">
      <span className={cn('mt-0.5 grid size-6 shrink-0 place-items-center rounded-full [&_svg]:size-3.5', ICON_CIRCLE)}>
        <AnnouncementIconView name={highlight.icon ?? 'star'} />
      </span>
      <div className="min-w-0">
        <p className={cn('leading-snug', minor ? 'text-sm text-muted-foreground' : 'font-medium')}>{highlight.title}</p>
        {highlight.detail && <p className="text-sm text-muted-foreground">{highlight.detail}</p>}
      </div>
    </li>
  )
}

function Chapter({ chapter }: { chapter: RecapDoc['chapters'][number] }) {
  const GameIcon = getGameModule(chapter.gameType)?.icon ?? GameControllerIcon
  const running = chapter.finishedAt === null
  const { winners, highlights } = chapterStory(chapter)
  return (
    <article className="relative isolate flex flex-col overflow-hidden rounded-xl bg-raised">
      <header className="flex items-start gap-3 p-4">
        <span className={cn('grid size-11 shrink-0 place-items-center rounded-control [&_svg]:size-6', ICON_CIRCLE)}>
          <GameIcon weight="duotone" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-extrabold">
            {chapter.title}
            {chapter.round > 1 && <span className="font-normal text-muted-foreground"> · round {chapter.round}</span>}
          </h3>
          <p className="text-sm text-muted-foreground">
            {timeSpan(chapter.startedAt, chapter.finishedAt)}
            {chapter.finishedBy === 'host' && ', ended by you'}
          </p>
        </div>
        {running && (
          <Badge variant="secondary" className="shrink-0">
            Running
          </Badge>
        )}
      </header>
      {winners && (
        <div className="mx-4 flex items-center gap-3 rounded-lg bg-overlay px-3 py-2.5">
          <div aria-hidden className="flex shrink-0 -space-x-2">
            {chapter.winners.slice(0, 3).map((w) => (
              // The overlay's colour round each token keeps overlapping tokens apart.
              <Avatar key={w.id} name={w.name} playerId={w.id} className="size-8 ring-2 ring-overlay" />
            ))}
          </div>
          <div className="min-w-0 text-sm">
            <p className="leading-snug font-semibold">
              <CrownIcon weight="fill" className="mr-1 inline size-4 -translate-y-px text-gold" />
              {winners.title}
            </p>
            {winners.detail && <p className="text-muted-foreground">{winners.detail}</p>}
          </div>
        </div>
      )}
      {highlights.length > 0 && (
        <ul className={cn('grid gap-2.5 p-4', running && 'text-paper-2')}>
          {highlights.map((highlight, i) => (
            <HighlightRow key={i} highlight={highlight} />
          ))}
        </ul>
      )}
    </article>
  )
}

/** The TV's slides in its own order, each a little picture of what it shows. */
function TvPeek({ doc, note }: { doc: RecapDoc; note: string }) {
  const { slides, loopSeconds } = useMemo(() => tvPeek(doc), [doc])
  return (
    <RecapSection
      id="recap-tv"
      icon={TelevisionSimpleIcon}
      title="On the TV"
      note={`${count(slides.length, 'slide', 'slides')}, a loop of about ${durationText(loopSeconds)}. ${note}`}
      card
    >
      <ol className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3">
        {slides.map((slide, i) => (
          <li key={slide.key} className="min-w-0">
            <MiniSlide doc={doc} slide={slide} />
            <p className="mt-1.5 flex items-baseline gap-1.5 text-xs">
              <span className="text-muted-foreground tabular-nums">{i + 1}</span>
              <span className="min-w-0 truncate font-medium">{slide.label}</span>
            </p>
          </li>
        ))}
      </ol>
    </RecapSection>
  )
}

const MINI_BARS = ['bg-primary', 'bg-confetti-pink', 'bg-confetti-teal', 'bg-confetti-violet']
/** The steps' heights; their colours are the place tones (src/components/placeTones.ts). */
const PEDESTALS = ['h-[14cqw]', 'h-[10cqw]', 'h-[7cqw]']

/**
 * A slide in miniature: the same parts as the TV draws. Sizes are in cqw (a
 * hundredth of the tile's width), so it reads the same in any column.
 */
function MiniSlide({ doc, slide }: { doc: RecapDoc; slide: TvPeekSlide }) {
  let body: ReactNode = null
  switch (slide.slide.kind) {
    case 'numbers': {
      const tiles = numberTiles(doc).slice(0, 3)
      body = (
        <div className="grid h-full content-center justify-items-center gap-[4cqw] px-[5cqw]">
          <p className="max-w-full truncate text-[6.5cqw] font-black text-primary">The night in numbers</p>
          <div className="flex gap-[3cqw]">
            {tiles.map((tile) => (
              <span key={tile.key} className="grid min-w-[22cqw] justify-items-center rounded-[2cqw] bg-card/90 px-[2cqw] py-[1.5cqw] ring-1 ring-foreground/10">
                <span className="text-[9cqw] leading-none font-black">{formatCount(tile.value)}</span>
                <span className="max-w-full truncate text-[3.5cqw] text-muted-foreground">{tile.label}</span>
              </span>
            ))}
          </div>
        </div>
      )
      break
    }
    case 'race': {
      const rows = raceFrames(doc).at(-1)?.rows.slice(0, 4) ?? []
      const max = Math.max(1, ...rows.map((row) => row.total))
      body = (
        <div className="grid h-full content-center gap-[3cqw] px-[6cqw]">
          <p className="text-[6.5cqw] font-black">The race</p>
          {rows.map((row, i) => (
            <div key={row.playerId} className="flex items-center gap-[2.5cqw]">
              <Avatar name={row.name} className="size-[7cqw]" />
              <span
                className={cn('h-[3.5cqw] rounded-full', MINI_BARS[i % MINI_BARS.length])}
                style={{ width: `${Math.max(6, (Math.max(0, row.total) / max) * 80)}%` }}
              />
            </div>
          ))}
        </div>
      )
      break
    }
    case 'chapter': {
      const chapter = doc.chapters[slide.slide.index]
      const GameIcon = getGameModule(chapter.gameType)?.icon ?? GameControllerIcon
      const winner = chapter.winners[0]
      body = (
        <div className="grid h-full content-center gap-[2.5cqw] px-[6cqw]">
          <p className="flex items-center gap-[1.5cqw] text-[3.5cqw] tracking-widest text-muted-foreground uppercase">
            <GameIcon weight="duotone" className="size-[5cqw] text-primary" />
            {chapter.finishedAt === null ? 'Still running' : timeSpan(chapter.startedAt, chapter.finishedAt)}
          </p>
          <p className="truncate text-[9cqw] leading-tight font-black">{chapter.title}</p>
          {winner && (
            <p className="mt-[1.5cqw] flex min-w-0 items-center gap-[2cqw] text-[5cqw] font-bold">
              <span className="relative shrink-0">
                <CrownIcon weight="fill" className="absolute -top-[4.5cqw] left-1/2 size-[5cqw] -translate-x-1/2 text-primary" />
                <Avatar name={winner.name} className="size-[9cqw]" />
              </span>
              <span className="truncate">{listNames(chapter.winners.map((w) => w.name))}</span>
            </p>
          )}
        </div>
      )
      break
    }
    case 'leads': {
      const leads = shownLeadChanges(doc).slice(-3)
      body = (
        <div className="grid h-full content-center gap-[3cqw] px-[6cqw]">
          <p className="text-[6.5cqw] font-black">Lead changes</p>
          <ol className="grid gap-[2cqw] border-l-[0.8cqw] border-primary/40 pl-[3cqw]">
            {leads.map((lead) => (
              <li key={`${lead.at}:${lead.playerId}`} className="flex min-w-0 items-center gap-[2cqw] text-[4.5cqw]">
                <span className="shrink-0 text-muted-foreground">{clockTime(lead.at)}</span>
                <span className="truncate font-bold">{lead.name}</span>
              </li>
            ))}
          </ol>
        </div>
      )
      break
    }
    case 'podium': {
      const top = doc.podium.slice(0, 3)
      // Place and step from the standings, as the TV has them: everyone tied first is crowned.
      const places = podiumPlaces(doc)
      const order = [1, 0, 2].filter((i) => i < top.length)
      body = (
        <div className="grid h-full grid-rows-[auto_1fr] px-[6cqw] pt-[5cqw]">
          <p className="truncate text-center text-[5.5cqw] font-black text-primary">
            Hurra for {listNames(top.filter((row) => row.points === top[0].points).map((row) => row.name))}!
          </p>
          <div className="flex items-end justify-center gap-[3cqw]">
            {order.map((i) => (
              <div key={top[i].playerId} className="flex w-[17cqw] flex-col items-center">
                {places[i].place === 1 && <CrownIcon weight="fill" className="size-[5cqw] text-primary" />}
                <Avatar name={top[i].name} className={cn(places[i].step === 0 ? 'size-[10cqw]' : 'size-[8cqw]')} />
                <span className={cn('mt-[1.5cqw] w-full rounded-t-[1.5cqw] bg-linear-to-b to-transparent', PEDESTALS[places[i].step], PLACE_TONES[places[i].step].step)} />
              </div>
            ))}
          </div>
        </div>
      )
      break
    }
  }
  return (
    <div
      aria-hidden
      className="@container relative aspect-video overflow-hidden rounded-lg border-[3px] border-overlay bg-ground"
    >
      {body}
      <span className="absolute top-[3cqw] right-[3cqw] rounded-[1.5cqw] bg-overlay px-[1.5cqw] text-[3.5cqw] text-paper-2 tabular-nums">
        {slide.seconds} s
      </span>
    </div>
  )
}

/** What one guest's phone shows under "Your night" once the recap is published, on a phone. */
function YourNightPreview({ doc }: { doc: RecapDoc }) {
  const [picked, setPicked] = useState<string>()
  const playerId = picked && doc.players[picked] ? picked : doc.standings[0]?.playerId
  return (
    <RecapSection id="recap-your-night" icon={DeviceMobileIcon} title="Your night" note="What each guest's phone shows once it is published.">
      {!playerId || !doc.players[playerId] ? (
        <p className="text-sm text-muted-foreground">Nobody has joined yet.</p>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="your-night-guest">Guest</Label>
            <Select value={playerId} onValueChange={setPicked}>
              <SelectTrigger id="your-night-guest" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {doc.standings.map((row) => (
                  <SelectItem key={row.playerId} value={row.playerId}>
                    <span className="w-6 text-right text-muted-foreground">{row.rank}.</span>
                    {row.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <PhoneFrame label={`${doc.players[playerId].name}'s phone`}>
            <YourNight doc={doc} playerId={playerId} />
          </PhoneFrame>
        </div>
      )}
    </RecapSection>
  )
}

/** A plain phone: a dark bezel with its island, and a screen that scrolls like the guest's. */
function PhoneFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure aria-label={label} className="mx-auto w-full max-w-[19rem] rounded-[2.75rem] bg-black p-2.5 shadow-2xl ring-1 shadow-black/50 ring-white/12">
      <div className="relative h-[34rem] overflow-y-auto overscroll-contain rounded-[2.2rem] bg-background [scrollbar-width:none]">
        <div aria-hidden className="sticky top-0 z-10 flex justify-center bg-linear-to-b from-background via-background/90 to-transparent pt-2.5 pb-3">
          <span className="h-5 w-20 rounded-full bg-black ring-1 ring-white/5" />
        </div>
        <div className="px-3 pb-6">{children}</div>
      </div>
    </figure>
  )
}

const SHOWN_AT_FIRST = 8

/** Starts, finishes, lead changes and the moments with a time, down a plain line. */
function Timeline({ doc }: { doc: RecapDoc }) {
  const [all, setAll] = useState(false)
  const titles = new Map(doc.chapters.map((c) => [c.gameId, c.title]))
  const entries = all ? doc.timeline : doc.timeline.slice(0, SHOWN_AT_FIRST)
  return (
    <RecapSection
      id="recap-timeline"
      icon={ListChecksIcon}
      title="How the night went"
      note={doc.timeline.length > 0 ? `${count(doc.timeline.length, 'moment', 'moments')}, in order.` : undefined}
      card
    >
      {doc.timeline.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing has happened yet.</p>
      ) : (
        <>
          <ol className="relative grid">
            {/* The thread through the night. */}
            <span aria-hidden className="absolute top-3 bottom-3 left-[4.05rem] w-0.5 -translate-x-1/2 rounded-full bg-rule" />
            {entries.map((entry, i) => {
              const win = entry.icon === 'crown'
              const game = entry.gameId ? titles.get(entry.gameId) : undefined
              return (
                <li key={i} className="relative flex gap-3 py-2">
                  <time
                    dateTime={new Date(entry.at).toISOString()}
                    className="tv-num w-10 shrink-0 pt-0.5 text-right text-sm text-paper-3"
                  >
                    {clockTime(entry.at)}
                  </time>
                  {/* On the card's colour first, so the thread stops at each moment. */}
                  <span className="relative size-7 shrink-0 rounded-full bg-raised ring-4 ring-raised">
                    <span
                      className={cn(
                        'grid size-full place-items-center rounded-full [&_svg]:size-3.5',
                        win ? 'bg-gold text-ink' : ICON_CIRCLE,
                      )}
                    >
                      <AnnouncementIconView name={entry.icon ?? 'megaphone'} />
                    </span>
                  </span>
                  <div className="min-w-0 pt-1">
                    <p className={cn('text-sm leading-snug', win ? 'font-semibold' : 'font-medium')}>
                      {entry.text}
                      {game && !entry.text.includes(game) && <span className="font-normal text-paper-2"> · {game}</span>}
                    </p>
                    {entry.detail && <p className="text-sm text-muted-foreground">{entry.detail}</p>}
                  </div>
                </li>
              )
            })}
          </ol>
          {doc.timeline.length > SHOWN_AT_FIRST && (
            <Button variant="ghost" size="sm" className="mt-2" aria-expanded={all} onClick={() => setAll((shown) => !shown)}>
              {all ? 'Show fewer' : `Show all ${doc.timeline.length} moments`}
            </Button>
          )}
        </>
      )}
    </RecapSection>
  )
}
