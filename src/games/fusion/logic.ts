// Participant fusion (docs/engine-v2.md, 8.4). Before the party an image model
// fuses two guests' faces into one portrait per print. On the night the game
// takes the TV like the quiz: the host asks the pictures one by one, and the
// TV shows which comes next with a little suspense (the pictures still to come
// stand as placeholders until they are asked). Each phone picks the two names
// in the picture and locks in before the countdown ends, and the reveal shows
// who it was, with their own photos.
//
// Guesses are prompts, never actions: one prompt per picture (p1 to pN),
// opened when the host asks it, `final` (the first lock counts), with the
// countdown's end plus a grace second as its deadline. The reveal (the host's
// Reveal now, or the timer) gets every lock at once in ctx.answers.
//
// Who is in each picture (the key) is two typed names, not tied to the guest
// list: the list only helps the host spell them the way the guests join. A
// guess is two names, right when one folds to a name in the picture (nameKey).
// The key, the two people's own photos (the originals) and each picture's
// image are secret: the key and the originals reach publicState only once
// that picture is revealed, and its image once it is asked. Everyone here
// guesses every picture and scores on it, the two in it too. Relative imports
// only: the Netlify function bundles this file.
import {
  Game,
  GameError,
  type Answer,
  type GameContext,
  type GameInfo,
  type GamePlayer,
  type Highlight,
  type PlayerId,
  type RecapRound,
  type Scores,
} from '../core/Game'
import { cleanName, MAX_NAME_LENGTH, nameFromSetting, nameKey, sameName, uniqueNames } from '../core/names'
import {
  countHits,
  DEFAULT_SECONDS,
  defaultLabel,
  GRACE_MS,
  isLegacyState,
  LEGACY_MESSAGE,
  listNames,
  MAX_LABEL_LENGTH,
  MAX_PICTURES,
  MAX_POINTS,
  MAX_SECONDS,
  MIN_SECONDS,
  pictureKey,
  plural,
  pointsFor,
  REVEAL_HOLD_MS,
  SUSPENSE_MS,
  TOP_SIZE,
  voteSpec,
  WAKE_MARGIN_MS,
  type FusionHostAction,
  type FusionPhase as Phase,
  type FusionPlayerView as PlayerViewShape,
  type FusionPublicPicture as PublicPicture,
  type FusionPublicState as PublicState,
  type FusionRules,
  type FusionTopRow,
} from './shapes'

export type { FusionHostAction }

export type FusionPicture = {
  /** What the print says, e.g. "#3". Blank in the settings means "#n". */
  label: string
  /** A game-media path (the full image; its thumbnail sits beside it). Secret until the picture is asked. */
  image?: string
  /**
   * Who is fused in it: two typed names, as the guests will join with them
   * (the editor suggests the guest list's spellings). Optional: the host can
   * also set it on the night (setKey). Settings saved before names hold two
   * guests' ids, read as those guests' names at the start.
   */
  people?: [string, string]
  /**
   * The two people's own photos, in the order of `people` (the first is the
   * first person's): a game-media path, or null for none. Optional, and
   * secret like `people`: the TV shows them beside the picture at its reveal,
   * and a person without one gets the profile photo of the guest with that
   * name, else a token.
   */
  originals?: [string | null, string | null]
}

export type FusionConfig = {
  pictures: FusionPicture[]
  /** Points for each of the two people a guest got right: a whole number from 0 to 10. */
  pointsPerPerson: number
  /** Extra points for getting both people of a picture right: a whole number from 0 to 10. */
  bonusForBoth: number
  /** Seconds to guess each picture: 10 to 90. */
  seconds: number
}

/** One revealed picture's locks: every guest here who locked in. */
export type FusionResult = {
  both: number
  one: number
  none: number
  voters: number
  /** How many of the two each voter got right. */
  hits: Record<PlayerId, number>
  /** When it was revealed. Missing in saves from the background version. */
  at?: number
}

