// Participant fusion (docs/engine-v2.md, 8.4). Before the party an image model
// fuses two guests' faces into one portrait per print; the prints hang on the
// wall, numbered. Guests vote on their phones for who is in each print, the
// host locks voting and then reveals the prints one by one on the TV.
//
// Votes are prompts, never actions: one prompt per picture (p1 to pN), all open
// from the start, answered straight to the database and changeable until the
// host locks voting. The lock closes them all, so the next request sees every
// vote in info.answers, and each reveal scores its picture from them.
//
// Who is in each picture (the key) is the secret. It lives in the host-only
// settings and the state, and reaches publicState only once that picture is
// revealed. Relative imports only: the Netlify function bundles this file.
import {
  Game,
  GameError,
  type Answer,
  type GameContext,
  type GameInfo,
  type GamePlayer,
  type Highlight,
  type PlayerId,
  type PromptSpec,
  type RecapRound,
  type Scores,
} from '../core/Game'

export type FusionPicture = {
  /** What the print says, e.g. "#3". Blank in the settings means "#n". */
  label: string
  /** A game-media path (the full image; its thumbnail sits beside it). */
  image?: string
  /** Who is fused in it. Optional: the host can also set it on the night (setKey). */
  people?: [PlayerId, PlayerId]
}

export type FusionConfig = {
  pictures: FusionPicture[]
  /** Points for each of the two people a guest got right. */
  pointsPerPerson: number
  /** Extra points for getting both people of a picture right. */
  bonusForBoth: number
}

export type FusionPhase = 'voting' | 'locked' | 'done'

/** One revealed picture's votes. Only voters who aren't in the picture count. */
export type FusionResult = {
  both: number
  one: number
  none: number
  voters: number
  /** How many of the two each voter got right. */
  hits: Record<PlayerId, number>
}

export type FusionState = {
  phase: FusionPhase
  /** Who is in each picture, by picture number. Secret until that picture is revealed. */
  key: Record<string, [PlayerId, PlayerId]>
  /** The names of the people in the key, for anyone who leaves the party before their picture is revealed. */
  names: Record<PlayerId, string>
  /** Picture numbers, in reveal order. */
  revealed: number[]
  results: Record<string, FusionResult>
  totals: Record<PlayerId, number>
  lastReveal: { n: number; at: number } | null
}

export type FusionHostAction =
  | { type: 'setKey'; n: number; people: [PlayerId, PlayerId] }
  | { type: 'lock' }
  | { type: 'reveal'; n: number }
  | { type: 'finish' }

export type FusionPublicPicture = {
  n: number
  /** Its prompt key: what phones answer. */
  key: string
  label: string
  image: string | null
  revealed: {
    people: [PlayerId, PlayerId]
    /** The people's names when it was revealed, for anyone who has left since. */
    names?: [string, string]
    both: number
    one: number
    none: number
    voters: number
  } | null
}

export type FusionPublicState = {
  phase: FusionPhase
  pictures: FusionPublicPicture[]
  /** The top 5 face detectives, most points first. */
  top: { playerId: PlayerId; points: number }[]
  lastReveal: { n: number; at: number } | null
  /** The points rules, for the phones' explanations. */
  scoring?: { perPerson: number; bothBonus: number }
}

export type FusionPlayerView = {
  points: number
  /** For each revealed picture this player voted on (and isn't in): how many of the two they got right. */
  hits: Record<string, number>
}

/** What this game keeps on a player's profile. */
export type FusionProfile = { detective?: number }

export const MAX_PICTURES = 40
export const MAX_LABEL_LENGTH = 20
export const MAX_POINTS = 10

/** The prompt phones answer for picture n. */
export const pictureKey = (n: number) => `p${n}`
/** The label a picture gets when the settings leave it blank. */
export const defaultLabel = (n: number) => `#${n}`

/** Each picture's vote: two players, never yourself, changeable until voting is locked. */
export const VOTE_SPEC: PromptSpec = { kind: 'choice', options: 'players', min: 2, max: 2, exclude_self: true }

/** A game-media path as uploads make them: `<session>/<game>/<uuid>.jpg`, nothing that climbs or points elsewhere. */
const MEDIA_PATH = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\.jpg$/

/** The points one picture gives a voter who got `hits` of its two people. */
export function pointsFor(hits: number, scoring: { perPerson: number; bothBonus: number }): number {
  return hits * scoring.perPerson + (hits >= 2 ? scoring.bothBonus : 0)
}

