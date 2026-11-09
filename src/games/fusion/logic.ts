import { Game, GameError, type PlayerId } from '../core/Game'

// A placeholder until Participant fusion lands (docs/engine-v2.md, 8.4): the
// type, the presentation and the default settings are real; it can't be
// started yet.

export type FusionPicture = { label: string; image?: string; people?: [PlayerId, PlayerId] }
export type FusionConfig = { pictures: FusionPicture[]; pointsPerPerson: number }

type Empty = Record<string, never>

export class FusionGame extends Game<Empty, never, Empty, Empty, FusionConfig> {
  readonly type = 'fusion'
  readonly presentation = 'background'
  readonly defaultConfig: FusionConfig = { pictures: [], pointsPerPerson: 1 }

  setup(): Empty {
    throw new GameError("This game isn't ready yet")
  }

  parseAction(): never {
    throw new GameError("This game isn't ready yet")
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
