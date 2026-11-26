import { QuestionIcon, TrophyIcon } from '@phosphor-icons/react'
import ConfigEditor from '@/games/quiz/ConfigEditor'
import HostView from '@/games/quiz/HostView'
import { QuizGame, type QuizProfile } from '@/games/quiz/logic'
import PlayerCard from '@/games/quiz/PlayerCard'
import PlayerView from '@/games/quiz/PlayerView'
import { readPublic } from '@/games/quiz/read'
import ResultView from '@/games/quiz/ResultView'
import { quizSetup } from '@/games/quiz/setup'
import TvStatus from '@/games/quiz/TvStatus'
import { defineGameModule, lazyScreen, type ProfileBadge } from '@/games/types'

export const quiz = defineGameModule({
  logic: new QuizGame(),
  name: 'Quiz',
  description: 'Questions on the TV, answers on your phone. Right answers score more the faster they come.',
  icon: QuestionIcon,
  PlayerView,
  PlayerCard,
  ResultView,
  HostView,
  // Animated with motion; loading them lazily keeps that off guests' phones.
  TvView: lazyScreen(() => import('@/games/quiz/TvView')),
  FinalTvView: lazyScreen(() => import('@/games/quiz/FinalTvView')),
  TvStatus,
  ConfigEditor,
  // "10 questions ready, 20 s each", or what is left: "8 of 10 questions ready: 2 need the right answer".
  setupStatus: quizSetup,
  // The TV view shows each moment itself, so its announcements only sound there.
  stageBanners: 'sound-only',
  // The phone's strap over the quiz: which question it is on.
  phoneStrap: (publicState) => {
    const pub = readPublic(publicState)
    if (!pub || pub.index < 0) return null
    if (pub.phase === 'question' || pub.phase === 'reveal') return `Question ${pub.index + 1} of ${pub.total}`
    if (pub.phase === 'leaderboard') return `After question ${pub.index + 1} of ${pub.total}`
    return null
  },
  profileBadges: (data) => {
    const { wins = 0 } = data as QuizProfile
    const badges: ProfileBadge[] = []
    if (wins > 0) badges.push({ icon: TrophyIcon, label: wins === 1 ? 'Quiz champion' : `${wins}× quiz champion`, tone: 'gold' })
    return badges
  },
})
