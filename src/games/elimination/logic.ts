import { shuffle } from '../core/context'
import {
  Game,
  GameError,
  type GameContext,
  type GameInfo,
  type GamePlayer,
  type Highlight,
  type PlayerId,
  type RecapRound,
  type Scores,
} from '../core/Game'

export type EliminationConfig = {
  /** Shuffled into a deck at the start and dealt one per player, latecomers too; a task repeats only once the deck is used up. */
  tasks: string[]
  pointsPerTag: number
  pointsPerCatch: number
  /** Dealing in closes by itself this long after the start. 0 keeps it open until the host closes it. */
  dealInMinutes: number
}

/** The settings' limits, checked once at start (parseConfig) and shown in the editor. */
export const MAX_TASKS = 200
export const MAX_TASK_LENGTH = 200
export const MAX_POINTS = 100
export const MAX_DEAL_IN_MINUTES = 600
/** 18:45 to 20:30 on the night: latecomers are dealt in until dinner is over. */
export const DEFAULT_DEAL_IN_MINUTES = 105

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
  /**
   * Dealt in, then gone from the party: removed, or the host freed the name.
   * Their knockouts no longer score, and whoever takes a freed name watches
   * this round (docs/guest-list.md, 9.4). Missing in rounds saved before it.
   */
  left?: PlayerId[]
  /**
   * The settings' tasks, each text once, shuffled at the start. Cards are
   * dealt from the top (`dealt` counts them), latecomers included, so nobody
   * gets a task someone else holds while the deck has cards left. Missing in
   * rounds saved before it: the first latecomer shuffles one from the settings.
   */
  deck?: string[]
  /** How many cards have been taken: from the top of `deck` while it lasts (deck[dealt] is next), then repeats. */
  dealt?: number
  /** Whether a guest who joins now is dealt in: on at the start; the host's switch sets it. Missing (old rounds): on. */
  dealIn?: boolean
  /** When dealing in closes by itself (ms), or null: open until the host closes it. */
  dealInUntil?: number | null
  /** Who was dealt in after the start, in the order they got their task. */
  late?: PlayerId[]
}

/** A move from a phone: a knockout, or `join`, which a guest's phone sends to be dealt in. */
export type EliminationAction = { type: Method; target: PlayerId } | { type: 'join' }

/** The host's switch: deal in latecomers, or stop. Naming the state it wants makes a double tap a skip. */
export type EliminationHostAction = { type: 'dealIn'; open: boolean }

/** A knockout as everyone may see it: the task is hidden while someone else still holds the same one. */
export type PublicKnockout = Omit<Knockout, 'task'> & { task: string | null }

export type EliminationPublicState = {
  /** Still standing, in deal order. */
  alive: PlayerId[]
  /** Dealt in and knocked out; never someone who left the party (state.left). */
  out: PlayerId[]
  winner: PlayerId | null
  /** Who knocked each player out, and how. */
  outBy: Record<PlayerId, { by: PlayerId; method: Method }>
  /** Knockouts per player, for the top hunters. */
  knockoutCounts: Record<PlayerId, number>
  /** Newest first. */
  feed: PublicKnockout[]
  /** Whether a guest who joins now gets a task (as of this save). Missing in public states saved before it. */
  dealIn?: boolean
  /** When dealing in closes by itself, or null when only the host closes it. */
  dealInUntil?: number | null
}

export type EliminationPlayerView =
  /** `late`: dealt in after the start. */
  | { status: 'alive'; task: string; knockouts: number; late?: true }
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
 * Whether a guest who joins at `now` is dealt in: the host's switch is on
 * (old rounds have none: on) and the time it closes by itself, if any, hasn't
 * come. A time check, so it closes on the minute even with no save then.
 */
export function dealingIn(state: Pick<EliminationState, 'dealIn' | 'dealInUntil'>, now: number): boolean {
  return state.dealIn !== false && (state.dealInUntil == null || now < state.dealInUntil)
}