/** "Ana", "Ana and Bo", "Ana, Bo and Cy", "Ana, Bo, Cy and 2 more". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
}

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

export class FusionGame extends Game<
  FusionState,
  never,
  FusionPublicState,
  FusionPlayerView,
  FusionConfig,
  FusionHostAction
> {
  readonly type = 'fusion'
  readonly presentation = 'background'
  readonly defaultConfig: FusionConfig = { pictures: [], pointsPerPerson: 1, bonusForBoth: 0 }

  parseConfig(input: Record<string, unknown>): FusionConfig {
    const raw = input.pictures
    if (!Array.isArray(raw) || raw.length === 0) throw new GameError('Add the pictures in the settings first')
    if (raw.length > MAX_PICTURES) throw new GameError(`Participant fusion takes at most ${MAX_PICTURES} pictures`)
    return {
      pictures: raw.map((item, i) => parsePicture(item, i + 1)),
      pointsPerPerson: wholePoints(input.pointsPerPerson, 'Points per right person'),
      bonusForBoth: wholePoints(input.bonusForBoth, 'The bonus for both'),
    }
  }

  setup(ctx: GameContext<FusionConfig>): FusionState {
    const { pictures } = ctx.config
    const key: FusionState['key'] = {}
    pictures.forEach((picture, i) => {
      if (!picture.people) return
      // Settings can be made before the night; someone in them may have left since.
      if (!picture.people.every((id) => ctx.players.some((p) => p.id === id))) {
        throw new GameError(`${picture.label} has someone who isn't in the party. Pick the people again in the settings.`)
      }
      key[i + 1] = [picture.people[0], picture.people[1]]
    })
    pictures.forEach((_, i) => ctx.openPrompt(pictureKey(i + 1), VOTE_SPEC))
    ctx.announce('Who is fused?', {
      detail: `${plural(pictures.length, 'picture')} on the wall. Vote on your phone.`,
      icon: 'detective',
      tone: 'violet',
      sound: 'gong',
    })
    return {
      phase: 'voting',
      key,
      names: namesOf(key, ctx.players, {}),
      revealed: [],
      results: {},
      totals: {},
      lastReveal: null,
    }
  }

  parseAction(): never {
    // Votes go straight to the database as prompts; this game takes no moves.
    throw new GameError('Vote by tapping a picture instead')
  }

  handleAction(state: FusionState): FusionState {
    return state
  }

  parseHostAction(input: unknown): FusionHostAction {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new GameError('Unknown host action')
    const action = input as Record<string, unknown>
    switch (action.type) {
      case 'lock':
        return { type: 'lock' }
      case 'finish':
        return { type: 'finish' }
      case 'reveal':
        return { type: 'reveal', n: pictureNumber(action.n) }
      case 'setKey': {
        const people = action.people
        if (!Array.isArray(people) || people.length !== 2 || !people.every(isPlayerId)) {
          throw new GameError('Pick the two people in the picture')
        }
        return { type: 'setKey', n: pictureNumber(action.n), people: [people[0], people[1]] }
      }
    }
    throw new GameError('Unknown host action')
  }

  // Every host action names its step (docs/engine-v2.md, 3.5): a picture number,
  // or a phase. One whose step has passed returns the state unchanged, which
  // the engine answers as skipped: a double tap on Lock or Reveal does nothing.
  handleHostAction(state: FusionState, action: FusionHostAction, ctx: GameContext<FusionConfig>): FusionState {
    switch (action.type) {
      case 'setKey':
        return this.setKey(state, action.n, action.people, ctx)
      case 'lock':
        return this.lock(state, ctx)
      case 'reveal':
        return this.reveal(state, action.n, ctx)
      case 'finish':
        return this.finish(state, ctx)
    }
  }

  isFinished(state: FusionState): boolean {
    return state.phase === 'done'
  }

  /** The top totals among players still in the party, all tied ones; nobody when nobody scored. */
  winners(state: FusionState, info: GameInfo<FusionConfig>): PlayerId[] {
    return leaders(state, info)
  }

  onEnd(state: FusionState, ctx: GameContext<FusionConfig>, by: 'game' | 'host'): FusionState {
    // The crowning announced the result already ('game'): stay quiet then.
    if (by === 'host') {
      const top = leaders(state, ctx)
      const names = top.map((id) => nameIn(ctx.players, state.names, id))
      ctx.announce('Participant fusion is over', {
        detail:
          top.length > 0
            ? `${listNames(names)} ${top.length > 1 ? 'shared' : 'had'} the sharpest eye with ${plural(state.totals[top[0]], 'point')}`
            : 'Nobody scored this time',
        icon: 'trophy',
        tone: 'violet',
        sound: 'gong',
      })
    }
    return state.phase === 'done' ? state : { ...state, phase: 'done' }
  }

  scores(state: FusionState): Scores {
    return { ...state.totals }
  }

  publicState(state: FusionState, info: GameInfo<FusionConfig>): FusionPublicState {
    return {
      phase: state.phase,
      pictures: info.config.pictures.map((picture, i) => {
        const n = i + 1
        const result = state.revealed.includes(n) ? state.results[n] : undefined
        const people = state.key[n]
        return {
          n,
          key: pictureKey(n),
          label: picture.label,
          image: picture.image ?? null,
          // Who is in it only once it is revealed: never a key before that.
          revealed:
            result && people
              ? {
                  people: [people[0], people[1]],
                  names: [nameIn(info.players, state.names, people[0]), nameIn(info.players, state.names, people[1])],
                  both: result.both,
                  one: result.one,
                  none: result.none,
                  voters: result.voters,
                }
              : null,
        }
      }),
      top: ranked(state, info).slice(0, 5),
      lastReveal: state.lastReveal,
      scoring: scoringOf(info.config),
    }
  }

  playerView(state: FusionState, playerId: PlayerId): FusionPlayerView {
    const hits: Record<string, number> = {}
    for (const n of state.revealed) {
      const got = state.results[n]?.hits[playerId]
      if (got !== undefined) hits[n] = got
    }
    return { points: state.totals[playerId] ?? 0, hits }
  }

  /** Revealed pictures only: a picture the host never revealed keeps its people secret. */
  recap(round: RecapRound<FusionState, FusionConfig>): Highlight[] {
    if (!round.finished || !round.state) return []
    const { state, config } = round
    const nameOf = (id: PlayerId) => round.players.find((p) => p.id === id)?.name ?? state.names?.[id] ?? 'A guest'
    const labelOf = (n: number) => config.pictures[n - 1]?.label ?? defaultLabel(n)
    const revealedAt = (n: number) =>
      round.log.find((row) => row.kind === 'game.record' && row.data.type === 'revealed' && row.data.n === n)?.at
    const highlights: Highlight[] = []

    if (round.winners.length > 0) {
      highlights.push({
        title: `Sharpest eye: ${listNames(round.winners.map(nameOf))}`,
        detail: plural(round.points[round.winners[0]] ?? state.totals[round.winners[0]] ?? 0, 'point'),
        players: [...round.winners],
        at: round.finishedAt ?? undefined,
        icon: 'crown',
        tone: 'gold',
        weight: 'headline',
      })
    }

    // The best disguise: the revealed picture the fewest voters saw through.
    let disguise: { n: number; result: FusionResult } | null = null
    for (const n of state.revealed) {
      const result = state.results[n]
      if (!result || result.voters === 0) continue
      if (!disguise || result.both / result.voters < disguise.result.both / disguise.result.voters) disguise = { n, result }
    }
    const people = disguise && state.key[disguise.n]
    if (disguise && people && disguise.result.both / disguise.result.voters < 0.5) {
      const { both, voters } = disguise.result
      const who = `${nameOf(people[0])} and ${nameOf(people[1])}`
      highlights.push({
        title: `Best disguise: ${labelOf(disguise.n)} fooled the room`,
        detail: both === 0 ? `Nobody saw ${who}` : `Only ${both} of ${voters} saw ${who}`,
        players: [...people],
        at: revealedAt(disguise.n),
        icon: 'detective',
        tone: 'violet',
        weight: 'highlight',
      })
    }

    // A perfect eye: both people right on every revealed picture they could score on (at least two).
    const perfect = round.players
      .map((p) => p.id)
      .filter((id) => {
        const scorable = state.revealed.filter((n) => !state.key[n]?.includes(id))
        return scorable.length >= 2 && scorable.every((n) => state.results[n]?.hits[id] === 2)
      })
    if (perfect.length > 0) {
      highlights.push({
        title: `Perfect eye: ${listNames(perfect.map(nameOf))}`,
        detail: 'Both people right on every revealed picture',
        players: perfect,
        icon: 'star',
        tone: 'violet',
        weight: 'highlight',
      })
    }
    return highlights
  }

  // Host actions -------------------------------------------------------------

  private setKey(state: FusionState, n: number, people: [PlayerId, PlayerId], ctx: GameContext<FusionConfig>): FusionState {
    const picture = pictureOf(ctx.config, n)
    if (state.revealed.includes(n)) throw new GameError(`${picture.label} is already revealed`)
    const [a, b] = people
    if (a === b) throw new GameError('Pick two different people')
    if (!ctx.players.some((p) => p.id === a) || !ctx.players.some((p) => p.id === b)) {
      throw new GameError('Pick two people who are in the party')
    }
    const current = state.key[n]
    if (current && current.includes(a) && current.includes(b)) return state
    const key = { ...state.key, [n]: [a, b] as [PlayerId, PlayerId] }
    return { ...state, key, names: namesOf(key, ctx.players, state.names) }
  }

  private lock(state: FusionState, ctx: GameContext<FusionConfig>): FusionState {
    if (state.phase !== 'voting') return state
    ctx.config.pictures.forEach((_, i) => {
      const key = pictureKey(i + 1)
      if (key in ctx.prompts) ctx.closePrompt(key)
    })
    ctx.announce('Voting is closed', {
      detail: 'The reveal is coming up on the TV',
      icon: 'megaphone',
      tone: 'violet',
      sound: 'ticktock',
    })
    return { ...state, phase: 'locked' }
  }

  private reveal(state: FusionState, n: number, ctx: GameContext<FusionConfig>): FusionState {
    if (state.phase === 'voting') throw new GameError('Lock voting first')
    if (state.phase === 'done') return state
    const picture = pictureOf(ctx.config, n)
    // A double tap on Reveal next: this one is out already.
    if (state.revealed.includes(n)) return state
    const people = state.key[n]
    if (!people) throw new GameError(`Set who is in ${picture.label} first`)
    const key = pictureKey(n)
    const votes = ctx.answers[key]
    if (!votes) throw new GameError(`The votes for ${picture.label} are still open`)

    const result = scoreVotes(votes, people)
    const scoring = scoringOf(ctx.config)
    const totals = { ...state.totals }
    for (const [id, hits] of Object.entries(result.hits)) {
      const points = pointsFor(hits, scoring)
      if (points > 0) totals[id] = (totals[id] ?? 0) + points
    }
    ctx.revealPrompt(key)
    const names = people.map((id) => nameIn(ctx.players, state.names, id))
    ctx.announce(`${picture.label} was ${names[0]} and ${names[1]}!`, {
      detail: result.voters === 0 ? 'Nobody voted on this one' : `${result.both} of ${result.voters} got both`,
      icon: 'detective',
      tone: 'violet',
      sound: 'gotcha',
    })
    const { both, one, none, voters } = result
    ctx.record(
      'revealed',
      { n, label: picture.label, people: [...people], both, one, none, voters },
      { about: people.filter((id) => ctx.players.some((p) => p.id === id)) },
    )
    return {
      ...state,
      revealed: [...state.revealed, n],
      results: { ...state.results, [n]: result },
      totals,
      lastReveal: { n, at: ctx.now },
    }
  }

  private finish(state: FusionState, ctx: GameContext<FusionConfig>): FusionState {
    if (state.phase === 'voting') throw new GameError('Lock voting first')
    if (state.phase === 'done') return state
    const top = leaders(state, ctx)
    if (top.length === 0) {
      ctx.announce('Participant fusion is over', { detail: 'Nobody scored this time', icon: 'trophy', tone: 'violet' })
      return { ...state, phase: 'done' }
    }
    const points = state.totals[top[0]]
    const names = top.map((id) => nameIn(ctx.players, state.names, id))
    const shared = top.length > 1
    ctx.announce(`${listNames(names)} ${shared ? 'have the sharpest eyes' : 'has the sharpest eye'}!`, {
      detail: plural(points, 'point'),
      icon: 'crown',
      tone: 'gold',
      sound: 'fanfare',
      interrupt: true,
    })
    ctx.announce(shared ? 'You share the sharpest eye!' : 'You have the sharpest eye!', {
      to: top,
      detail: `${plural(points, 'point')}. You're the face detective.`,
      icon: 'crown',
      tone: 'gold',
      sound: 'fanfare',
    })
    for (const id of top) {
      const before = ctx.players.find((p) => p.id === id)?.profile[this.type]?.detective
      ctx.updateProfile(id, { detective: (isCount(before) ? before : 0) + 1 })
    }
    ctx.record('crowned', { winners: top, points }, { about: top })
    return { ...state, phase: 'done' }
  }
}

