import { shuffle } from '../core/context'
import { Game, GameError, type GameContext, type GameInfo, type PlayerId, type Scores } from '../core/Game'

export type EliminationConfig = {
  /** Dealt one per player; repeated when there are more players than tasks. */
  tasks: string[]
  pointsPerTag: number
  pointsPerCatch: number
}

/**
 * How someone was knocked out:
 * - tag: the player got the target to do their task (and takes over the target's task)
 * - catch: the target was caught trying their own task on the player (whose task stays the same)
 */
export type Method = 'tag' | 'catch'

type Knockout = {
  by: PlayerId
  target: PlayerId
  method: Method
  /** The task involved, which is out of play now: the tagger's spent task, or the caught player's exposed one. */
  task: string
  at: number
}

export type EliminationState = {
  /** The current task of every player still in. Players who are out have none. */
  tasks: Record<PlayerId, string>
  /** Everyone who was dealt in. */
  playerIds: PlayerId[]
  knockouts: Knockout[]
}

export type EliminationAction = { type: Method; target: PlayerId }

/** A knockout as everyone may see it: the task is hidden while someone else still holds the same one. */
export type PublicKnockout = Omit<Knockout, 'task'> & { task: string | null }

export type EliminationPublicState = {
  alive: PlayerId[]
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

/**
 * Everyone gets a secret task and one life. Knock someone out by getting them
 * to do your task (you take over theirs), or by catching them trying their
 * task on you (you keep yours). Scan their code either way. The last one
 * standing wins.
 */
export class EliminationGame extends Game<
  EliminationState,
  EliminationAction,
  EliminationPublicState,
  EliminationPlayerView,
  EliminationConfig
> {
  readonly type = 'elimination'
  readonly defaultConfig: EliminationConfig = { tasks: DEFAULT_TASKS, pointsPerTag: 1, pointsPerCatch: 1 }

  setup(ctx: GameContext<EliminationConfig>): EliminationState {
    const tasks = Array.isArray(ctx.config.tasks)
      ? ctx.config.tasks.map((task) => String(task).trim()).filter(Boolean)
      : []
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
    if ((action?.type === 'tag' || action?.type === 'catch') && typeof action.target === 'string') {
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
    const name = (id: PlayerId) => ctx.players.find((p) => p.id === id)?.name ?? 'Someone'
    const { target, type: method } = action

    if (winnerOf(state)) throw new GameError('The game is over')
    if (!(playerId in state.tasks)) {
      throw new GameError(state.playerIds.includes(playerId) ? "You're out" : 'You joined after this game started')
    }
    if (target === playerId) throw new GameError("That's your own code")
    if (!(target in state.tasks)) {
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

    const winner = winnerOf(next)
    if (winner) {
      ctx.updateProfile(winner, { wins: (profileOf(ctx, winner).wins ?? 0) + 1 })
      const count = next.knockouts.filter((k) => k.by === winner).length
      const detail = `${count} knockout${count === 1 ? '' : 's'}`
      ctx.announce(`${name(winner)} is the last one standing!`, { detail, icon: 'crown', sound: 'fanfare' })
      ctx.announce("You're the last one standing!", { detail, to: [winner], icon: 'crown', sound: 'fanfare' })
    }
    return next
  }

  /** When the host ends the game early, say how it stood. */
  onEnd(state: EliminationState, ctx: GameContext<EliminationConfig>): EliminationState {
    if (!winnerOf(state)) {
      const left = Object.keys(state.tasks).length
      ctx.announce('Last one standing is over', { detail: `${left} still standing`, icon: 'trophy', sound: 'gong' })
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

  publicState(state: EliminationState): EliminationPublicState {
    const live = new Set(Object.values(state.tasks))
    const knockoutCounts: Record<PlayerId, number> = {}
    for (const knockout of state.knockouts) knockoutCounts[knockout.by] = (knockoutCounts[knockout.by] ?? 0) + 1
    return {
      alive: Object.keys(state.tasks),
      out: state.playerIds.filter((id) => !(id in state.tasks)),
      winner: winnerOf(state),
      outBy: Object.fromEntries(state.knockouts.map((k) => [k.target, { by: k.by, method: k.method }])),
      knockoutCounts,
      feed: state.knockouts
        .slice(-10)
        .reverse()
        .map((k) => ({ ...k, task: live.has(k.task) ? null : k.task })),
    }
  }

  playerView(state: EliminationState, playerId: PlayerId): EliminationPlayerView {
    if (!state.playerIds.includes(playerId)) return { status: 'spectator' }
    const knockouts = state.knockouts.filter((k) => k.by === playerId).length
    if (winnerOf(state) === playerId) return { status: 'winner', knockouts }
    if (playerId in state.tasks) return { status: 'alive', task: state.tasks[playerId], knockouts }
    const out = state.knockouts.find((k) => k.target === playerId)
    return { status: 'out', by: out?.by ?? '', method: out?.method ?? 'tag', task: out?.task ?? '', knockouts }
  }
}

function winnerOf(state: EliminationState): PlayerId | null {
  const alive = Object.keys(state.tasks)
  return alive.length === 1 && state.playerIds.length > 1 ? alive[0] : null
}

function profileOf(ctx: GameContext<EliminationConfig>, playerId: PlayerId): EliminationProfile {
  return (ctx.players.find((p) => p.id === playerId)?.profile.elimination ?? {}) as EliminationProfile
}