export type FusionState = {
  phase: Phase
  /** Who is in each picture, by picture number: two names. Secret until that picture is revealed. */
  key: Record<string, [string, string]>
  /** Picture numbers, in the order they were asked and revealed. */
  revealed: number[]
  results: Record<string, FusionResult>
  totals: Record<PlayerId, number>
  /** The picture asked now (asking) or revealed last (reveal); null in other phases. */
  current: number | null
  /** When it was asked (the TV's suspense starts), and when its countdown ends. */
  openedAt: number | null
  endsAt: number | null
  revealedAt: number | null
}

/** What this game keeps on a player's profile. */
export type FusionProfile = { detective?: number }

/** A game-media path as uploads make them: `<session>/<game>/<uuid>.jpg`, nothing that climbs or points elsewhere. */
const MEDIA_PATH = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\.jpg$/

/** Danish order for the names a guess offers (Æ, Ø and Å after Z), whatever order the key and the players came in. */
const collator = new Intl.Collator('da', { sensitivity: 'base' })

/**
 * The stage round: the host asks the pictures one by one (each its own
 * countdown, after the TV's suspense, revealed by the timer or by Reveal
 * now), and crowns the face detective at the end.
 */
export class FusionGame extends Game<FusionState, never, PublicState, PlayerViewShape, FusionConfig, FusionHostAction> {
  readonly type = 'fusion'
  readonly presentation = 'stage'
  readonly defaultConfig: FusionConfig = {
    pictures: [],
    pointsPerPerson: 1,
    bonusForBoth: 0,
    seconds: DEFAULT_SECONDS,
  }

  parseConfig(input: Record<string, unknown>): FusionConfig {
    const raw = input.pictures
    if (!Array.isArray(raw) || raw.length === 0) throw new GameError('Add the pictures in the settings first')
    if (raw.length > MAX_PICTURES) throw new GameError(`Participant fusion takes at most ${MAX_PICTURES} pictures`)
    // showSeconds, from settings saved while the round opened with a showing, is no longer read.
    return {
      pictures: raw.map((item, i) => parsePicture(item, i + 1)),
      pointsPerPerson: wholePoints(input.pointsPerPerson, 'Points per right person'),
      bonusForBoth: wholePoints(input.bonusForBoth, 'The bonus for both'),
      seconds: wholeIn(input.seconds, MIN_SECONDS, MAX_SECONDS, `The time to guess must be ${MIN_SECONDS} to ${MAX_SECONDS} seconds`),
    }
  }

  setup(ctx: GameContext<FusionConfig>): FusionState {
    const key: FusionState['key'] = {}
    ctx.config.pictures.forEach((picture, i) => {
      if (!picture.people) return
      // The first place the guest list is known: settings saved with guests' ids become their names here.
      const names = picture.people.map((value) => nameFromSetting(value, ctx.guests, ctx.players))
      if (names[0] === null || names[1] === null) {
        throw new GameError(`${picture.label} names someone who isn't on the guest list any more. Type their name in the settings.`)
      }
      if (sameName(names[0], names[1])) throw new GameError(`${picture.label}: type two different names`)
      key[i + 1] = [names[0], names[1]]
    })
    // No prompt and no announcement yet: the TV's "Hurra presents" card opens the game.
    return {
      phase: 'lobby',
      key,
      revealed: [],
      results: {},
      totals: {},
      current: null,
      openedAt: null,
      endsAt: null,
      revealedAt: null,
    }
  }

  parseAction(): never {
    // Guesses go straight to the database as prompts; this game takes no moves.
    throw new GameError('This game takes guesses, not moves')
  }

  handleAction(state: FusionState): FusionState {
    return state
  }

