import { shuffle } from '../core/context'
import {
  Game,
  GameError,
  type GameContext,
  type GameInfo,
  type Highlight,
  type PlayerId,
  type RecapRound,
  type Scores,
} from '../core/Game'

export type EliminationConfig = {
  /** Dealt one per player; repeated when there are more players than tasks. */
  tasks: string[]
  pointsPerTag: number
  pointsPerCatch: number
}

/** The settings' limits, checked once at start (parseConfig) and shown in the editor. */
export const MAX_TASKS = 200
export const MAX_TASK_LENGTH = 200
export const MAX_POINTS = 100

/**
 * How someone was knocked out:
 * - tag: the player got the target to do their task (and takes over the target's task)
 * - catch: the target was caught trying their own task on the player (whose task stays the same)
 */
export type Method = 'tag' | 'catch'

export type Knockout = {
  by: PlayerId
  target: PlayerId
  method: Method
  /** The task involved, which is out of play now: the tagger's spent task, or the caught player's exposed one. */
  task: string
  at: number
}

export type EliminationState = {
  /** The current task of every player still in. Players who are out, or who left the party, have none. */
  tasks: Record<PlayerId, string>
  /** Everyone who was dealt in. */
  playerIds: PlayerId[]
  knockouts: Knockout[]
}

export type EliminationAction = { type: Method; target: PlayerId }

/** A knockout as everyone may see it: the task is hidden while someone else still holds the same one. */
export type PublicKnockout = Omit<Knockout, 'task'> & { task: string | null }

export type EliminationPublicState = {
  /** Still standing, in deal order. */
  alive: PlayerId[]
  /** Dealt in and no longer standing: knocked out, or gone from the party. */
  out: PlayerId[]
  winner: PlayerId | null
  /** Who knocked each player out, and how. */
  outBy: Record<PlayerId, { by: PlayerId; method: Method }>
  /** Knockouts per player, for the top hunters. */
  knockoutCounts: Record<PlayerId, number>
  /** Newest first. */
  feed: PublicKnockout[]
}

export type EliminationPlayerView =
  | { status: 'alive'; task: string; knockouts: number }
  | { status: 'out'; by: PlayerId; method: Method; task: string; knockouts: number }
  | { status: 'winner'; knockouts: number }
  | { status: 'spectator' }

/** Lasting achievements across rounds, shown as badges. */
export type EliminationProfile = { tags?: number; catches?: number; wins?: number }

export const DEFAULT_TASKS = [
  'Get someone to sing a line from a song',
  'Get someone to say ‘ribbit’ like a frog',
  'Get someone to give you a high five',
  'Get someone to tell you their middle name',
  'Get someone to do a little dance',
  'Get someone to take a selfie with you',
  'Get someone to say the word ‘banana’',
  'Get someone to sit down on the floor',
  'Get someone to hum a tune',
  'Get someone to compliment your outfit',
  'Get someone to touch their nose',
  'Get someone to clink glasses with you',
  'Get someone to tell you a joke',
  'Get someone to show you the last photo on their phone',
  'Get someone to talk in an accent',
  'Get someone to say your name three times',
  'Get someone to say ‘cheers’ in another language',
  'Get someone to do an impression of someone famous',
  'Get someone to tell you their star sign',
  'Get someone to hold your drink for you',
  'Get someone to say ‘bless you’',
  'Get someone to give you a hug',
  'Get someone to pull a funny face',
  'Get someone to whistle',
  'Get someone to tell you their favourite film',
  'Get someone to count to five in another language',
  'Get someone to check the time for you',
  'Get someone to snap their fingers',
  'Get someone to fix your collar or hair',
  'Get someone to say ‘you’re right’',
]

/** Anything that knows the party's players right now: GameInfo, a hook's context, or a view's props. */
export type Roster = { readonly players: readonly { readonly id: PlayerId }[] }

/** Dealt-in players who still have a task and are still in the party, in deal order. */
export function standing(state: EliminationState, info: Roster): PlayerId[] {
  const present = new Set(info.players.map((p) => p.id))
  return state.playerIds.filter((id) => holds(state, id) && present.has(id))
}

