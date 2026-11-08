import { Game, GameError } from '../core/Game'

type Empty = Record<string, never>

/**
 * Played in real life. The host gives points by scanning QR codes (the
 * score_events ledger), so there's no state or scoring to compute here.
 */
export class InPersonGame extends Game<Empty, never, Empty, Empty, Empty> {
  readonly type = 'in-person'
  readonly defaultConfig: Empty = {}

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
}
