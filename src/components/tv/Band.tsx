import type { ReactNode } from 'react'
import { TeamSwatch } from '@/components/TeamChip'
import { onAirText } from '@/lib/onAirText'
import { BandEvent, BandLine, BandSince, Tab } from '@/components/tv/onAir'
import { JoinTag } from '@/components/tv/Join'
import { bandRows, bandTeamNames, teamsLineFits } from '@/components/tv/scene'
import { GameStatus } from '@/components/tv/StatusCard'
import Ticker from '@/components/tv/Ticker'
import { accentOf } from '@/games/registry'
import type { FeedItem, SessionGame, Team } from '@/lib/types'
import { useLive } from '@/lib/useLive'

/** A team's points in the stage game (teamPoints in src/lib/teams.ts). */
type TeamRow = { team: Pick<Team, 'id' | 'name' | 'colour'>; points: number }

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
 * night's top five, join the list in `lines`: while the stage game is played
 * in teams, a line with each team's points in it, above the games, when the
 * band has a line to spare (`teamsLineFits`).
 */
export default function Band({
  games,
  joinCode,
  ticker,
  sourceOf,
  teams = null,
}: {
  /** The games in the background, oldest start first. */
  games: SessionGame[]
  /** The join tag's code, or null to leave it out. */
  joinCode: string | null
  /** The ticker's announcement (news.ts), while it holds one. */
  ticker?: FeedItem
  /** A game's title, for news from a game that has no line. */
  sourceOf: (gameId: string | null | undefined) => string | undefined
  /** Each team's points in the stage game while it is played in teams, in team order; else null. */
  teams?: readonly TeamRow[] | null
}) {
  const { snapshot } = useLive()
  const feed = snapshot?.feed ?? []
  const tickerType = snapshot?.games.find((g) => g.id === ticker?.game_id)?.game_type

  const rows = bandRows(games, ticker)
  const lines: ReactNode[] = rows.map((row) => {
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
  // Last in the list, so it stands above the games and the evening-long one keeps the bottom line.
  if (teams && teams.length > 0 && teamsLineFits(rows)) lines.push(<TeamsLine key="teams" teams={teams} />)
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

/**
 * The teams in the stage game: each team's swatch, its name and its points,
 * in team order so nobody moves as the points come in. The name carries the
 * team (a state never rests on colour alone), without the "Team " they all
 * share (bandTeamNames); names end in an ellipsis when the line runs out of
 * room, the points never do.
 */
function TeamsLine({ teams }: { teams: readonly TeamRow[] }) {
  const names = bandTeamNames(teams.map((row) => row.team.name))
  return (
    <BandLine tab={<Tab tone="paper">Teams</Tab>}>
      {teams.map(({ team, points }, i) => (
        <span key={team.id} data-team="" className="flex min-w-0 items-center gap-3 short:gap-2.5">
          <TeamSwatch team={team} className="size-6 short:size-5" />
          <span className="min-w-0 truncate text-tv-tab font-semibold text-paper-2 short:text-tv-floor">{names[i]}</span>
          <span className="shrink-0 tv-num text-tv-band text-paper short:text-tv-field">{points}</span>
        </span>
      ))}
    </BandLine>
  )
}