  parseHostAction(input: unknown): FusionHostAction {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new GameError('Unknown host action')
    const action = input as Record<string, unknown>
    switch (action.type) {
      case 'finish':
        return { type: 'finish' }
      case 'wall':
        if (action.from === 'lobby') return { type: 'wall', from: 'lobby' }
        if (action.from === 'reveal') return { type: 'wall', from: 'reveal', n: pictureNumber(action.n) }
        break
      case 'ask':
        return { type: 'ask', n: pictureNumber(action.n) }
      case 'reveal':
        return { type: 'reveal', n: pictureNumber(action.n) }
      case 'setKey': {
        const people = action.people
        if (!Array.isArray(people) || people.length !== 2 || !people.every(isTyped)) throw new GameError('Type the two names in the picture')
        return { type: 'setKey', n: pictureNumber(action.n), people: [people[0], people[1]] }
      }
    }
    throw new GameError('Unknown host action')
  }

  // Every host action names its step (docs/engine-v2.md, 3.5): a picture number,
  // or a phase. One whose step has passed returns the state unchanged, which
  // the engine answers as skipped: a double tap, or a race with a timer.
  handleHostAction(state: FusionState, action: FusionHostAction, ctx: GameContext<FusionConfig>): FusionState {
    // A round started with the background version can't go on: End it and restart it.
    if (isLegacyState(state)) throw new GameError(LEGACY_MESSAGE)
    const s = readState(state)
    switch (action.type) {
      case 'wall':
        if (action.from === 'reveal') return s.phase === 'reveal' && s.current === action.n ? toWall(s) : state
        return s.phase === action.from ? toWall(s) : state
      case 'ask':
        return this.ask(state, s, action.n, ctx)
      case 'reveal':
        // The timer may have revealed it already.
        if (s.phase !== 'asking' || s.current !== action.n) return state
        return this.reveal(s, ctx)
      case 'setKey':
        return this.setKey(state, s, action.n, action.people, ctx)
      case 'finish':
        return this.finish(state, s, ctx)
    }
  }

  wakeAt(state: FusionState): number | null {
    if (isLegacyState(state)) return null
    const s = readState(state)
    switch (s.phase) {
      case 'asking':
        return s.endsAt === null ? null : s.endsAt + GRACE_MS + WAKE_MARGIN_MS
      case 'reveal':
        return s.revealedAt === null ? null : s.revealedAt + REVEAL_HOLD_MS
      // A save from the showing (before 26 November) reads as the wall, which waits for the host.
      default:
        return null
    }
  }

  /** Time's up reveals the picture; a reveal goes back to the wall. */
  onWake(state: FusionState, ctx: GameContext<FusionConfig>): FusionState {
    if (isLegacyState(state)) return state
    const s = readState(state)
    switch (s.phase) {
      case 'reveal':
        return toWall(s)
      case 'asking': {
        if (s.current === null) return toWall(s)
        const key = pictureKey(s.current)
        if (ctx.answers[key]) return this.reveal(s, ctx)
        // The database hasn't closed it yet, which WAKE_MARGIN_MS rules out. Never
        // score a picture without its locks: close it and wait for Reveal now.
        if (key in ctx.prompts && ctx.prompts[key].closedAt === null) ctx.closePrompt(key)
        return state
      }
      default:
        return state
    }
  }

  /**
   * Someone left the party: removed, or the host freed their name, which
   * someone else may take next under the same id (docs/guest-list.md, 9.1).
   * Their points and how they did on each picture go with them. The counts
   * stay as the room saw them, and the key stays: it names the people in the
   * picture, not a phone.
   */
  onPlayerLeave(state: FusionState, playerId: PlayerId): FusionState {
    if (isLegacyState(state)) return state
    const s = readState(state)
    const scored = Object.hasOwn(s.totals, playerId)
    const guessed = Object.values(s.results).some((result) => Object.hasOwn(result.hits ?? {}, playerId))
    if (!scored && !guessed) return state
    return {
      ...s,
      totals: without(s.totals, playerId),
      results: Object.fromEntries(
        Object.entries(s.results).map(([n, result]) => [
          n,
          Object.hasOwn(result.hits ?? {}, playerId) ? { ...result, hits: without(result.hits, playerId) } : result,
        ]),
      ),
    }
  }

