// A tiny game for the SDK's own tests and the conformance test (docs/engine-v2.md,
// 3.4). Never registered. It touches every part of the SDK once: a prompt with
// a deadline and a wakeAt that reveals it, a host action that names its step,
// member hooks that record who joined and left, bonus points, a record, and
// isFinished after a given number of moves.
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
} from './Game'

export type ProbeConfig = {
  /** The game finishes by itself once this many moves were made. */
  movesToWin: number
  /** How long each question stays open. */
  seconds: number
}

export type ProbeState = {
  /** How many questions the host has asked: the step host actions name. */
  step: number
  moves: { by: PlayerId; at: number }[]
  joined: PlayerId[]
  left: PlayerId[]
  question: { key: string; closesAt: number } | null
  results: { key: string; yes: PlayerId[]; no: PlayerId[] }[]
  ended: 'game' | 'host' | null
}

export type ProbeAction = { type: 'move' }
export type ProbeHostAction = { type: 'ask'; step: number } | { type: 'reveal'; step: number }

export type ProbePublicState = {
  moves: number
  step: number
  question: { key: string; closesAt: number } | null
  results: { key: string; yes: number; no: number }[]
  joined: number
  left: number
}

export type ProbeView = { moves: number; lastAnswer: 'yes' | 'no' | null }

export class ProbeGame extends Game<ProbeState, ProbeAction, ProbePublicState, ProbeView, ProbeConfig, ProbeHostAction> {
  readonly type: string = 'probe'
  readonly defaultConfig: ProbeConfig = { movesToWin: 3, seconds: 10 }

  parseConfig(input: Record<string, unknown>): ProbeConfig {
    const whole = (value: unknown, min: number, max: number, name: string) => {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
        throw new GameError(`${name} must be a whole number from ${min} to ${max}`)
      }
      return value
    }
    return { movesToWin: whole(input.movesToWin, 1, 100, 'movesToWin'), seconds: whole(input.seconds, 1, 600, 'seconds') }
  }

  setup(ctx: GameContext<ProbeConfig>): ProbeState {
    if (ctx.players.length === 0) throw new GameError('The probe needs a player')
    ctx.announce('The probe has started', { detail: `${ctx.players.length} players`, icon: 'megaphone' })
    return { step: 0, moves: [], joined: [], left: [], question: null, results: [], ended: null }
  }

  parseAction(input: unknown): ProbeAction {
    if ((input as { type?: unknown } | null)?.type === 'move') return { type: 'move' }
    throw new GameError('Unknown action')
  }

  handleAction(state: ProbeState, _action: ProbeAction, playerId: PlayerId, ctx: GameContext<ProbeConfig>): ProbeState {
    const moves = [...state.moves, { by: playerId, at: ctx.now }]
    if (moves.length >= ctx.config.movesToWin) {
      const name = ctx.players.find((p) => p.id === playerId)?.name ?? 'Someone'
      ctx.announce(`${name} made the winning move`, { icon: 'crown', sound: 'fanfare', interrupt: true })
      ctx.record('winning_move', { at: ctx.now }, { about: [playerId] })
    }
    return { ...state, moves }
  }

  parseHostAction(input: unknown): ProbeHostAction {
    const action = input as Partial<ProbeHostAction> | null
    if ((action?.type === 'ask' || action?.type === 'reveal') && typeof action.step === 'number') {
      return { type: action.type, step: action.step }
    }
    throw new GameError('Unknown host action')
  }

  handleHostAction(state: ProbeState, action: ProbeHostAction, ctx: GameContext<ProbeConfig>): ProbeState {
    // A step that has passed (a double tap, a race with the timer) changes nothing.
    if (action.step !== state.step) return state
    if (action.type === 'ask') {
      if (state.question) return state
      const key = `q${state.step + 1}`
      const closesAt = ctx.now + ctx.config.seconds * 1000
      ctx.openPrompt(key, { kind: 'choice', options: ['yes', 'no'], final: true }, { closesAt })
      return { ...state, step: state.step + 1, question: { key, closesAt } }
    }
    if (!state.question) return state
    if (!ctx.answers[state.question.key]) throw new GameError('The question is still open')
    return this.reveal(state, ctx)
  }

  wakeAt(state: ProbeState): number | null {
    return state.question?.closesAt ?? null
  }

  onWake(state: ProbeState, ctx: GameContext<ProbeConfig>): ProbeState {
    return state.question ? this.reveal(state, ctx) : state
  }

  onPlayerJoin(state: ProbeState, player: GamePlayer, ctx: GameContext<ProbeConfig>): ProbeState {
    ctx.record('joined', { name: player.name }, { about: [player.id] })
    return { ...state, joined: [...state.joined, player.id] }
  }

  onPlayerLeave(state: ProbeState, playerId: PlayerId, ctx: GameContext<ProbeConfig>): ProbeState {
    ctx.record('left', { player_id: playerId })
    return { ...state, left: [...state.left, playerId] }
  }

  isFinished(state: ProbeState, info: GameInfo<ProbeConfig>): boolean {
    return state.moves.length >= info.config.movesToWin
  }

  onEnd(state: ProbeState, ctx: GameContext<ProbeConfig>, by: 'game' | 'host'): ProbeState {
    if (by === 'host') ctx.announce('The probe is over', { detail: `${state.moves.length} moves`, icon: 'trophy' })
    return { ...state, ended: by }
  }

  scores(state: ProbeState, info: GameInfo<ProbeConfig>): Scores {
    const scores: Scores = {}
    for (const move of state.moves) scores[move.by] = (scores[move.by] ?? 0) + 1
    for (const result of state.results) for (const id of result.yes) scores[id] = (scores[id] ?? 0) + 1
    // Only players still in the party; the engine drops the rest anyway.
    return Object.fromEntries(Object.entries(scores).filter(([id]) => info.players.some((p) => p.id === id)))
  }

  publicState(state: ProbeState): ProbePublicState {
    return {
      moves: state.moves.length,
      step: state.step,
      question: state.question,
      results: state.results.map((r) => ({ key: r.key, yes: r.yes.length, no: r.no.length })),
      joined: state.joined.length,
      left: state.left.length,
    }
  }

  playerView(state: ProbeState, playerId: PlayerId): ProbeView {
    const last = state.results.at(-1)
    return {
      moves: state.moves.filter((m) => m.by === playerId).length,
      lastAnswer: last ? (last.yes.includes(playerId) ? 'yes' : last.no.includes(playerId) ? 'no' : null) : null,
    }
  }

  recap(round: RecapRound<ProbeState, ProbeConfig>): Highlight[] {
    if (!round.finished) return []
    return [{ title: `The probe ended after ${round.state.moves.length} moves`, players: [...round.winners], weight: 'headline' }]
  }

  /** Scores the open question from its final answers and reveals it. */
  private reveal(state: ProbeState, ctx: GameContext<ProbeConfig>): ProbeState {
    const question = state.question!
    const answers = ctx.answers[question.key] ?? []
    const said = (choice: string) =>
      answers.filter((a) => 'choice' in a.answer && a.answer.choice[0] === choice).map((a) => a.playerId)
    const yes = said('yes')
    const no = said('no')
    ctx.revealPrompt(question.key)
    if (yes.length > 0) ctx.awardPoints(yes[0], 1, 'First to say yes')
    ctx.record('revealed', { key: question.key, yes: yes.length, no: no.length })
    return { ...state, question: null, results: [...state.results, { key: question.key, yes, no }] }
  }
}
