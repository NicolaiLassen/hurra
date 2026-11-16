import { useCallback, useState, type ReactNode } from 'react'
import { ChipRow, FinishedChip, LiveChip } from '@/components/tv/Chips'
import { cardsThatFit, cardsThatStack } from '@/components/tv/fit'
import { Eyebrow, Measured } from '@/components/tv/parts'
import StatusCard from '@/components/tv/StatusCard'
import type { Player, SessionGame } from '@/lib/types'

/** A card in the strip: this wide when there is room... */
const CARD_PX = 352
/** ...and never narrower than this (a game's rail card is drawn for about 24rem). */
const CARD_MIN_PX = 272
/** The room between cards, and between the chip groups under the join card (gap-4), in px. */
const GAP_PX = 16

type Games = { nowPlaying: SessionGame | null; running: SessionGame[]; finished: SessionGame[]; players: Player[] }

/**
 * The status cards while the standings show (docs/engine-v2.md, 7.2): the game
 * on the stage when it has no screen of its own ("Now playing"), the games in
 * the background ("Also running"), and the games that finished lately as
 * chips. It sits beside the podium, in the `room` the board measured, so the
 * standings below keep their height; cards that don't fit become Live chips.
 * Under a small party's join card every game is a chip, in as many groups as
 * fit the height the card leaves (`chipsHeight`), so the chips never push that
 * column out of the room.
 */
export default function Strip({
  room,
  chipsHeight,
  nowPlaying,
  running,
  finished,
  players,
}: Games & {
  room: number
  /** Under a small party's join card: only chips, in at most this height (px). */
  chipsHeight?: number
}) {
  const cards = nowPlaying ? [nowPlaying, ...running] : running
  const fit = Math.min(cards.length, cardsThatFit(room, CARD_MIN_PX, GAP_PX))
  const width = fit > 0 ? Math.min(CARD_PX, (room - (fit - 1) * GAP_PX) / fit) : 0
  const shownPlaying = nowPlaying && fit > 0 ? nowPlaying : null
  const shownRunning = cards.slice(shownPlaying ? 1 : 0, fit)
  const chips = cards.slice(fit)

  if (chipsHeight !== undefined) {
    return <ChipGroups room={room} height={chipsHeight} nowPlaying={nowPlaying} running={running} finished={finished} players={players} />
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

/**
 * Every game as a chip, in labelled groups stacked from the top, as many as
 * fit `height` (Finished goes first, then Also running). The groups that don't
 * fit stay mounted out of sight, as the rail's cards do, so they come back
 * when there is room again.
 */
function ChipGroups({ room, height, nowPlaying, running, finished, players }: Games & { room: number; height: number }) {
  const [heights, setHeights] = useState<Record<string, number>>({})
  const report = useCallback(
    (label: string, h: number) => setHeights((prev) => (prev[label] === h ? prev : { ...prev, [label]: h })),
    [],
  )
  const groups: { label: string; chips: ReactNode[] }[] = [
    { label: 'Now playing', chips: nowPlaying ? [<LiveChip key={nowPlaying.id} game={nowPlaying} />] : [] },
    { label: 'Also running', chips: running.map((game) => <LiveChip key={game.id} game={game} />) },
    { label: 'Finished', chips: finished.map((game) => <FinishedChip key={game.id} game={game} players={players} />) },
  ].filter((group) => group.chips.length > 0)
  const shown = cardsThatStack(groups.map((group) => heights[group.label] ?? 0), height, GAP_PX, 0)

  return (
    <div data-fit="strip" className="relative flex min-w-0 flex-col gap-4" style={{ maxWidth: room }}>
      {groups.map((group, i) => (
        <Measured key={group.label} id={group.label} hidden={i >= shown} onHeight={report}>
          <div className="grid gap-2">
            <Eyebrow>{group.label}</Eyebrow>
            <ChipRow>{group.chips}</ChipRow>
          </div>
        </Measured>
      ))}
    </div>
  )
}