  isFinished(state: FusionState): boolean {
    return state.phase === 'done'
  }

  /** The top totals among players still in the party, all tied ones; nobody when nobody scored. */
  winners(state: FusionState, info: GameInfo<FusionConfig>): PlayerId[] {
    return leaders(readState(state), info)
  }

  onEnd(state: FusionState, ctx: GameContext<FusionConfig>, by: 'game' | 'host'): FusionState {
    // The crowning announced the result already ('game'): stay quiet then.
    if (by === 'game' && state.phase === 'done') return state
    const s = readState(state)
    if (by === 'host') {
      const top = leaders(s, ctx)
      const names = top.map((id) => playerName(ctx.players, id))
      ctx.announce('Participant fusion is over', {
        detail:
          top.length > 0
            ? `${listNames(names)} ${top.length > 1 ? 'shared' : 'had'} the sharpest eye with ${plural(s.totals[top[0]], 'point')}`
            : 'Nobody scored this time',
        icon: 'trophy',
        tone: 'violet',
        sound: 'gong',
      })
    }
    // A picture asked when the host ended it stays unscored and secret.
    return { ...s, phase: 'done', current: null, openedAt: null, endsAt: null, revealedAt: null }
  }

  scores(state: FusionState): Scores {
    return { ...readState(state).totals }
  }

  publicState(state: FusionState, info: GameInfo<FusionConfig>): PublicState {
    const s = readState(state)
    const legacy = isLegacyState(state)
    const rules = rulesOf(info.config)
    const asking = !legacy && (s.phase === 'asking' || s.phase === 'reveal') && s.current !== null
    const pictures = info.config.pictures.map((picture, i): PublicPicture => {
      const n = i + 1
      const asked = s.revealed.includes(n) || (asking && s.current === n)
      return {
        n,
        key: pictureKey(n),
        label: picture.label,
        asked,
        // What it looks like only once it is asked: until then the TV shows a placeholder.
        image: asked ? (picture.image ?? null) : null,
        // Who is in it, and their own photos, only once it is revealed: never a key before that.
        revealed: revealedOf(s, n, picture),
      }
    })
    const current = s.current
    return {
      // The background version's voting and locked read as a lobby that never starts.
      phase: legacy ? 'lobby' : s.phase,
      pictures,
      rules,
      current:
        asking && current !== null && s.openedAt !== null && s.endsAt !== null
          ? {
              n: current,
              step: s.phase === 'asking' ? s.revealed.length + 1 : s.revealed.indexOf(current) + 1,
              key: pictureKey(current),
              openedAt: s.openedAt,
              startsAt: countdownStart(s.openedAt, s.endsAt, rules),
              endsAt: s.endsAt,
              revealedAt: s.phase === 'reveal' ? s.revealedAt : null,
            }
          : null,
      top: ranked(s, info).slice(0, TOP_SIZE),
    }
  }

  playerView(state: FusionState, playerId: PlayerId, info: GameInfo<FusionConfig>): PlayerViewShape {
    const s = readState(state)
    const hits: Record<string, number> = {}
    for (const n of s.revealed) {
      const result = s.results[n]
      if (result && Object.hasOwn(result.hits, playerId)) hits[n] = result.hits[playerId]
    }
    return {
      points: s.totals[playerId] ?? 0,
      rank: ranked(s, info).find((row) => row.playerId === playerId)?.rank ?? null,
      hits,
    }
  }

