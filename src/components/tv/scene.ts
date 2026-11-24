// What the TV shows where (docs/engine-v2.md, 7.2), as pure functions of the
// scene from stage.ts, so the screen's rules are unit-tested. The core decides
// when a game's screens show, never what is in them.
import { boardTier } from '@/components/tv/fit'
import { listNames } from '@/lib/recap'
import type { TvScene } from '@/lib/stage'
import type { Player, Session, SessionGame } from '@/lib/types'

/** What fills the TV's stage, between the programme strap and the band. */
export type MainArea =
  /** The recap's slides, full screen. */
  | { kind: 'recap' }
  /**
   * The podium and standings: between games, at the end of the party (`over`),
   * or while a game without a TV view of its own is on the stage (`nowPlaying`).
   */
  | { kind: 'board'; over: boolean; nowPlaying: SessionGame | null }
  /** A game's own screen, the full width of the stage: live, or its final screen. */
  | { kind: 'stage'; game: SessionGame; finished: boolean }

/** Which main area a scene gets. A finished game always has a final screen: its own, or the generic one. */
export function mainArea(scene: TvScene, hasTvView: (gameType: string) => boolean): MainArea {
  switch (scene.kind) {
    case 'recap':
      return { kind: 'recap' }
    case 'over':
      return { kind: 'board', over: true, nowPlaying: null }
    case 'standings':
      return { kind: 'board', over: false, nowPlaying: null }
    case 'live':
      return hasTvView(scene.game.game_type)
        ? { kind: 'stage', game: scene.game, finished: false }
        : { kind: 'board', over: false, nowPlaying: scene.game }
    case 'final':
      return { kind: 'stage', game: scene.game, finished: true }
  }
}

/**
 * Where the way in shows while joining is open (docs/identity.md, The TV's
 * frame):
 * - `board`: a small party's big join card on the board (1 to 3 guests,
 *   boardTier `few`), so the first guests' friends can scan it from across
 *   the room;
 * - `qr`: the join block beside the podium, the QR code on its white quiet
 *   zone with the code, on a bigger party's standings;
 * - `code`: "Join with HURRA30" at the band's right, while a game holds the
 *   stage, so the game keeps the room; also on the standings while a game
 *   without a screen of its own holds the stage, whose card then stands
 *   beside the podium.
 * Nowhere before anyone has joined (the lobby is one big QR code already), on
 * the recap, or while joining is closed.
 */
export type JoinPlace = 'board' | 'qr' | 'code'

export function joinPlace(area: MainArea, open: boolean, guests: number): JoinPlace | null {
  if (!open || area.kind === 'recap') return null
  if (area.kind === 'stage') return 'code'
  if (guests === 0) return null
  if (boardTier(guests) === 'few') return 'board'
  return area.nowPlaying ? 'code' : 'qr'
}

/** The names of a game's winners who are still in the party, in the order the game gave them. */
export function winnerNames(game: SessionGame, players: readonly Player[]): string[] {
  const names = new Map(players.map((p) => [p.id, p.name]))
  return game.winners.flatMap((id) => {
    const name = names.get(id)
    return name === undefined ? [] : [name]
  })
}

/** "Mads won Quiz", "Ana and Bo won Quiz", or "Quiz is over" when nobody (still here) won. */
export function resultLine(game: SessionGame, players: readonly Player[]): string {
  const names = winnerNames(game, players)
  return names.length > 0 ? `${listNames(names)} won ${game.title}` : `${game.title} is over`
}

/**
 * The programme strap at the top of the TV (docs/identity.md, The TV's
 * frame): the tilted tab's one short word for what is on, and the paper
 * strap's words, the part in full strength first. While a game holds the
 * stage, `game` is set and its own strap words (its TvStatus `strap`
 * variant) fill the strap.
 */
export type SceneLine = { tab: string; strong?: string; rest?: string; game?: SessionGame }

export function sceneLine(scene: TvScene, players: readonly Player[], games: readonly SessionGame[]): SceneLine {
  switch (scene.kind) {
    case 'live':
    case 'final':
      return { tab: scene.game.title, game: scene.game }
    case 'standings': {
      // What comes next, in the host's order; only what the data holds, so no planned times.
      const [next, later] = comingUp(games)
      if (next) return { tab: 'Next', strong: next.title, rest: later ? `then ${later.title}` : undefined }
      return { tab: 'Standings', strong: scene.lastGame ? resultLine(scene.lastGame, players) : 'The scoreboard' }
    }
    case 'over':
      return { tab: 'The end', strong: 'Final standings' }
    case 'recap':
      return { tab: 'Recap', strong: 'Recap of the night' }
  }
}

/** The games still to come, in the host's running order (position, then when they were added). */
export function comingUp(games: readonly SessionGame[]): SessionGame[] {
  return games
    .filter((g) => g.status === 'pending' && g.archived_at === null)
    .sort((a, b) => a.position - b.position || a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * Oldest start first: the band keeps the evening-long game (Last one standing)
 * on its bottom line, and a game started later joins above it instead of
 * moving it.
 */
export function byOldestStart(a: SessionGame, b: SessionGame): number {
  return (a.started_at ?? 0) - (b.started_at ?? 0) || a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** "Just started", "12 min", "1 h 5 min": how long a game has been running. */
export function runningFor(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return 'Just started'
  if (minutes < 60) return `${minutes} min`
  const rest = minutes % 60
  return rest === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${rest} min`
}

/** A game's points, highest first, for players still in the party; nobody when nobody has scored. */
export function topOfGame(points: Readonly<Record<string, number>>, players: readonly Player[], max = 5): { player: Player; points: number }[] {
  return players
    .map((player) => ({ player, points: points[player.id] ?? 0 }))
    .filter((row) => row.points !== 0)
    .sort((a, b) => b.points - a.points || a.player.name.localeCompare(b.player.name))
    .slice(0, max)
}

/** How long the "Hurra presents" title card shows. */
export const TITLE_CARD_MS = 3000
/** A stage taken longer ago than this gets no title card (a TV that reloads mid-game). */
export const TITLE_CARD_FRESH_MS = 10_000

/** One title card per round of a game: a restart is a new round and gets its own. */
export const titleCardKey = (game: SessionGame) => `${game.id}:${game.started_at ?? 0}`

/**
 * The title card's key when a game has just taken the stage (a start on the TV,
 * Show on the TV, or a restart on the stage), else null. Whether this TV has
 * already shown it is the caller's to remember.
 */
export function freshStage(scene: TvScene, session: Session, now: number): string | null {
  if (scene.kind !== 'live') return null
  const takenAt = Math.max(session.spotlight_at ?? 0, scene.game.started_at ?? 0)
  return now - takenAt <= TITLE_CARD_FRESH_MS ? titleCardKey(scene.game) : null
}
