// Words and choices for the host control room (docs/engine-v2.md, 7.3): what
// the TV shows right now, who won a game, how a game starts, which game a host
// award goes to. Pure functions of a snapshot, so they are unit-tested.
import type { Presentation } from '@/games/core/Game'
import type { SetupStatus } from '@/games/types'
import { listNames } from '@/lib/recap'
import { liveGames, type TvScene } from '@/lib/stage'
import type { Player, Session, SessionGame, Snapshot } from '@/lib/types'

type Named = Pick<Player, 'id' | 'name'>

/** m:ss, rounded up to the next whole second and never below 0:00. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** The winners' names. The party may have lost one of them since: "a guest who left". */
export function winnerNames(game: Pick<SessionGame, 'winners'>, players: readonly Named[]): string[] {
  return game.winners.map((id) => players.find((p) => p.id === id)?.name ?? 'a guest who left')
}

/** "Mads won Quiz", "Mads and Ana won Quiz", or "Quiz is over" when nobody won. */
export function resultLine(game: Pick<SessionGame, 'winners' | 'title'>, players: readonly Named[]): string {
  const names = winnerNames(game, players)
  return names.length > 0 ? `${capitalize(listNames(names))} won ${game.title}` : `${game.title} is over`
}

/** "Mads won", "Mads and Ana won", or null when nobody won. For the winners chip beside a title. */
export function winnersChip(game: Pick<SessionGame, 'winners'>, players: readonly Named[]): string | null {
  const names = winnerNames(game, players)
  return names.length > 0 ? `${capitalize(listNames(names))} won` : null
}

const capitalize = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text)

export type StageWords = { title: string; detail: string }

/** The TV's current scene in words, for "On the TV now". `now` is the server clock. */
export function stageWords(scene: TvScene, players: readonly Named[], now: number): StageWords {
  switch (scene.kind) {
    case 'recap':
      return { title: 'The recap of the night', detail: 'It plays on a loop until you go back to the party.' }
    case 'over':
      return { title: 'Final standings', detail: 'The party is archived, so the TV shows how the night ended.' }
    case 'live':
      return { title: scene.game.title, detail: "Live on the TV. Back to standings won't stop it." }
    case 'final':
      return {
        title: `Final result: ${scene.game.title}`,
        detail: `${resultLine(scene.game, players)}. The TV goes back in ${formatCountdown(scene.until - now)}.`,
      }
    case 'standings':
      return {
        title: 'The standings',
        detail: scene.lastGame ? `Last game: ${resultLine(scene.lastGame, players)}.` : "Everyone's points for the night.",
      }
  }
}

/** The header's line under the party's name: "12 guests, joining is open". */
export function partyLine(guests: number, session: Pick<Session, 'status' | 'archived_at'>): string {
  const count = guests === 1 ? '1 guest' : `${guests} guests`
  if (session.archived_at !== null) return `${count}, the party is over`
  return `${count}, joining is ${session.status === 'open' ? 'open' : 'closed'}`
}

/** A game's readiness in the room: undefined while its settings load, null when the game says nothing (it starts as always). */
export type Readiness = (gameId: string) => SetupStatus | null | undefined

/**
 * The control room's one gold step (docs/identity.md) where the TV leaves it
 * to the program: Pair a TV, a game's Set up, or a game's Start.
 */
export type RoomStep = { kind: 'pair' } | { kind: 'setup'; gameId: string } | { kind: 'start'; gameId: string } | null

/**
 * The room's one gold step while the TV shows the standings and the party
 * isn't archived (a live game on the TV has its own next step, a final screen
 * Back to standings, the recap Back to the party). Games live in the
 * background don't stop it: Last one standing runs all night.
 *
 * - No TV open yet: setting the games up comes first, so the first game not
 *   started that isn't ready gets Set up; once every one is ready, Pair a TV.
 * - A TV open: the first game not started, with Set up when it isn't ready
 *   and its Start when it is.
 *
 * Nothing is gold while the settings are still read, so the gold never jumps
 * from Start to Set up as they come in.
 */
export function roomStep(s: Snapshot, scene: TvScene, tvOpen: boolean, readiness: Readiness): RoomStep {
  if (!s.session || s.session.archived_at !== null || scene.kind !== 'standings') return null
  const pending = arrangeGames(s).program.filter((g) => g.status === 'pending')
  if (pending.some((g) => readiness(g.id) === undefined)) return null
  const notReady = (g: SessionGame) => readiness(g.id)?.ready === false
  if (!tvOpen) {
    const todo = pending.find(notReady)
    return todo ? { kind: 'setup', gameId: todo.id } : { kind: 'pair' }
  }
  const next = pending[0]
  if (!next) return null
  return { kind: notReady(next) ? 'setup' : 'start', gameId: next.id }
}