  /** Revealed pictures only: a picture the host never revealed keeps its people secret. */
  recap(round: RecapRound<FusionState, FusionConfig>): Highlight[] {
    if (!round.finished || !round.state) return []
    const { config } = round
    const state = readState(round.state)
    const nameOf = (id: PlayerId) => round.players.find((p) => p.id === id)?.name ?? 'A guest'
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
      const who = `${people[0]} and ${people[1]}`
      highlights.push({
        title: `Best disguise: ${labelOf(disguise.n)} fooled the room`,
        detail: both === 0 ? `Nobody saw ${who}` : `Only ${both} of ${voters} saw ${who}`,
        // The recap's people are the guests who came: those named in it, matched by name.
        players: namedPlayers(round.players, people),
        at: revealedAt(disguise.n),
        icon: 'detective',
        tone: 'violet',
        weight: 'highlight',
      })
    }

    // A perfect eye: on every revealed picture (at least two), everyone in it they could name. Their own
    // name is never offered, so on a picture they are in, the other one is everything.
    const perfect = round.players.filter((p) => {
      if (state.revealed.length < 2) return false
      return state.revealed.every((n) => {
        const key = state.key[n]
        const most = key ? key.filter((name) => !sameName(name, p.name)).length : 2
        return state.results[n]?.hits[p.id] === most
      })
    })
    if (perfect.length > 0) {
      highlights.push({
        title: `Perfect eye: ${listNames(perfect.map((p) => p.name))}`,
        detail: 'Every face right on every revealed picture',
        players: perfect.map((p) => p.id),
        icon: 'star',
        tone: 'violet',
        weight: 'highlight',
      })
    }
    return highlights
  }

  // Host actions -------------------------------------------------------------

  /**
   * Opens picture n's guess, from the lobby, the wall or a reveal. The TV
   * shows which picture it is first (SUSPENSE_MS), so its countdown starts
   * after that: nobody loses guessing time to it.
   */
  private ask(state: FusionState, s: FusionState, n: number, ctx: GameContext<FusionConfig>): FusionState {
    const picture = ctx.config.pictures[n - 1]
    if (!picture) throw new GameError(`There is no picture ${defaultLabel(n)}`)
    // Asked already: a double tap, or revealed since.
    if (s.revealed.includes(n) || (s.phase === 'asking' && s.current === n)) return state
    if (s.phase === 'asking') throw new GameError(`Reveal ${labelOf(ctx.config, s.current!)} first`)
    if (s.phase === 'done') return state
    if (!s.key[n]) throw new GameError(`Set who is in ${picture.label} first`)
    const endsAt = ctx.now + SUSPENSE_MS + rulesOf(ctx.config).seconds * 1000
    ctx.openPrompt(pictureKey(n), voteSpec(guessNames(s, ctx)), { closesAt: endsAt + GRACE_MS })
    return { ...s, phase: 'asking', current: n, openedAt: ctx.now, endsAt, revealedAt: null }
  }

  /** Scores the picture being asked from its final locks and reveals it (Reveal now, or time's up). */
  private reveal(s: FusionState, ctx: GameContext<FusionConfig>): FusionState {
    const n = s.current!
    const label = labelOf(ctx.config, n)
    const key = pictureKey(n)
    const votes = ctx.answers[key]
    if (!votes) throw new GameError(`The votes for ${label} are still open`)
    const people = s.key[n]
    if (!people) throw new GameError(`Set who is in ${label} first`)

    // Every guest here guesses and scores, the two in it too: a lock from anyone gone since counts for nothing.
    const result = scoreVotes(votes, people, ctx.players)
    const rules = rulesOf(ctx.config)
    const totals = { ...s.totals }
    for (const [id, hits] of Object.entries(result.hits)) {
      const points = pointsFor(hits, rules)
      if (points > 0) totals[id] = (totals[id] ?? 0) + points
    }
    ctx.revealPrompt(key)
    // No announcement: the TV and every phone show the reveal themselves. The log keeps it for the recap.
    const { both, one, none, voters } = result
    ctx.record('revealed', { n, label, people: [...people], both, one, none, voters }, { about: namedPlayers(ctx.players, people) })
    return {
      ...s,
      phase: 'reveal',
      revealed: [...s.revealed, n],
      results: { ...s.results, [n]: { ...result, at: ctx.now } },
      totals,
      revealedAt: ctx.now,
    }
  }

  private setKey(state: FusionState, s: FusionState, n: number, people: [string, string], ctx: GameContext<FusionConfig>): FusionState {
    const picture = ctx.config.pictures[n - 1]
    if (!picture) throw new GameError(`There is no picture ${defaultLabel(n)}`)
    if (s.phase === 'done') return state
    if (s.revealed.includes(n)) throw new GameError(`${picture.label} is already revealed`)
    // Typed names; a host page from before names sends the guests' ids, which become their names.
    const [a, b] = people.map((value) => nameFromSetting(value, ctx.guests, ctx.players))
    if (a === null || b === null || a === '' || b === '') throw new GameError('Type the two names in the picture')
    if (Array.from(a).length > MAX_NAME_LENGTH || Array.from(b).length > MAX_NAME_LENGTH) {
      throw new GameError(`Names are at most ${MAX_NAME_LENGTH} characters`)
    }
    if (sameName(a, b)) throw new GameError('Type two different names')
    const current = s.key[n]
    // The same two again change nothing, in either order; with their own photos the order says whose is whose.
    // A new spelling is a change: the room sees the names as typed.
    const ordered = originalsOf(picture).some((path) => path !== null)
    const same = current && ((current[0] === a && current[1] === b) || (!ordered && current[0] === b && current[1] === a))
    if (same) return state
    return { ...s, key: { ...s.key, [n]: [a, b] } }
  }

  private finish(state: FusionState, s: FusionState, ctx: GameContext<FusionConfig>): FusionState {
    if (s.phase === 'asking') throw new GameError(`Reveal ${labelOf(ctx.config, s.current!)} first`)
    if (s.phase === 'done') return state
    const done: FusionState = { ...s, phase: 'done', current: null, openedAt: null, endsAt: null, revealedAt: null }
    const top = leaders(s, ctx)
    if (top.length === 0) {
      ctx.announce('Participant fusion is over', { detail: 'Nobody scored this time', icon: 'trophy', tone: 'violet' })
      return done
    }
    const points = s.totals[top[0]]
    const names = top.map((id) => playerName(ctx.players, id))
    const shared = top.length > 1
    ctx.announce(`${listNames(names)} ${shared ? 'have the sharpest eyes' : 'has the sharpest eye'}`, {
      detail: plural(points, 'point'),
      icon: 'crown',
      tone: 'gold',
      sound: 'fanfare',
      interrupt: true,
    })
    ctx.announce(shared ? 'You share the sharpest eye' : 'You have the sharpest eye', {
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
    return done
  }
}

// Helpers ----------------------------------------------------------------------

/**
 * A saved state with every field, whatever version saved it: the background
 * version's saves lack the stage round's fields (null here) and keep their
 * phase, which isLegacyState tells apart. A save from before names kept the
 * key as guests' ids beside their names (`names`): it reads as those names.
 * A save from the showing reads as the wall. Never changes a full state.
 */
export function readState(raw: FusionState): FusionState {
  const s = (raw ?? {}) as Partial<FusionState> & { names?: Record<string, string>; showStartedAt?: unknown }
  const time = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
  const kept = s.names && typeof s.names === 'object' ? s.names : {}
  const named = (value: string) => (Object.hasOwn(kept, value) && typeof kept[value] === 'string' ? kept[value] : value)
  const key: FusionState['key'] = {}
  for (const [n, people] of Object.entries(s.key ?? {})) {
    if (Array.isArray(people) && people.length === 2) key[n] = [named(String(people[0])), named(String(people[1]))]
  }
  // Only the stage round's own fields: a save from before carries names and showStartedAt, which nothing reads now.
  const { names: _names, showStartedAt: _shown, ...rest } = s
  void _names
  void _shown
  return {
    ...rest,
    phase: (s.phase as string) === 'showing' ? 'wall' : (s.phase ?? 'lobby'),
    key,
    revealed: Array.isArray(s.revealed) ? s.revealed : [],
    results: s.results ?? {},
    totals: s.totals ?? {},
    current: time(s.current),
    openedAt: time(s.openedAt),
    endsAt: time(s.endsAt),
    revealedAt: time(s.revealedAt),
  }
}

/** The wall: no picture on. */
function toWall(s: FusionState): FusionState {
  return { ...s, phase: 'wall', current: null, openedAt: null, endsAt: null, revealedAt: null }
}

/** The round's timing and points, from its frozen settings, with the defaults for settings saved before they existed. */
export function rulesOf(config: Partial<FusionConfig>): FusionRules {
  const number = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
  return {
    seconds: number(config.seconds, DEFAULT_SECONDS),
    perPerson: number(config.pointsPerPerson, 1),
    bothBonus: number(config.bonusForBoth, 0),
  }
}

/**
 * When a picture's countdown starts: its seconds before it ends, so after the
 * TV's suspense for a picture asked now, and at the ask for one asked before
 * the suspense existed. Never before the ask.
 */
export function countdownStart(openedAt: number, endsAt: number, rules: Pick<FusionRules, 'seconds'>): number {
  return Math.max(openedAt, endsAt - rules.seconds * 1000)
}

const labelOf = (config: FusionConfig, n: number) => config.pictures[n - 1]?.label ?? defaultLabel(n)

/**
 * The names a guess offers: everyone who has joined (as they typed their
 * own name) and every name in the pictures, each once by nameKey, in Danish
 * order. The same list whichever picture is asked, so it says nothing about
 * the answer; the phone leaves out the guest's own name.
 */
export function guessNames(s: Pick<FusionState, 'key'>, info: Pick<GameInfo<FusionConfig>, 'players'>): string[] {
  const inPictures = Object.keys(s.key)
    .sort((a, b) => Number(a) - Number(b))
    .flatMap((n) => s.key[n])
  return uniqueNames([...info.players.map((p) => p.name), ...inPictures]).sort((a, b) => collator.compare(a, b))
}

/** A revealed picture as the room sees it, or null before its reveal. */
function revealedOf(s: FusionState, n: number, picture: FusionPicture): PublicPicture['revealed'] {
  const index = s.revealed.indexOf(n)
  const result = index >= 0 ? s.results[n] : undefined
  const people = s.key[n]
  if (!result || !people) return null
  return {
    names: [people[0], people[1]],
    both: result.both,
    one: result.one,
    none: result.none,
    voters: result.voters,
    // Each photo belongs to its place in the pair: the host types each name beside their photo.
    originals: originalsOf(picture),
    step: index + 1,
    at: typeof result.at === 'number' ? result.at : null,
  }
}

function parsePicture(item: unknown, n: number): FusionPicture {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    throw new GameError(`Picture ${defaultLabel(n)} isn't valid. Check it in the settings.`)
  }
  const { label: rawLabel, image, people, originals } = item as Record<string, unknown>
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
    if (!Array.isArray(people) || people.length > 2 || !people.every((name) => typeof name === 'string')) {
      throw new GameError(`${label}: type two names, or none`)
    }
    // Typed names, or guests' ids in settings saved before names: setup reads those as names.
    const chosen = (people as string[]).map(cleanName)
    const given = chosen.filter((name) => name !== '')
    if (given.length === 1) throw new GameError(`${label}: type the second name, or clear the first`)
    if (given.length === 2) {
      if (given.some((name) => Array.from(name).length > MAX_NAME_LENGTH)) {
        throw new GameError(`${label}: names are at most ${MAX_NAME_LENGTH} characters`)
      }
      if (nameKey(given[0]) === nameKey(given[1])) throw new GameError(`${label}: type two different names`)
      picture.people = [given[0], given[1]]
    }
  }

  if (originals !== undefined && originals !== null) {
    if (!Array.isArray(originals) || originals.length > 2) throw new GameError(`${label}: those photos of the two people aren't valid. Add them again.`)
    const paths = [0, 1].map((slot): string | null => {
      const path = originals[slot]
      if (path === undefined || path === null || path === '') return null
      if (typeof path !== 'string' || path.length > 300 || !MEDIA_PATH.test(path)) {
        throw new GameError(`${label}: the photo of the ${slot === 0 ? 'first' : 'second'} person isn't valid. Add it again.`)
      }
      return path
    })
    if (paths[0] !== null || paths[1] !== null) picture.originals = [paths[0], paths[1]]
  }
  return picture
}

