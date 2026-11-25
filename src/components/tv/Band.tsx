import type { ReactNode } from 'react'
import { onAirText } from '@/components/tv/news'
import { BandEvent, BandLine, BandSince, Tab } from '@/components/tv/onAir'
import { JoinTag } from '@/components/tv/Join'
import { bandRows } from '@/components/tv/scene'
import { GameStatus } from '@/components/tv/StatusCard'
import Ticker from '@/components/tv/Ticker'
import { accentOf } from '@/games/registry'
import type { FeedItem, SessionGame } from '@/lib/types'
import { useLive } from '@/lib/useLive'

/**
 * The band along the bottom of the TV (docs/identity.md, The TV's frame): one
 * line per game running in the background, the evening-long one at the
 * bottom so a game started later joins above it instead of moving it, and
 * "Join with HURRA30" at the right while a game holds the stage and joining is
 * open. A game draws its own line
 * when its TvStatus lists the `band` variant; any other gets the plain line,
 * its title and "Running since" the time it started, with its latest news.
 * Which lines show is `bandRows` (scene.ts): at most two for the games, the
 * newer ones folded into "Also running", and the ticker's news (from a game
 * in the background) in its game's line, in place of "Also running" while it
 * holds news from a folded game. More lines, such as a slim line with the
 * night's top five, join the list in `lines`.
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
  const tickerType = snapshot?.games.find((g) => g.id === ticker?.game_id)?.game_type

  const lines: ReactNode[] = bandRows(games, ticker).map((row) => {
    switch (row.kind) {
      case 'game':
        return (
          <GameStatus
            key={row.game.id}
            game={row.game}
            variant="band"
            fallback={<PlainLine game={row.game} latest={feed.find((item) => item.game_id === row.game.id && item.audience === null)} />}
          />
        )
      case 'also':
        return <AlsoRunning key="also" games={row.games} />
      case 'news':
        return ticker && <Ticker key={`news:${ticker.id}`} item={ticker} source={sourceOf(ticker.game_id)} hunt={accentOf(tickerType) === 'hunt'} />
    }
  })
  if (lines.length === 0 && !joinCode) return null

  return (
    <footer data-frame="band" className="flex min-w-0 shrink-0 items-end gap-10 short:gap-8" aria-label="Also on tonight">
      {/* Newest on top, so the evening-long game keeps the bottom line. */}
      <div className="flex min-w-0 flex-1 flex-col-reverse gap-2">{lines}</div>
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
          {onAirText(latest.message)}
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