// Helpers ----------------------------------------------------------------------

function parsePicture(item: unknown, n: number): FusionPicture {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    throw new GameError(`Picture ${defaultLabel(n)} isn't valid. Check it in the settings.`)
  }
  const { label: rawLabel, image, people } = item as Record<string, unknown>
  if (rawLabel !== undefined && rawLabel !== null && typeof rawLabel !== 'string') {
    throw new GameError(`Picture ${defaultLabel(n)} has a label that isn't text`)
  }
  const typed = typeof rawLabel === 'string' ? rawLabel.trim() : ''
  // Counted in code points, as Postgres counts them, so an emoji is one character.
  if (Array.from(typed).length > MAX_LABEL_LENGTH) {
    throw new GameError(`Picture ${defaultLabel(n)}: labels are at most ${MAX_LABEL_LENGTH} characters`)
  }
  const label = typed || defaultLabel(n)
  const picture: FusionPicture = { label }

  if (image !== undefined && image !== null && image !== '') {
    if (typeof image !== 'string' || image.length > 300 || !MEDIA_PATH.test(image)) {
      throw new GameError(`${label}: that image isn't valid. Upload it again.`)
    }
    picture.image = image
  }

  if (people !== undefined && people !== null) {
    if (!Array.isArray(people) || people.length > 2 || !people.every((id) => typeof id === 'string')) {
      throw new GameError(`${label}: pick two people, or nobody`)
    }
    const chosen = (people as string[]).filter((id) => id !== '')
    if (chosen.length === 1) throw new GameError(`${label}: pick the second person, or clear the first`)
    if (chosen.length === 2) {
      if (!chosen.every(isPlayerId)) throw new GameError(`${label}: pick two people, or nobody`)
      if (chosen[0] === chosen[1]) throw new GameError(`${label}: pick two different people`)
      picture.people = [chosen[0], chosen[1]]
    }
  }
  return picture
}

