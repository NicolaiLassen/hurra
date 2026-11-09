// What the TV and the phones show (docs/engine-v2.md, 5.5, and user-flows 7):
// pure functions of a snapshot and the server time, shared by the phone, the
// TV and the host page so they always agree.
//
// Relative imports only, and no DOM: the rehearsal checks scenes under Node.
import type { AnswerPayload, PromptState, SessionGame, Snapshot, Tallies } from './types'

/** How long a finished game holds the TV stage: from max(finished_at, spotlight_at). */
export const FINAL_SCREEN_MS = 180_000

export type TvScene =
  /** tv_scene 'recap' and a published recap. */
  | { kind: 'recap' }
  /** The party is archived: final standings. */
  | { kind: 'over' }
  /** The spotlit game is live. */
  | { kind: 'live'; game: SessionGame }
  /** The spotlit game finished, inside its 3 minutes. */
  | { kind: 'final'; game: SessionGame; until: number }
  /** With "Last game: Mads won X". */
  | { kind: 'standings'; lastGame: SessionGame | null }

export type PhoneLayout = {
  main:
    | { kind: 'game'; game: SessionGame; onStage: boolean }
    | { kind: 'result'; game: SessionGame }
    | { kind: 'lobby' }
    | { kind: 'over' }
  alsoRunning: SessionGame[]
  finishedLately: SessionGame[]
}

const NOTHING: Readonly<Record<string, never>> = Object.freeze({})
const RECENTLY_FINISHED_MS = 10 * 60_000
const PHONE_FINISHED_LATELY_MS = 30 * 60_000

const isLive = (g: SessionGame) => g.status === 'active' && g.archived_at === null
const isFinished = (g: SessionGame): g is SessionGame & { finished_at: number } =>
  g.status === 'finished' && g.archived_at === null && g.finished_at !== null

/** Newest first; started_at, then created_at and id break ties so every screen sorts alike. */
const byNewestStart = (a: SessionGame, b: SessionGame) =>
  (b.started_at ?? 0) - (a.started_at ?? 0) || b.created_at - a.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const byNewestFinish = (a: SessionGame, b: SessionGame) =>
  (b.finished_at ?? 0) - (a.finished_at ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

function spotlit(s: Snapshot): SessionGame | undefined {
  const id = s.session?.spotlight_game_id
  return id ? s.games.find((g) => g.id === id) : undefined
}

/** The newest start of any game other than `game`, archived ones included: the next game "has started". */
function newestOtherStart(s: Snapshot, game: SessionGame): number {
  let newest = -Infinity
  for (const g of s.games) if (g.id !== game.id && g.started_at !== null && g.started_at > newest) newest = g.started_at
  return newest
}

/**
 * The most recently finished game (not archived) while it is still the news:
 * no other game has started since it finished. Null otherwise.
 */
function lastResult(s: Snapshot): SessionGame | null {
  const last = s.games.filter(isFinished).sort(byNewestFinish)[0]
  return last && newestOtherStart(s, last) <= last.finished_at ? last : null
}

/** max(finished_at, spotlight_at) + 3 minutes, or null when the game isn't a finished spotlight. */
export function finalScreenEndsAt(s: Snapshot, gameId: string): number | null {
  const game = spotlit(s)
  if (!game || game.id !== gameId || !isFinished(game)) return null
  return Math.max(game.finished_at, s.session?.spotlight_at ?? 0) + FINAL_SCREEN_MS
}

export function tvScene(s: Snapshot, now: number): TvScene {
  const session = s.session
  if (session?.tv_scene === 'recap' && s.recap) return { kind: 'recap' }
  if (session?.archived_at != null) return { kind: 'over' }
  const game = spotlit(s)
  if (game && isLive(game)) return { kind: 'live', game }
  if (game) {
    const until = finalScreenEndsAt(s, game.id)
    if (until !== null && now < until) return { kind: 'final', game, until }
  }
  return { kind: 'standings', lastGame: lastResult(s) }
}

/** Live, not archived, newest start first. */
export function liveGames(s: Snapshot): SessionGame[] {
  return s.games.filter(isLive).sort(byNewestStart)
}

/** Live games off the stage: the TV's status cards. */
export function backgroundGames(s: Snapshot): SessionGame[] {
  const stage = s.session?.spotlight_game_id ?? null
  return liveGames(s).filter((g) => g.id !== stage)
}

/** Finished in the last `withinMs` (default 10 minutes) and not on the stage: the TV's chips. Newest first. */
export function recentlyFinished(s: Snapshot, now: number, withinMs = RECENTLY_FINISHED_MS): SessionGame[] {
  return s.games
    .filter(isFinished)
    .filter((g) => now - g.finished_at <= withinMs)
    .filter((g) => {
      const until = finalScreenEndsAt(s, g.id)
      return until === null || now >= until
    })
    .sort(byNewestFinish)
}

export function phoneLayout(s: Snapshot, now: number): PhoneLayout {
  if (s.session?.archived_at != null) return { main: { kind: 'over' }, alsoRunning: [], finishedLately: [] }
  const live = liveGames(s)
  const stage = spotlit(s)
  let main: PhoneLayout['main']
  if (stage && isLive(stage)) {
    main = { kind: 'game', game: stage, onStage: true }
  } else if (live.length > 0) {
    main = { kind: 'game', game: live[0], onStage: false }
  } else {
    // The result stays until the next game starts (user-flows 7.4).
    const last = lastResult(s)
    main = last ? { kind: 'result', game: last } : { kind: 'lobby' }
  }
  const mainId = main.kind === 'game' || main.kind === 'result' ? main.game.id : null
  return {
    main,
    alsoRunning: live.filter((g) => g.id !== mainId),
    finishedLately: s.games
      .filter(isFinished)
      .filter((g) => g.id !== mainId && now - g.finished_at <= PHONE_FINISHED_LATELY_MS)
      .sort(byNewestFinish),
  }
}

/** Which live game gets a camera scan: the main game if it accepts scans, else the newest that does. */
export function scanTarget(s: Snapshot, acceptsScans: (gameType: string) => boolean, now: number): SessionGame | null {
  const { main } = phoneLayout(s, now)
  if (main.kind === 'over') return null
  if (main.kind === 'game' && acceptsScans(main.game.game_type)) return main.game
  return liveGames(s).find((g) => acceptsScans(g.game_type)) ?? null
}

/** This game's prompts (this round), in the order they opened. */
export function promptsOf(s: Snapshot, gameId: string): PromptState[] {
  return s.prompts.filter((p) => p.game_id === gameId)
}

/** Answers in so far, by unrevealed prompt key. */
export function talliesOf(tallies: Tallies, gameId: string): Record<string, number> {
  return tallies[gameId] ?? NOTHING
}

/** This round's points per player: its scores plus its awards and bonuses. */
export function gamePointsOf(s: Snapshot, gameId: string): Record<string, number> {
  return s.game_points[gameId] ?? NOTHING
}

/** The phone's own answers to this game's prompts (active games only), by key. */
export function myAnswersOf(s: Snapshot, gameId: string): Record<string, AnswerPayload> {
  return s.me?.answers[gameId] ?? NOTHING
}
