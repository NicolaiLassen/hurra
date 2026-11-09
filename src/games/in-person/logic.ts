import { Game, GameError, type Highlight, type Presentation, type RecapRound } from '../core/Game'
import { nameList, pointsLabel, topScorers } from './summary'

type Empty = Record<string, never>

/**
 * Played in real life: beer pong in the kitchen, darts in the garden. The host
 * gives points by scanning players' codes (score_events with this game's id),
 * so there is no state or scoring to compute here, and no isFinished: the host
 * ends the round. The engine's default winners then crown the top of this
 * round's awards, so "Ana won Beer pong" shows after End, and nobody does when
 * no points were given (docs/engine-v2.md, 8.2).
 *
 * Several rounds can run at once. One takes the TV by default; the host can
 * start one in the background instead.
 */
export class InPersonGame extends Game<Empty, never, Empty, Empty, Empty> {
  readonly type = 'in-person'
  readonly defaultConfig: Empty = {}
  readonly presentation: Presentation = 'stage'

  /** A round has no settings: anything saved for it is ignored. */
  parseConfig(): Empty {
    return {}
  }

  setup(): Empty {
    return {}
  }

  parseAction(): never {
    throw new GameError('The host scores this round')
  }

  handleAction(state: Empty): Empty {
    return state
  }

  scores() {
    return {}
  }

  publicState(): Empty {
    return {}
  }

  playerView(): Empty {
    return {}
  }

  /**
   * "Top scorer in Beer pong: Ana", from the round's points (its awards). Only
   * for finished rounds: their points were on every screen, so nothing here is
   * a secret. A round nobody scored in has no highlight.
   */
  recap(round: RecapRound<Empty, Empty>): Highlight[] {
    if (!round.finished) return []
    const top = topScorers(round.points, round.players)
    if (!top) return []
    const tied = top.players.length > 1
    return [
      {
        title: `${tied ? 'Top scorers' : 'Top scorer'} in ${round.title}: ${nameList(top.players.map((p) => p.name))}`,
        detail: tied ? `${pointsLabel(top.points)} each` : pointsLabel(top.points),
        players: top.players.map((p) => p.id),
        icon: 'trophy',
        tone: 'gold',
        weight: 'headline',
      },
    ]
  }
}