/** A picture's two originals as the reveal shows them: [null, null] for none. */
function originalsOf(picture: FusionPicture | undefined): [string | null, string | null] {
  const originals = picture?.originals
  return Array.isArray(originals) ? [originals[0] ?? null, originals[1] ?? null] : [null, null]
}

function wholePoints(value: unknown, name: string): number {
  return wholeIn(value, 0, MAX_POINTS, `${name} must be a whole number from 0 to ${MAX_POINTS}`)
}

function wholeIn(value: unknown, min: number, max: number, message: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new GameError(message)
  return value
}

function pictureNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_PICTURES) {
    throw new GameError('There is no such picture')
  }
  return value
}

/** A name (or an id from an older host page) as a host action carries it: text, not too long to check. */
const isTyped = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 300

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0

/**
 * Scores one picture's locks: every guest here who locked in, the two in it
 * too. A pick of the voter's own name counts for nothing (their phone never
 * offers it). The first lock is the only one (the prompt is final).
 */
function scoreVotes(votes: readonly Answer[], people: readonly [string, string], players: readonly GamePlayer[]): Omit<FusionResult, 'at'> {
  const result: Omit<FusionResult, 'at'> = { both: 0, one: 0, none: 0, voters: 0, hits: {} }
  for (const vote of votes) {
    const voter = players.find((p) => p.id === vote.playerId)
    if (!voter || Object.hasOwn(result.hits, vote.playerId)) continue
    const picks = 'choice' in vote.answer ? vote.answer.choice : []
    const hits = countHits(picks, people, voter.name)
    result.hits[vote.playerId] = hits
    result.voters++
    if (hits === 2) result.both++
    else if (hits === 1) result.one++
    else result.none++
  }
  return result
}

