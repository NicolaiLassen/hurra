// The phone's running order (docs/engine-v2.md, 7.1): what the TV shows now,
// what comes next and what comes later, as a pure function of the snapshot,
// so the phone never says what the data doesn't hold. Unit-tested in
// running.test.ts.
import { clockTime, finishedAt, finishedLine, runningSince } from '@/components/phone/text'
import { liveGames, phoneLayout, tvScene, type PhoneLayout } from '@/lib/stage'
import type { SessionGame, Snapshot } from '@/lib/types'

/** The phone home's main card and the sections under it. */
export type HomeLayout = {
  /** As phoneLayout's, or 'none': nothing holds the main card, and the home starts with your place. */
  main: PhoneLayout['main'] | { kind: 'none' }
  /** Live games off the main card, oldest start first: each one's own section. */
  alsoRunning: SessionGame[]
  finishedLately: SessionGame[]
}

/**
 * Oldest start first, as the TV's rail: a section keeps its place when
 * another game starts, so the game that runs all evening (Last one standing)
 * stays right under On the TV.
 */
const byOldestStart = (a: SessionGame, b: SessionGame) =>
  (a.started_at ?? 0) - (b.started_at ?? 0) || a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * The phone home (docs/engine-v2.md, 7.1): phoneLayout's main card, except
 * that a game that runs in the background (its logic's presentation) and is
 * not on the TV never takes it. It keeps its own section, as Last one standing
 * does all evening, and opens full screen in the sheet, so the home keeps its
 * order: your place, On the TV, then the games running underneath.
 */
export function homeLayout(s: Snapshot, now: number, isBackground: (gameType: string) => boolean): HomeLayout {
  const layout = phoneLayout(s, now)
  const { main } = layout
  if (main.kind !== 'game' || main.onStage || !isBackground(main.game.game_type)) {
    return { ...layout, alsoRunning: [...layout.alsoRunning].sort(byOldestStart) }
  }
  return { main: { kind: 'none' }, alsoRunning: liveGames(s).sort(byOldestStart), finishedLately: layout.finishedLately }
}

/** One line of On the TV: Now, Next or Later, the title, and a quiet line under it. */
export type TvRow = { when: 'Now' | 'Next' | 'Later'; what: string; detail: string | null }

/** Games still to come, in the host's running order (position, then when they were added). */
export function waitingGames(s: Snapshot): SessionGame[] {
  return s.games
    .filter((g) => g.status === 'pending' && g.archived_at === null)
    .sort((a, b) => a.position - b.position || a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * Now, from the TV's scene, then Next and Later from the games still to come,
 * in their order. Only times the database holds, as clock times: when the game
 * on the TV started or finished; nothing for a game still to come, which has no
 * planned time. `mainId` is the game on the phone's main card: it says its own
 * Now, so Now leaves it out. `strapOf` gives a live game's own words
 * (GameModule.phoneStrap).
 */
export function tvRows(
  s: Snapshot,
  now: number,
  meId: string,
  mainId: string | null,
  strapOf: (game: SessionGame) => string | null = () => null,
): TvRow[] {
  const rows: TvRow[] = []
  const scene = tvScene(s, now)
  switch (scene.kind) {
    case 'recap':
      rows.push({ when: 'Now', what: 'Recap of the night', detail: null })
      break
    case 'over':
      rows.push({ when: 'Now', what: 'Final standings', detail: null })
      break
    case 'live':
      if (scene.game.id !== mainId) {
        rows.push({ when: 'Now', what: scene.game.title, detail: strapOf(scene.game) ?? runningSince(scene.game) })
      }
      break
    case 'final':
      if (scene.game.id !== mainId) {
        rows.push({ when: 'Now', what: finishedLine(scene.game, s.players, meId), detail: finishedAt(scene.game) })
      }
      break
    case 'standings': {
      const last = scene.lastGame
      const scored = s.standings.some((row) => row.points !== 0)
      rows.push({
        when: 'Now',
        what: last || scored ? 'The night so far' : 'The scoreboard',
        detail: last?.finished_at != null ? `${finishedLine(last, s.players, meId)} at ${clockTime(last.finished_at)}` : null,
      })
      break
    }
  }
  if (scene.kind === 'over') return rows

  const [next, later, ...rest] = waitingGames(s)
  if (next) rows.push({ when: 'Next', what: next.title, detail: null })
  if (later) rows.push({ when: 'Later', what: later.title, detail: rest.length > 0 ? `Then ${rest.length} more` : null })
  return rows
}

/** What the main card holds that a guest must not miss: its game and its newest open question. */
export type MainQuestion = { gameId: string | null; questionKey: string | null }

/** Whether the main card has news since `before`: another game took it, or a new question opened on it. */
export function mainCardNews(before: MainQuestion, now: MainQuestion): boolean {
  return (now.gameId !== null && now.gameId !== before.gameId) || (now.questionKey !== null && now.questionKey !== before.questionKey)
}

/**
 * Whether an open sheet (say Last one standing's, left open after a camera
 * scan) gives way to a new question on the main card, so the guest sees it
 * while its seconds run: only for a timed question, and never while the
 * sheet still works on a scanned code. The sheet's game keeps its state, and
 * its section opens it again.
 */
export function sheetGivesWay({ news, covered, timed, scanning }: { news: boolean; covered: boolean; timed: boolean; scanning: boolean }): boolean {
  return news && covered && timed && !scanning
}
