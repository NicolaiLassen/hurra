import type { ReactNode } from 'react'
import { ChipRow, FinishedChip, LiveChip } from '@/components/tv/Chips'
import { cardsThatFit } from '@/components/tv/fit'
import { Eyebrow } from '@/components/tv/parts'
import StatusCard from '@/components/tv/StatusCard'
import type { Player, SessionGame } from '@/lib/types'

/** A card in the strip: this wide when there is room... */
const CARD_PX = 352
/** ...and never narrower than this (a game's rail card is drawn for about 24rem). */
const CARD_MIN_PX = 272
/** The room between cards (gap-4), in px. */
const GAP_PX = 16

/**
 * The status cards while the standings show (docs/engine-v2.md, 7.2): the game
 * on the stage when it has no screen of its own ("Now playing"), the games in
 * the background ("Also running"), and the games that finished lately as
 * chips. It sits beside the podium, in the `room` the board measured, so the
 * standings below keep their height; cards that don't fit become Live chips.
 * Under a small party's join card every game is a chip (`chipsOnly`), so that
 * column never grows taller than the screen.
 */
export default function Strip({
  room,
  chipsOnly = false,
  nowPlaying,
  running,
  finished,
  players,
}: {
  room: number
  chipsOnly?: boolean
  nowPlaying: SessionGame | null
  running: SessionGame[]
  finished: SessionGame[]
  players: Player[]
}) {
  const cards = nowPlaying ? [nowPlaying, ...running] : running
  const fit = Math.min(cards.length, cardsThatFit(room, CARD_MIN_PX, GAP_PX))
  const width = fit > 0 ? Math.min(CARD_PX, (room - (fit - 1) * GAP_PX) / fit) : 0
  const shownPlaying = nowPlaying && fit > 0 ? nowPlaying : null
  const shownRunning = cards.slice(shownPlaying ? 1 : 0, fit)
  const chips = cards.slice(fit)

  if (chipsOnly) {
    return (
      <div data-fit="strip" className="flex min-w-0 flex-col gap-4 short:gap-3" style={{ maxWidth: room }}>
        {nowPlaying && (
          <ChipGroup label="Now playing">
            <LiveChip game={nowPlaying} />
          </ChipGroup>
        )}
        {running.length > 0 && (
          <ChipGroup label="Also running">
            {running.map((game) => (
              <LiveChip key={game.id} game={game} />
            ))}
          </ChipGroup>
        )}
        {finished.length > 0 && (
          <ChipGroup label="Finished">
            {finished.map((game) => (
              <FinishedChip key={game.id} game={game} players={players} />
            ))}
          </ChipGroup>
        )}
      </div>
    )
  }

  return (
    <div data-fit="strip" className="flex min-w-0 flex-col gap-4 short:gap-3" style={{ maxWidth: room }}>
      {fit > 0 && (
        <div className="flex items-start gap-4">
          {shownPlaying && (
            <Group label="Now playing" width={width}>
              <StatusCard game={shownPlaying} />
            </Group>
          )}
          {shownRunning.length > 0 && (
            <div className="grid gap-2">
              <Eyebrow>Also running</Eyebrow>
              <div className="flex items-start gap-4">
                {shownRunning.map((game) => (
                  <div key={game.id} data-fit="card" style={{ width }}>
                    <StatusCard game={game} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {(chips.length > 0 || finished.length > 0) && (
        <div className="grid gap-2">
          {chips.length === 0 && <Eyebrow>Finished</Eyebrow>}
          <ChipRow>
            {chips.map((game) => (
              <LiveChip key={game.id} game={game} />
            ))}
            {finished.map((game) => (
              <FinishedChip key={game.id} game={game} players={players} />
            ))}
          </ChipRow>
        </div>
      )}
    </div>
  )
}

function Group({ label, width, children }: { label: string; width: number; children: ReactNode }) {
  return (
    <div className="grid gap-2" data-fit="card" style={{ width }}>
      <Eyebrow>{label}</Eyebrow>
      {children}
    </div>
  )
}

function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Eyebrow>{label}</Eyebrow>
      <ChipRow>{children}</ChipRow>
    </div>
  )
}