/** The players whose name is one of `names`: the people in a picture who joined. */
function namedPlayers(players: readonly Pick<GamePlayer, 'id' | 'name'>[], names: readonly string[]): PlayerId[] {
  return players.filter((p) => names.some((name) => sameName(name, p.name))).map((p) => p.id)
}

/**
 * Players still in the party with points, most first, with competition ranks
 * (1, 2, 2, 4); ties keep the party's order (never jsonb key order).
 */
function ranked(s: FusionState, info: Pick<GameInfo<FusionConfig>, 'players'>): FusionTopRow[] {
  const rows = info.players
    .map((p, order) => ({ playerId: p.id, points: s.totals[p.id] ?? 0, order }))
    .filter((row) => row.points > 0)
    .sort((a, b) => b.points - a.points || a.order - b.order)
  let rank = 0
  return rows.map((row, i) => {
    if (i === 0 || rows[i - 1].points !== row.points) rank = i + 1
    return { playerId: row.playerId, points: row.points, rank }
  })
}

function leaders(s: FusionState, info: Pick<GameInfo<FusionConfig>, 'players'>): PlayerId[] {
  return ranked(s, info)
    .filter((row) => row.rank === 1)
    .map((row) => row.playerId)
}

/** A player's name, else a placeholder. */
function playerName(players: readonly GamePlayer[], id: PlayerId): string {
  return players.find((p) => p.id === id)?.name ?? 'a guest who left'
}

/** A record without one id's entry. */
function without<T>(record: Readonly<Record<PlayerId, T>>, id: PlayerId): Record<PlayerId, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== id))
}
