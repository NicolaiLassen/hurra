// Words and choices for the host control room (docs/engine-v2.md, 7.3): what
// the TV shows right now, who won a game, how a game starts, which game a host
// award goes to. Pure functions of a snapshot, so they are unit-tested.
import type { Presentation } from '@/games/core/Game'
import { listNames } from '@/lib/recap'
import { liveGames, type TvScene } from '@/lib/stage'
import type { Player, SessionGame, Snapshot } from '@/lib/types'

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

/** "No TV paired yet", "1 TV paired", "2 TVs paired". */
export function screensLine(screens: number | null): string {
  const count = screens ?? 0
  if (count <= 0) return 'No TV paired yet'
  return `${count} TV${count === 1 ? '' : 's'} paired`
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
