import { Game, GameError } from '../core/Game'

// A placeholder until the quiz lands (docs/engine-v2.md, 8.3): the type, the
// presentation and the default settings are real; it can't be started yet.

export type QuizQuestion = { text: string; options: string[]; correct: number; seconds?: number }
export type QuizConfig = { questions: QuizQuestion[]; seconds: number; pointsPerRight: number }

type Empty = Record<string, never>

export class QuizGame extends Game<Empty, never, Empty, Empty, QuizConfig> {
  readonly type = 'quiz'
  readonly presentation = 'stage'
  readonly defaultConfig: QuizConfig = { questions: [], seconds: 20, pointsPerRight: 1 }

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
