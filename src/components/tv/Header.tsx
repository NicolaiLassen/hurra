import Logo from '@/components/Logo'
import { clockTime } from '@/components/tv/clock'
import { Tab } from '@/components/tv/onAir'
import type { SceneLine } from '@/components/tv/scene'
import { GameStatus } from '@/components/tv/StatusCard'
import type { SessionGame } from '@/lib/types'

/**
 * The top of the TV's frame (docs/identity.md, The TV's frame): at the left
 * the programme strap, a tilted gold tab with one word for what is on and a
 * paper strap saying where it is ("Question 3 of 10", "Quiz then Who is
 * fused?"); at the right the bug, the party's name, the time of night and the
 * logo. Big news takes this row's whole width for a moment (Banner).
 * Over a winner's colour field (WinnerMoment's `data-tv-field`, found through
 * the frame's `group/frame`) the tab stands on ink and the bug's words turn
 * ink, so both read on any guest colour.
 */
export default function Header({ line, name, now }: { line: SceneLine; name: string; now: number }) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-12 short:h-14 short:gap-8">
      <Strap line={line} />
      <Bug name={name} now={now} />
    </header>
  )
}

/** The tab and the paper strap. The strap's words end in an ellipsis when they run out of room. */
function Strap({ line }: { line: SceneLine }) {
  return (
    <div data-frame="strap" className="flex min-w-0 items-center">
      <Tab size="strap" className="max-w-[36rem] shrink-0 group-has-[[data-tv-field]]/frame:bg-ink group-has-[[data-tv-field]]/frame:text-gold">
        {line.tab}
      </Tab>
      <p className="-ml-1 flex h-14 min-w-0 items-center bg-paper px-6 text-tv-body text-ink short:h-12 short:px-5 short:text-tv-tab">
        <span className="min-w-0 truncate">
          {line.game ? (
            <span className="font-semibold">
              <GameWords game={line.game} />
            </span>
          ) : (
            <>
              {line.strong && <span className="font-bold">{line.strong}</span>}
              {line.rest && <span className="font-normal text-ink/75"> {line.rest}</span>}
            </>
          )}
        </span>
      </p>
    </div>
  )
}

/**
 * The stage game's own strap words (its TvStatus `strap` variant). A game
 * without them gets the time it started, a time the database holds, or
 * "Final result" once it is over.
 */
function GameWords({ game }: { game: SessionGame }) {
  const plain = game.status === 'finished' ? 'Final result' : game.started_at !== null ? `Running since ${clockTime(game.started_at)}` : 'Starting'
  return <GameStatus game={game} variant="strap" fallback={plain} />
}

/** The party's name, the time of night and the logo, like a channel's corner bug. A long name ends in an ellipsis. */
function Bug({ name, now }: { name: string; now: number }) {
  return (
    <div data-frame="bug" className="flex min-w-0 shrink-0 items-center gap-6 short:gap-5">
      <p className="max-w-[26rem] min-w-0 truncate text-tv-tab font-medium text-paper-2 short:max-w-[20rem] short:text-tv-floor group-has-[[data-tv-field]]/frame:text-ink">{name}</p>
      <time dateTime={new Date(now).toISOString()} className="shrink-0 tv-num text-tv-band text-paper short:text-tv-field group-has-[[data-tv-field]]/frame:text-ink">
        {clockTime(now)}
      </time>
      <Logo className="size-15 shrink-0 ring-0 short:size-12" />
    </div>
  )
}