/** What a game's row in the program shows, beside its title (docs/user-flows.md, 3.2). */
export type RowPlan = {
  /** The line under its name: its readiness, when it says one. */
  status: SetupStatus | null
  /** The settings button: Set up while a game not started isn't ready, else Settings; null without settings to edit. */
  settings: { label: 'Settings' | 'Set up'; gold: boolean } | null
  /** The split Start, for a game not started that is ready (or says nothing): gold when it is the room's step. */
  start: { gold: boolean } | null
  /** Start anyway in the menu: a game not started that isn't ready, but that its own check would start. */
  startAnyway: boolean
}

/**
 * A row's buttons and line. A game not started shows its readiness and, when
 * it isn't ready, Set up in place of its Start (the Start moves to the menu as
 * Start anyway, when the game would start at all). A finished game keeps
 * Settings beside Show on the TV for a restart, and says it only when its
 * settings aren't ready. A live or archived game has neither: settings are
 * frozen into a round when it starts.
 */
export function rowPlan(
  game: Pick<SessionGame, 'id' | 'status' | 'archived_at'>,
  { editable, status, step, startable }: { editable: boolean; status: SetupStatus | null | undefined; step: RoomStep; startable: boolean },
): RowPlan {
  const none: RowPlan = { status: null, settings: null, start: null, startAnyway: false }
  if (game.archived_at !== null || game.status === 'active') return none
  const isStep = (kind: 'setup' | 'start') => step !== null && step.kind === kind && step.gameId === game.id
  const notReady = status?.ready === false
  if (game.status === 'finished') {
    return { ...none, status: notReady ? status : null, settings: editable ? { label: 'Settings', gold: false } : null }
  }
  if (notReady && editable) {
    return { status, settings: { label: 'Set up', gold: isStep('setup') }, start: null, startAnyway: startable }
  }
  return {
    status: status ?? null,
    settings: editable ? { label: 'Settings', gold: false } : null,
    start: { gold: isStep('start') },
    startAnyway: false,
  }
}

/** "No TV paired yet", "1 TV paired", "2 TVs paired". */
export function screensLine(screens: number | null, tabOpen = false): string {
  const count = screens ?? 0
  if (count <= 0) return tabOpen ? 'TV open in this browser' : 'No TV paired yet'
  return `${count} TV${count === 1 ? '' : 's'} paired`
}

/** A step of the TV's sound effects volume: "Off", "25%", "100%". */
export function soundVolumeLabel(volume: number): string {
  return volume <= 0 ? 'Off' : `${volume}%`
}

/** The toast after the host changes it: "TV sound effects at 50%", or "TV sound effects off". */
export function soundVolumeToast(volume: number): string {
  return volume <= 0 ? 'TV sound effects off' : `TV sound effects at ${volume}%`
}

export type StartChoice = { stage: boolean; label: string }

/** The split button's two sides: the default follows the game's presentation ('stage' when it says nothing). */
export function startChoices(presentation: Presentation | undefined): readonly [StartChoice, StartChoice] {
  const onTv: StartChoice = { stage: true, label: 'Start on the TV' }
  const background: StartChoice = { stage: false, label: 'Start in the background' }
  return presentation === 'background' ? [background, onTv] : [onTv, background]
}

/**
 * The game a host award goes to unless the host picks another: the one the
 * host came from (a game's Scan a player), else the stage game if it is live,
 * else the newest live game, else none.
 */
export function defaultAwardGame(s: Snapshot, preferred: string | null | undefined): string | null {
  if (preferred && s.games.some((g) => g.id === preferred && g.archived_at === null)) return preferred
  const live = liveGames(s)
  const stage = s.session?.spotlight_game_id
  if (stage && live.some((g) => g.id === stage)) return stage
  return live[0]?.id ?? null
}

/** A new game goes last in the program. */
export function nextPosition(games: readonly Pick<SessionGame, 'position'>[]): number {
  return games.reduce((last, g) => Math.max(last, g.position + 1), 0)
}

/** The control room's three lists: live games (newest start first), the program (by position), and the archive. */
export function arrangeGames(s: Snapshot): { live: SessionGame[]; program: SessionGame[]; archived: SessionGame[] } {
  const live = liveGames(s)
  const liveIds = new Set(live.map((g) => g.id))
  return {
    live,
    program: s.games.filter((g) => g.archived_at === null && !liveIds.has(g.id)),
    archived: s.games.filter((g) => g.archived_at !== null),
  }
}
