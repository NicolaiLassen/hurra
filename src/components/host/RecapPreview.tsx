import { CrownIcon, GameControllerIcon, MegaphoneIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import AnnouncementIconView from '@/components/AnnouncementIconView'
import RaceChart from '@/components/host/RaceChart'
import { clockTime, formatCount, timeSpan } from '@/components/host/recapView'
import RankBadge from '@/components/RankBadge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Highlight } from '@/games/core/Game'
import { getGameModule } from '@/games/registry'
import type { RecapDoc } from '@/lib/recap'
import { cn } from '@/lib/utils'

/**
 * The recap as the room will see it (docs/engine-v2.md, 7.4): the night in
 * numbers, the race, a chapter per round with its highlights, the timeline,
 * and any guest's "Your night".
 */
export default function RecapPreview({ doc }: { doc: RecapDoc }) {
  return (
    <div className="grid grid-cols-1 gap-6">
      <Numbers doc={doc} />

      <Card>
        <CardHeader>
          <CardTitle>The race</CardTitle>
          <CardDescription>Running totals of the top {Math.min(8, doc.standings.length)} over the night.</CardDescription>
        </CardHeader>
        <CardContent>
          <RaceChart doc={doc} />
        </CardContent>
      </Card>

      <section className="grid grid-cols-1 gap-3" aria-labelledby="recap-chapters">
        <h2 id="recap-chapters" className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
          Chapters ({doc.chapters.length})
        </h2>
        {doc.chapters.length === 0 ? (
          <p className="text-sm text-muted-foreground">No game has started yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {doc.chapters.map((chapter) => (
              <Chapter key={`${chapter.gameId}-${chapter.round}`} chapter={chapter} />
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Timeline doc={doc} />
        <YourNight doc={doc} />
      </div>
    </div>
  )
}

function Numbers({ doc }: { doc: RecapDoc }) {
  const tiles = [
    { label: 'Guests', value: doc.numbers.guests },
    { label: 'Games played', value: doc.numbers.games },
    { label: 'Answers', value: doc.numbers.answers },
    { label: 'Moves', value: doc.numbers.moves },
    { label: 'Points given', value: doc.numbers.awards },
  ]
  return (
    <section aria-label="The night in numbers" className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {tiles.map((tile) => (
        <Card key={tile.label} size="sm" className="last:col-span-2 sm:last:col-span-1">
          <CardContent>
            <p className="text-sm text-muted-foreground">{tile.label}</p>
            <p className="mt-1 text-3xl font-bold">{formatCount(tile.value)}</p>
          </CardContent>
        </Card>
      ))}
    </section>
  )
}

const WEIGHT: Record<NonNullable<Highlight['weight']>, string> = {
  headline: 'text-base font-semibold',
  highlight: 'font-medium',
  line: 'text-muted-foreground',
}

function HighlightRow({ highlight }: { highlight: Highlight }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
        <AnnouncementIconView name={highlight.icon ?? 'star'} className="size-3.5" />
      </span>
      <div className="min-w-0">
        <p className={cn('leading-snug', WEIGHT[highlight.weight ?? 'highlight'])}>{highlight.title}</p>
        {highlight.detail && <p className="text-sm text-muted-foreground">{highlight.detail}</p>}
      </div>
    </li>
  )
}

function Chapter({ chapter }: { chapter: RecapDoc['chapters'][number] }) {
  const GameIcon = getGameModule(chapter.gameType)?.icon ?? GameControllerIcon
  const running = chapter.finishedAt === null
  return (
    <Card size="sm">
      <CardHeader className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <GameIcon weight="duotone" className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <CardTitle className="truncate">
            {chapter.title}
            {chapter.round > 1 && <span className="font-normal text-muted-foreground"> · round {chapter.round}</span>}
          </CardTitle>
          <CardDescription className="tabular-nums">
            {timeSpan(chapter.startedAt, chapter.finishedAt)}
            {chapter.finishedBy === 'host' && ', ended by you'}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {chapter.winners.length > 0 && (
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <CrownIcon weight="fill" className="shrink-0 text-primary" />
            <span className="min-w-0">{chapter.winners.map((w) => w.name).join(', ')}</span>
          </p>
        )}
        <ul className={cn('grid gap-2', running && 'opacity-80')}>
          {chapter.highlights.map((highlight, i) => (
            <HighlightRow key={i} highlight={highlight} />
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function Timeline({ doc }: { doc: RecapDoc }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Timeline</CardTitle>
        <CardDescription>Starts, finishes, lead changes and the moments with a time.</CardDescription>
      </CardHeader>
      <CardContent>
        {doc.timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing has happened yet.</p>
        ) : (
          <ol className="grid">
            {doc.timeline.map((entry, i) => (
              <li key={i} className="group relative flex gap-3 pb-4 last:pb-0">
                {/* The thread from this moment's icon to the next. */}
                <span className="absolute top-7 bottom-0 left-[4.25rem] w-px -translate-x-1/2 bg-foreground/10 group-last:hidden" aria-hidden />
                <span className="w-11 shrink-0 pt-0.5 text-right text-xs font-medium text-muted-foreground tabular-nums">
                  {clockTime(entry.at)}
                </span>
                <span className="relative grid size-6 shrink-0 place-items-center rounded-full bg-muted text-primary">
                  {entry.icon ? <AnnouncementIconView name={entry.icon} className="size-3.5" /> : <MegaphoneIcon className="size-3.5" />}
                </span>
                <div className="min-w-0 pt-0.5">
                  <p className="text-sm leading-snug font-medium">{entry.text}</p>
                  {entry.detail && <p className="text-sm text-muted-foreground">{entry.detail}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

/** What one guest's phone shows under "Your night" once the recap is published. */
function YourNight({ doc }: { doc: RecapDoc }) {
  const [picked, setPicked] = useState<string>()
  const playerId = picked && doc.players[picked] ? picked : doc.standings[0]?.playerId
  const night = playerId ? doc.players[playerId] : undefined
  const total = doc.standings.length

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your night</CardTitle>
        <CardDescription>What each guest's phone shows once the recap is published.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {total === 0 || !playerId || !night ? (
          <p className="text-sm text-muted-foreground">Nobody has joined yet.</p>
        ) : (
          <>
            <div className="grid gap-2">
              <Label htmlFor="your-night-guest">Guest</Label>
              <Select value={playerId} onValueChange={setPicked}>
                <SelectTrigger id="your-night-guest" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {doc.standings.map((row) => (
                    <SelectItem key={row.playerId} value={row.playerId}>
                      {row.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-3">
              <RankBadge rank={night.rank} className="size-9 text-sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{night.name}</p>
                <p className="text-sm text-muted-foreground">
                  Number {night.rank} of {total}
                </p>
              </div>
              <p className="text-2xl font-bold text-primary">{formatCount(night.points)}</p>
            </div>
            {night.byGame.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Points by game</h3>
                <ul className="divide-y">
                  {night.byGame.map((game) => (
                    <li key={game.gameId} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                      <span className="min-w-0 truncate">{game.title}</span>
                      <span className="font-semibold tabular-nums">{formatCount(game.points)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Moments</h3>
              {night.moments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No moments of their own yet.</p>
              ) : (
                <ul className="grid gap-2">
                  {night.moments.map((moment, i) => (
                    <HighlightRow key={i} highlight={moment} />
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