function wholePoints(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_POINTS) {
    throw new GameError(`${name} must be a whole number from 0 to ${MAX_POINTS}`)
  }
  return value
}

function pictureNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_PICTURES) {
    throw new GameError('There is no such picture')
  }
  return value
}

function pictureOf(config: FusionConfig, n: number): FusionPicture {
  const picture = config.pictures[n - 1]
  if (!picture) throw new GameError(`There is no picture ${defaultLabel(n)}`)
  return picture
}

const isPlayerId = (value: unknown): value is PlayerId =>
  typeof value === 'string' && value.length > 0 && value.length <= 64

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0

const scoringOf = (config: FusionConfig) => ({ perPerson: config.pointsPerPerson, bothBonus: config.bonusForBoth })

/** Scores one picture's final votes. People in the picture know who they are: they don't score on it. */
function scoreVotes(votes: readonly Answer[], people: readonly PlayerId[]): FusionResult {
  const result: FusionResult = { both: 0, one: 0, none: 0, voters: 0, hits: {} }
  for (const vote of votes) {
    if (people.includes(vote.playerId)) continue
    const choice = 'choice' in vote.answer ? new Set(vote.answer.choice) : new Set<string>()
    const hits = Math.min(2, people.filter((id) => choice.has(id)).length)
    result.hits[vote.playerId] = hits
    result.voters++
    if (hits === 2) result.both++
    else if (hits === 1) result.one++
    else result.none++
  }
  return result
}

