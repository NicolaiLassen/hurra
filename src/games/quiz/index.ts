import { QuestionIcon } from '@phosphor-icons/react'
import { QuizGame } from '@/games/quiz/logic'
import PlayerView from '@/games/quiz/PlayerView'
import { defineGameModule } from '@/games/types'

// A placeholder module until the quiz lands (docs/engine-v2.md, 8.3).
export const quiz = defineGameModule({
  logic: new QuizGame(),
  name: 'Quiz',
  description: 'Questions on the TV, answers on your phone. Right answers score more the faster they come.',
  icon: QuestionIcon,
  PlayerView,
})
