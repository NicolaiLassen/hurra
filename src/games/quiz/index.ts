import { QuestionIcon, TrophyIcon } from '@phosphor-icons/react'
import { lazy } from 'react'
import ConfigEditor from '@/games/quiz/ConfigEditor'
import HostView from '@/games/quiz/HostView'
import { QuizGame, type QuizProfile } from '@/games/quiz/logic'
import PlayerCard from '@/games/quiz/PlayerCard'
import PlayerView from '@/games/quiz/PlayerView'
import ResultView from '@/games/quiz/ResultView'
import TvStatus from '@/games/quiz/TvStatus'
import { defineGameModule, type ProfileBadge } from '@/games/types'

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
  TvView: lazy(() => import('@/games/quiz/TvView')),
  FinalTvView: lazy(() => import('@/games/quiz/FinalTvView')),
  TvStatus,
  ConfigEditor,
  // The TV view shows each moment itself, so its announcements only sound there.
  stageBanners: 'sound-only',
  profileBadges: (data) => {
    const { wins = 0 } = data as QuizProfile
    const badges: ProfileBadge[] = []
    if (wins > 0) badges.push({ icon: TrophyIcon, label: wins === 1 ? 'Quiz champion' : `${wins}× quiz champion`, tone: 'gold' })
    return badges
  },
})