/** Players still in the party with points, most first; ties keep the party's order (never jsonb key order). */
function ranked(state: FusionState, info: Pick<GameInfo<FusionConfig>, 'players'>) {
  return info.players
    .filter((p) => (state.totals[p.id] ?? 0) > 0)
    .map((p) => ({ playerId: p.id, points: state.totals[p.id] }))
    .sort((a, b) => b.points - a.points)
}

function leaders(state: FusionState, info: Pick<GameInfo<FusionConfig>, 'players'>): PlayerId[] {
  const rows = ranked(state, info)
  return rows.filter((row) => row.points === rows[0].points).map((row) => row.playerId)
}

/** A player's name now, else the one kept with the key, else a placeholder. */
function nameIn(players: readonly GamePlayer[], kept: Readonly<Record<PlayerId, string>>, id: PlayerId): string {
  return players.find((p) => p.id === id)?.name ?? kept[id] ?? 'a guest who left'
}

/** The names of everyone in the key: their current name, or the one kept from before they left. */
function namesOf(
  key: FusionState['key'],
  players: readonly GamePlayer[],
  kept: Readonly<Record<PlayerId, string>>,
): Record<PlayerId, string> {
  const names: Record<PlayerId, string> = {}
  for (const people of Object.values(key)) {
    for (const id of people) {
      const name = players.find((p) => p.id === id)?.name ?? kept[id]
      if (name !== undefined) names[id] = name
    }
  }
  return names
}