/** The last one standing: the only one left, out of more than one dealt in. */
export function winnerOf(state: EliminationState, info: Roster): PlayerId | null {
  const left = standing(state, info)
  return left.length === 1 && state.playerIds.length > 1 ? left[0] : null
}

/**
 * Everyone gets a secret task and one life. Knock someone out by getting them
 * to do your task (you take over theirs), or by catching them trying their
 * task on you (you keep yours). Scan their code either way. The last one
 * standing wins, and the game finishes by itself right then.
 *
 * It runs in the background all evening, beside whatever holds the TV.
 */
export class EliminationGame extends Game<
  EliminationState,
  EliminationAction,
  EliminationPublicState,
  EliminationPlayerView,
  EliminationConfig
> {
  readonly type = 'elimination'
  readonly presentation = 'background' as const
  readonly defaultConfig: EliminationConfig = { tasks: DEFAULT_TASKS, pointsPerTag: 1, pointsPerCatch: 1 }

  parseConfig(input: Record<string, unknown>): EliminationConfig {
    if (!Array.isArray(input.tasks) || input.tasks.some((task) => typeof task !== 'string')) {
      throw new GameError('The tasks must be a list of texts')
    }
    const tasks = cleanTasks(input.tasks)
    if (tasks.length === 0) throw new GameError('Add at least one task in the settings')
    if (tasks.length > MAX_TASKS) throw new GameError(`Use at most ${MAX_TASKS} tasks (there are ${tasks.length})`)
    // Numbered as the settings list shows them. Characters as Postgres counts them (code points).
    const long = (input.tasks as string[]).findIndex((task) => Array.from(task.trim()).length > MAX_TASK_LENGTH)
    if (long !== -1) throw new GameError(`Task ${long + 1} is longer than ${MAX_TASK_LENGTH} characters`)
    return {
      tasks,
      pointsPerTag: wholePoints(input.pointsPerTag, 'Points per tag'),
      pointsPerCatch: wholePoints(input.pointsPerCatch, 'Points per catch'),
    }
  }

  setup(ctx: GameContext<EliminationConfig>): EliminationState {
    // parseConfig already cleaned them at start; this keeps direct calls safe too.
    const tasks = cleanTasks(ctx.config.tasks)
    if (ctx.players.length < 2) throw new GameError('You need at least 2 players to start')
    if (tasks.length === 0) throw new GameError('Add at least one task in the settings')

    const deck = shuffle(tasks, ctx.random)
    ctx.announce('Last one standing has started', {
      detail: `${ctx.players.length} players, one life each`,
      icon: 'megaphone',
      sound: 'gong',
    })
    return {
      tasks: Object.fromEntries(ctx.players.map((player, i) => [player.id, deck[i % deck.length]])),
      playerIds: ctx.players.map((player) => player.id),
      knockouts: [],
    }
  }

  parseAction(input: unknown): EliminationAction {
    const action = input as Partial<EliminationAction> | null
    if (
      (action?.type === 'tag' || action?.type === 'catch') &&
      typeof action.target === 'string' &&
      action.target.length > 0 &&
      action.target.length <= 100
    ) {
      return { type: action.type, target: action.target }
    }
    throw new GameError('Unknown action')
  }

  handleAction(
    state: EliminationState,
    action: EliminationAction,
    playerId: PlayerId,
    ctx: GameContext<EliminationConfig>,
  ): EliminationState {
    const name = nameIn(ctx)
    const { target, type: method } = action

    if (winnerOf(state, ctx)) throw new GameError('The game is over')
    if (!holds(state, playerId)) {
      throw new GameError(state.playerIds.includes(playerId) ? "You're out" : 'You joined after this game started')
    }
    if (target === playerId) throw new GameError("That's your own code")
    if (!ctx.players.some((p) => p.id === target)) {
      // The party has no name for someone who left it any more.
      throw new GameError(state.playerIds.includes(target) ? 'That player left the party' : "That code isn't from this party")
    }
    if (!holds(state, target)) {
      throw new GameError(
        state.playerIds.includes(target) ? `${name(target)} is already out` : `${name(target)} isn't in this game`,
      )
    }

    const { [target]: targetTask, ...stillIn } = state.tasks
    const next: EliminationState =
      method === 'tag'
        ? {
            // The tagger's task is spent; they take over the task of the player they got.
            ...state,
            tasks: { ...stillIn, [playerId]: targetTask },
            knockouts: [...state.knockouts, { by: playerId, target, method, task: state.tasks[playerId], at: ctx.now }],
          }
        : {
            // The catcher keeps their task; the caught player's task leaves the game with them.
            ...state,
            tasks: stillIn,
            knockouts: [...state.knockouts, { by: playerId, target, method, task: targetTask, at: ctx.now }],
          }

    // Tasks can repeat when there are more players than tasks, so only reveal
    // one when nobody still holds it. Only in room-wide announcements: the
    // personal ones go to one phone, but the feed itself is readable by anyone.
    const used = next.knockouts[next.knockouts.length - 1].task
    const safe = !Object.values(next.tasks).includes(used)
    const profile = profileOf(ctx, playerId)
    if (method === 'tag') {
      ctx.updateProfile(playerId, { tags: (profile.tags ?? 0) + 1 })
      ctx.announce(`${name(playerId)} got ${name(target)}`, {
        detail: safe ? `“${used}”` : undefined,
        icon: 'sword',
        tone: 'pink',
        sound: 'slash',
      })
      ctx.announce(`${name(target)} is out!`, {
        detail: 'Their task is yours now.',
        to: [playerId],
        icon: 'sword',
        tone: 'pink',
        sound: 'coin',
      })
      ctx.announce("You're out!", {
        detail: `${name(playerId)} got you`,
        to: [target],
        icon: 'skull',
        tone: 'red',
        sound: 'sad',
      })
    } else {
      ctx.updateProfile(playerId, { catches: (profile.catches ?? 0) + 1 })
      ctx.announce(`${name(playerId)} caught ${name(target)}`, {
        detail: safe ? `Trying “${used}”` : 'Caught in the act',
        icon: 'detective',
        tone: 'teal',
        sound: 'gotcha',
      })
      ctx.announce(`You caught ${name(target)}!`, {
        detail: 'You keep your task.',
        to: [playerId],
        icon: 'detective',
        tone: 'teal',
        sound: 'coin',
      })
      ctx.announce("You're out!", {
        detail: `${name(playerId)} caught you trying your task`,
        to: [target],
        icon: 'skull',
        tone: 'red',
        sound: 'sad',
      })
    }

    // The deciding knockout announces the winner; the same save finishes the game (isFinished).
    const winner = winnerOf(next, ctx)
    if (winner) crown(next, winner, ctx)
    return next
  }

  /**
   * The host removed someone (or they moved away): their task leaves the game
   * with them. If that leaves one standing, they win, as after a knockout.
   */
  onPlayerLeave(state: EliminationState, playerId: PlayerId, ctx: GameContext<EliminationConfig>): EliminationState {
    if (!holds(state, playerId)) return state
    const next: EliminationState = {
      ...state,
      tasks: Object.fromEntries(Object.entries(state.tasks).filter(([id]) => id !== playerId)),
    }
    // When several leave at once, this runs once per leaver, and ctx.players
    // already lacks all of them: crown only once the last of them is gone, when
    // every task left is held by someone still here and exactly one is left.
    const holders = Object.keys(next.tasks)
    if (holders.length === 1 && ctx.players.some((p) => p.id === holders[0]) && next.playerIds.length > 1) {
      crown(next, holders[0], ctx)
    }
    return next
  }

  isFinished(state: EliminationState, info: GameInfo<EliminationConfig>): boolean {
    return winnerOf(state, info) !== null
  }

  /** The last one standing. Nobody when the host ended it before that. */
  winners(state: EliminationState, info: GameInfo<EliminationConfig>): PlayerId[] {
    const winner = winnerOf(state, info)
    return winner ? [winner] : []
  }

  /** The winning knockout (or removal) already announced the result. When the host ends it early, say how it stood. */
  onEnd(state: EliminationState, ctx: GameContext<EliminationConfig>, by: 'game' | 'host'): EliminationState {
    if (by === 'host' && !winnerOf(state, ctx)) {
      const left = standing(state, ctx).length
      ctx.announce('Last one standing is over', {
        detail: left === 0 ? 'Nobody is left standing' : `${left} still standing`,
        icon: 'trophy',
        sound: 'gong',
      })
    }
    return state
  }

  scores(state: EliminationState, info: GameInfo<EliminationConfig>): Scores {
    const scores: Scores = {}
    for (const knockout of state.knockouts) {
      const points = knockout.method === 'catch' ? info.config.pointsPerCatch : info.config.pointsPerTag
      scores[knockout.by] = (scores[knockout.by] ?? 0) + points
    }
    return scores
  }

  publicState(state: EliminationState, info: GameInfo<EliminationConfig>): EliminationPublicState {
    const live = new Set(Object.values(state.tasks))
    const knockoutCounts: Record<PlayerId, number> = {}
    for (const knockout of state.knockouts) knockoutCounts[knockout.by] = (knockoutCounts[knockout.by] ?? 0) + 1
    // In deal order: jsonb reorders object keys, so Object.keys(state.tasks) isn't stable.
    const alive = standing(state, info)
    const standingNow = new Set(alive)
    return {
      alive,
      out: state.playerIds.filter((id) => !standingNow.has(id)),
      winner: winnerOf(state, info),
      outBy: Object.fromEntries(state.knockouts.map((k) => [k.target, { by: k.by, method: k.method }])),
      knockoutCounts,
      feed: state.knockouts
        .slice(-10)
        .reverse()
        .map((k) => ({ ...k, task: live.has(k.task) ? null : k.task })),
    }
  }

  playerView(state: EliminationState, playerId: PlayerId, info: GameInfo<EliminationConfig>): EliminationPlayerView {
    if (!state.playerIds.includes(playerId)) return { status: 'spectator' }
    const knockouts = state.knockouts.filter((k) => k.by === playerId).length
    if (winnerOf(state, info) === playerId) return { status: 'winner', knockouts }
    if (holds(state, playerId)) return { status: 'alive', task: state.tasks[playerId], knockouts }
    const out = state.knockouts.find((k) => k.target === playerId)
    return { status: 'out', by: out?.by ?? '', method: out?.method ?? 'tag', task: out?.task ?? '', knockouts }
  }

  /**
   * The round's story for the recap, from its final state. Only what the room
   * saw: the winner, knockout counts, who went first, and spent tasks (a task
   * someone still held at the end was never shown, so it stays out).
   */
  recap(round: RecapRound<EliminationState, EliminationConfig>): Highlight[] {
    if (!round.finished || !isState(round.state)) return []
    const { state } = round
    const name = (id: PlayerId) => round.players.find((p) => p.id === id)?.name ?? 'Someone'
    const highlights: Highlight[] = []

    const counts = new Map<PlayerId, number>()
    for (const k of state.knockouts) counts.set(k.by, (counts.get(k.by) ?? 0) + 1)

    const winner = round.winners.length === 1 && holds(state, round.winners[0]) ? round.winners[0] : null
    const holders = state.playerIds.filter((id) => holds(state, id))
    if (winner) {
      highlights.push({
        title: `${name(winner)} was the last one standing`,
        detail: knockoutsText(counts.get(winner) ?? 0),
        players: [winner],
        icon: 'crown',
        tone: 'gold',
        weight: 'headline',
      })
    } else if (holders.length > 1) {
      highlights.push({
        title: `${holders.length} still standing when it ended`,
        detail: listNames(holders.map(name)),
        players: holders,
        icon: 'trophy',
        tone: 'gold',
        weight: 'highlight',
      })
    }

    // Map order is the order of each hunter's first knockout, and the sort is stable: ties keep it.
    const ranked = [...counts].sort((a, b) => b[1] - a[1])
    const top = ranked[0]?.[1] ?? 0
    if (top > 0) {
      const hunters = ranked.filter(([, n]) => n === top).map(([id]) => id)
      highlights.push({
        title: hunters.length === 1 ? `Top hunter: ${name(hunters[0])}` : `Top hunters: ${listNames(hunters.map(name))}`,
        detail: hunters.length === 1 ? knockoutsText(top) : `${knockoutsText(top)} each`,
        players: hunters,
        icon: 'sword',
        tone: 'pink',
        weight: 'highlight',
      })
    }

    const first = state.knockouts[0]
    if (first) {
      highlights.push({
        title: `First out: ${name(first.target)}`,
        detail: `${name(first.by)} ${first.method === 'catch' ? 'caught' : 'got'} them ${minutesIn(first.at - round.startedAt)}`,
        players: [first.target, first.by],
        at: first.at,
        icon: 'skull',
        tone: 'red',
        weight: 'line',
      })
    }

    const held = new Set(Object.values(state.tasks))
    const byTask = new Map<string, number>()
    for (const k of state.knockouts) if (!held.has(k.task)) byTask.set(k.task, (byTask.get(k.task) ?? 0) + 1)
    const [deadliest] = [...byTask].sort((a, b) => b[1] - a[1])
    if (deadliest && deadliest[1] > 1) {
      highlights.push({
        title: 'Deadliest task',
        detail: `“${deadliest[0]}” knocked out ${deadliest[1]} players`,
        icon: 'target',
        tone: 'violet',
        weight: 'line',
      })
    }
    return highlights
  }
}

