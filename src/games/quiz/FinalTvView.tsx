import type { QuizGame, QuizPublicState } from '@/games/quiz/logic'
import QuizPodium from '@/games/quiz/Podium'
import { readPublic } from '@/games/quiz/read'
import type { TvViewProps } from '@/games/types'

const NOTHING_YET: QuizPublicState = { phase: 'done', index: -1, total: 0, question: null, reveal: null, leaderboard: [] }

/** The TV's final screen for the quiz: "Hurra for Ana" and the top three on the podium's steps. */
export default function FinalTvView({ game, players, publicState }: TvViewProps<QuizGame>) {
  return <QuizPodium game={game} players={players} pub={readPublic(publicState) ?? NOTHING_YET} />
}