/** The same from the public state, for phones: only a save that says so opens it. */
export function dealingInNow(publicState: Partial<EliminationPublicState> | null | undefined, now: number): boolean {
  return publicState?.dealIn === true && (publicState.dealInUntil == null || now < publicState.dealInUntil)
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
  EliminationConfig,
  EliminationHostAction
> {
  readonly type = 'elimination'
  readonly presentation = 'background' as const
  readonly defaultConfig: EliminationConfig = {
    tasks: DEFAULT_TASKS,
    pointsPerTag: 1,
    pointsPerCatch: 1,
    dealInMinutes: DEFAULT_DEAL_IN_MINUTES,
  }

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
      dealInMinutes: dealInMinutes(input.dealInMinutes),
    }
  }

  setup(ctx: GameContext<EliminationConfig>): EliminationState {
    // parseConfig already cleaned them at start; this keeps direct calls safe too.
    const tasks = cleanTasks(ctx.config.tasks)
    if (ctx.players.length < 2) throw new GameError('You need at least 2 players to start')
    if (tasks.length === 0) throw new GameError('Add at least one task in the settings')

    ctx.announce('Last one standing has started', {
      detail: `${ctx.players.length} players, one life each`,
      icon: 'megaphone',
      sound: 'gong',
    })
    // A round saved without the setting (direct calls) deals in for the default time.
    const minutes = ctx.config.dealInMinutes ?? DEFAULT_DEAL_IN_MINUTES
    let state: EliminationState = {
      tasks: {},
      playerIds: [],
      knockouts: [],
      deck: shuffle(unique(tasks), ctx.random),
      dealt: 0,
      dealIn: true,
      dealInUntil: minutes > 0 ? ctx.now + minutes * 60_000 : null,
    }
    for (const player of ctx.players) {
      const card = nextCard(state, tasks, ctx.random)!
      state = { ...state, ...card.deck, tasks: { ...state.tasks, [player.id]: card.task }, playerIds: [...state.playerIds, player.id] }
    }
    return state
  }

  parseAction(input: unknown): EliminationAction {
    const action = input as { type?: unknown; target?: unknown } | null
    if (action?.type === 'join') return { type: 'join' }
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
    // A latecomer's phone asking to be dealt in. Never refused: when it can't
    // be done (closed, dealt in before, a freed name, over), the state comes
    // back unchanged and the engine answers it as skipped.
    if (action.type === 'join') return dealInto(state, playerId, ctx)
    const name = nameIn(ctx)
    const { target, type: method } = action

    if (winnerOf(state, ctx)) throw new GameError('The game is over')
    if (!holds(state, playerId)) {
      throw new GameError(dealtIn(state, playerId) ? "You're out" : 'You joined after this game started')
    }
    if (target === playerId) throw new GameError("That's your own code")
    if (!ctx.players.some((p) => p.id === target)) {
      // The party has no name for someone who left it any more.
      throw new GameError(state.playerIds.includes(target) ? 'That player left the party' : "That code isn't from this party")
    }
    if (!holds(state, target)) {
      throw new GameError(
        dealtIn(state, target) ? `${name(target)} is already out` : `${name(target)} isn't in this game`,
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

  parseHostAction(input: unknown): EliminationHostAction {
    const action = input as { type?: unknown; open?: unknown } | null
    if (action?.type === 'dealIn' && typeof action.open === 'boolean') return { type: 'dealIn', open: action.open }
    throw new GameError('Unknown host action')
  }

  /**
   * The host's switch for latecomers. Open: on until the host closes it (the
   * time it would close by itself is gone), and everyone here who was never
   * dealt in gets a task now. Close: a guest who joins from now on watches.
   * One that asks for what already is (a double tap) changes nothing.
   */
  handleHostAction(state: EliminationState, action: EliminationHostAction, ctx: GameContext<EliminationConfig>): EliminationState {
    if (!action.open) return dealingIn(state, ctx.now) ? { ...state, dealIn: false, dealInUntil: null } : state
    if (state.dealIn !== false && state.dealInUntil == null) return state
    let next: EliminationState = { ...state, dealIn: true, dealInUntil: null }
    for (const player of ctx.players) next = dealInto(next, player.id, ctx)
    return next
  }

  /**
   * A guest joined the party, also by taking a name from the guest list: while
   * dealing in is open, they get the next card and one life, like everyone.
   */
  onPlayerJoin(state: EliminationState, player: GamePlayer, ctx: GameContext<EliminationConfig>): EliminationState {
    return dealInto(state, player.id, ctx)
  }

  /**
   * The host removed someone (or they moved away): their task leaves the game
   * with them. If that leaves one standing, they win, as after a knockout.
   */
  onPlayerLeave(state: EliminationState, playerId: PlayerId, ctx: GameContext<EliminationConfig>): EliminationState {
    if (!state.playerIds.includes(playerId)) return state
    // Out or not: the id stops counting, so a guest who takes a freed name starts with nothing from this round.
    const marked = hasLeft(state, playerId) ? state : { ...state, left: [...(state.left ?? []), playerId] }
    if (!holds(marked, playerId)) return marked
    const next: EliminationState = {
      ...marked,
      tasks: Object.fromEntries(Object.entries(marked.tasks).filter(([id]) => id !== playerId)),
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
    for (const knockout of counted(state)) {
      const points = knockout.method === 'catch' ? info.config.pointsPerCatch : info.config.pointsPerTag
      scores[knockout.by] = (scores[knockout.by] ?? 0) + points
    }
    return scores
  }

  publicState(state: EliminationState, info: GameInfo<EliminationConfig>): EliminationPublicState {
    const live = new Set(Object.values(state.tasks))
    const knockoutCounts: Record<PlayerId, number> = {}
    for (const knockout of counted(state)) knockoutCounts[knockout.by] = (knockoutCounts[knockout.by] ?? 0) + 1
    // In deal order: jsonb reorders object keys, so Object.keys(state.tasks) isn't stable.
    const alive = standing(state, info)
    const standingNow = new Set(alive)
    return {
      alive,
      out: state.playerIds.filter((id) => !standingNow.has(id) && !hasLeft(state, id)),
      winner: winnerOf(state, info),
      outBy: Object.fromEntries(
        state.knockouts.filter((k) => !hasLeft(state, k.target)).map((k) => [k.target, { by: k.by, method: k.method }]),
      ),
      knockoutCounts,
      feed: state.knockouts
        .slice(-10)
        .reverse()
        .map((k) => ({ ...k, task: live.has(k.task) ? null : k.task })),
      dealIn: dealingIn(state, info.now),
      dealInUntil: state.dealInUntil ?? null,
    }
  }

  playerView(state: EliminationState, playerId: PlayerId, info: GameInfo<EliminationConfig>): EliminationPlayerView {
    if (!dealtIn(state, playerId)) return { status: 'spectator' }
    const knockouts = state.knockouts.filter((k) => k.by === playerId).length
    if (winnerOf(state, info) === playerId) return { status: 'winner', knockouts }
    if (holds(state, playerId)) {
      const late = Array.isArray(state.late) && state.late.includes(playerId)
      return { status: 'alive', task: state.tasks[playerId], knockouts, ...(late ? { late: true as const } : {}) }
    }
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
    for (const k of counted(state)) counts.set(k.by, (counts.get(k.by) ?? 0) + 1)

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

/**
 * Deals the guest in, if they may be: here, never dealt in this round (so a
 * freed name taken again, or anyone in `left`, watches: docs/guest-list.md,
 * 9.4), dealing in open, and no winner yet (the winner check, and a crown
 * already announced in this save, both count on nobody joining after it).
 * They get the next card and one life; their phone hears it.
 */
function dealInto(state: EliminationState, playerId: PlayerId, ctx: GameContext<EliminationConfig>): EliminationState {
  if (state.playerIds.includes(playerId) || !ctx.players.some((p) => p.id === playerId)) return state
  if (!dealingIn(state, ctx.now) || winnerOf(state, ctx)) return state
  const card = nextCard(state, cleanTasks(ctx.config.tasks), ctx.random)
  if (!card) return state
  ctx.announce("You're in Last one standing", {
    detail: 'Your secret task is on your phone',
    to: [playerId],
    icon: 'megaphone',
    sound: 'chime',
  })
  return {
    ...state,
    ...card.deck,
    tasks: { ...state.tasks, [playerId]: card.task },
    playerIds: [...state.playerIds, playerId],
    late: [...(state.late ?? []), playerId],
  }
}

/**
 * The next card, and the deck after it. The top card while the deck has any
 * (none of them is held: every held task was dealt from it). Once it is used
 * up, a task repeats: first one nobody holds that no knockout showed (it left
 * with a guest), then one nobody holds (a knockout showed it), and only when
 * every one is held, the one held by the fewest, first in deck order. A round
 * saved before the deck shuffles one from the settings' tasks with every card
 * counted as dealt, so a latecomer gets a task nobody holds. Null with no tasks.
 */
function nextCard(
  state: EliminationState,
  tasks: readonly string[],
  random: () => number,
): { task: string; deck: { deck: string[]; dealt: number } } | null {
  const deck = state.deck ?? shuffle(unique(tasks), random)
  const dealt = state.deck ? (state.dealt ?? 0) : deck.length
  if (deck.length === 0) return null
  if (dealt < deck.length) return { task: deck[dealt], deck: { deck, dealt: dealt + 1 } }
  const held = new Map<string, number>()
  for (const task of Object.values(state.tasks)) held.set(task, (held.get(task) ?? 0) + 1)
  const shown = new Set(state.knockouts.map((k) => k.task))
  const task =
    deck.find((t) => !held.has(t) && !shown.has(t)) ??
    deck.find((t) => !held.has(t)) ??
    deck.reduce((fewest, t) => ((held.get(t) ?? 0) < (held.get(fewest) ?? 0) ? t : fewest))
  return { task, deck: { deck, dealt: dealt + 1 } }
}

/** Each text once, in its first place. */
function unique(tasks: readonly string[]): string[] {
  return [...new Set(tasks)]
}

/** Whether the player was dealt in and then left the party (removed, or their name freed). */
function hasLeft(state: EliminationState, playerId: PlayerId): boolean {
  return Array.isArray(state.left) && state.left.includes(playerId)
}

/** Dealt in and still the same guest: not someone who left, whose freed name another guest may have taken since. */
function dealtIn(state: EliminationState, playerId: PlayerId): boolean {
  return state.playerIds.includes(playerId) && !hasLeft(state, playerId)
}

/** The knockouts that still score: none by someone who left, so a freed name's next guest doesn't inherit them. */
function counted(state: EliminationState): Knockout[] {
  return state.knockouts.filter((k) => !hasLeft(state, k.by))
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

/** Minutes from 0 to MAX_DEAL_IN_MINUTES; settings saved before it get the default. */
function dealInMinutes(value: unknown): number {
  if (value === undefined) return DEFAULT_DEAL_IN_MINUTES
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_DEAL_IN_MINUTES) {
    throw new GameError(`Dealing in must be a whole number of minutes from 0 to ${MAX_DEAL_IN_MINUTES}`)
  }
  return value
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