/** Whether the player still has a task (own keys only: a player id is never "constructor"). */
function holds(state: EliminationState, playerId: PlayerId): boolean {
  return Object.hasOwn(state.tasks, playerId)
}

/** Ends a round: the winner's room-wide banner (also over another game on the TV), their own moment, and the win. */
function crown(state: EliminationState, winner: PlayerId, ctx: GameContext<EliminationConfig>) {
  ctx.updateProfile(winner, { wins: (profileOf(ctx, winner).wins ?? 0) + 1 })
  const detail = knockoutsText(state.knockouts.filter((k) => k.by === winner).length)
  ctx.announce(`${nameIn(ctx)(winner)} is the last one standing!`, {
    detail,
    icon: 'crown',
    sound: 'fanfare',
    interrupt: true,
  })
  ctx.announce("You're the last one standing!", { detail, to: [winner], icon: 'crown', sound: 'fanfare' })
}

function nameIn(ctx: GameContext<EliminationConfig>) {
  return (id: PlayerId) => ctx.players.find((p) => p.id === id)?.name ?? 'Someone'
}

function profileOf(ctx: GameContext<EliminationConfig>, playerId: PlayerId): EliminationProfile {
  return (ctx.players.find((p) => p.id === playerId)?.profile.elimination ?? {}) as EliminationProfile
}

function cleanTasks(tasks: unknown): string[] {
  return Array.isArray(tasks) ? tasks.map((task) => String(task).trim()).filter(Boolean) : []
}

function wholePoints(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_POINTS) {
    throw new GameError(`${label} must be a whole number from 0 to ${MAX_POINTS}`)
  }
  return value
}

/** A round state as the recap gets it back from the log (it can't trust it blindly). */
function isState(value: unknown): value is EliminationState {
  const state = value as EliminationState | null
  return (
    typeof state?.tasks === 'object' &&
    state.tasks !== null &&
    Array.isArray(state.playerIds) &&
    Array.isArray(state.knockouts)
  )
}

export function knockoutsText(count: number): string {
  return `${count} knockout${count === 1 ? '' : 's'}`
}

function minutesIn(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  return minutes < 1 ? 'in the first minute' : `${minutes} minute${minutes === 1 ? '' : 's'} in`
}

/** "Ana", "Ana and Bo", "Ana, Bo and Cy", "Ana, Bo, Cy and 4 more". */
export function listNames(names: readonly string[], max = 3): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length > max) return `${names.slice(0, max).join(', ')} and ${names.length - max} more`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
