import type { ReactNode } from 'react'
import { BandEvent, BandLine, BandSince, Tab } from '@/components/tv/onAir'
import { GameStatus } from '@/components/tv/StatusCard'
import type { FeedItem, SessionGame } from '@/lib/types'
import { useLive } from '@/lib/useLive'

/** Lines in the band at most; past that, the newest games share one line. */
const MAX_LINES = 3

/**
 * The band along the bottom of the TV (docs/identity.md, The TV's frame): one
 * line per game running in the background, the evening-long one at the
 * bottom so a game started later joins above it instead of moving it, and
 * the join tag at the right while joining is open. A game draws its own line
 * when its TvStatus lists the `band` variant; any other gets the plain line,
 * its title and "Running since" the time it started, with its latest news.
 * The ticker's line (news from a game in the background) shows there as the
 * line's event; news from a game with no line of its own gets a line for as
 * long as the ticker holds it. More lines, such as the night's top five,
 * would join the list in `lines`.
 */
export default function Band({
  games,
  joinCode,
  ticker,
  sourceOf,
}: {
  /** The games in the background, oldest start first. */
  games: SessionGame[]
  /** The join tag's code, or null to leave it out. */
  joinCode: string | null
  /** The ticker's announcement (news.ts), while it holds one. */
  ticker?: FeedItem
  /** A game's title, for news from a game that has no line. */
  sourceOf: (gameId: string | null | undefined) => string | undefined
}) {
  const { snapshot } = useLive()
  const feed = snapshot?.feed ?? []
  const shown = games.length > MAX_LINES ? games.slice(0, MAX_LINES - 1) : games
  const folded = games.slice(shown.length)

  const lines: ReactNode[] = shown.map((game) => (
    <GameStatus
      key={game.id}
      game={game}
      variant="band"
      fallback={<PlainLine game={game} latest={feed.find((item) => item.game_id === game.id && item.audience === null)} />}
    />
  ))
  if (folded.length > 0) lines.push(<AlsoRunning key="also" games={folded} />)
  if (ticker && !games.some((game) => game.id === ticker.game_id)) {
    lines.push(
      <BandLine key={`news:${ticker.id}`} tab={<Tab tone="paper">{sourceOf(ticker.game_id) ?? 'News'}</Tab>}>
        <BandEvent at={ticker.created_at}>{ticker.message}</BandEvent>
      </BandLine>,
    )
  }
  if (lines.length === 0 && !joinCode) return null

  return (
    <footer data-fit="band" className="flex min-w-0 shrink-0 items-end gap-10 short:gap-8" aria-label="Also on tonight">
      {/* Newest on top, so the evening-long game keeps the bottom line. */}
      <div className="flex min-w-0 flex-1 flex-col-reverse gap-3 short:gap-2">{lines}</div>
      {joinCode && <JoinTag code={joinCode} />}
    </footer>
  )
}

/** A game without a band line of its own: its title, since when it has run, and its latest news. */
function PlainLine({ game, latest }: { game: SessionGame; latest?: FeedItem }) {
  return (
    <BandLine tab={<Tab tone="paper">{game.title}</Tab>}>
      {game.started_at !== null && <BandSince at={game.started_at} />}
      {latest && (
        <BandEvent key={latest.id} at={latest.created_at}>
          {latest.message}
        </BandEvent>
      )}
    </BandLine>
  )
}

/** The games past the band's lines, in one: "Quiz and Who is fused?". */
function AlsoRunning({ games }: { games: SessionGame[] }) {
  const titles = games.map((game) => game.title)
  return (
    <BandLine tab={<Tab tone="paper">Also running</Tab>}>
      <span className="min-w-0 truncate text-tv-tab font-semibold text-paper short:text-tv-floor">
        {titles.length > 1 ? `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}` : titles[0]}
      </span>
    </BandLine>
  )
}

/** "Join with HURRA30", at the right of the band's bottom line. */
function JoinTag({ code }: { code: string }) {
  return (
    <p className="flex h-16 shrink-0 items-center gap-4 text-tv-tab font-semibold whitespace-nowrap text-paper-2 short:h-14 short:gap-3 short:text-tv-floor">
      Join with
      <span className="font-mono text-tv-band font-extrabold tracking-[0.04em] text-paper short:text-tv-field">{code}</span>
    </p>
  )
}
