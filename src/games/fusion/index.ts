import { DetectiveIcon } from '@phosphor-icons/react'
import ConfigEditor from '@/games/fusion/ConfigEditor'
import HostView from '@/games/fusion/HostView'
import { FusionGame, type FusionProfile } from '@/games/fusion/logic'
import PlayerCard from '@/games/fusion/PlayerCard'
import PlayerView from '@/games/fusion/PlayerView'
import ResultView from '@/games/fusion/ResultView'
import TvStatus from '@/games/fusion/TvStatus'
import { defineGameModule, lazyScreen, type ProfileBadge } from '@/games/types'

// Participant fusion (docs/engine-v2.md, 8.4): printed portraits that fuse two
// guests, voted on from phones in the background, revealed one by one on the TV.
export const fusion = defineGameModule({
  logic: new FusionGame(),
  name: 'Participant fusion',
  description: 'Two guests fused into one portrait on the wall. Vote on your phone for who is in each picture.',
  icon: DetectiveIcon,
  PlayerView,
  PlayerCard,
  ResultView,
  HostView,
  // Animated with motion; loading them lazily keeps that off guests' phones.
  TvView: lazyScreen(() => import('@/games/fusion/TvView')),
  FinalTvView: lazyScreen(() => import('@/games/fusion/FinalTvView')),
  TvStatus,
  ConfigEditor,
  // The TV view plays each reveal itself, so its announcements only bring their sound there.
  stageBanners: 'sound-only',
  profileBadges: (data) => {
    const { detective } = data as FusionProfile
    const badges: ProfileBadge[] = []
    if (typeof detective === 'number' && detective > 0) {
      badges.push({ icon: DetectiveIcon, label: detective === 1 ? 'Face detective' : `${detective}× face detective`, tone: 'gold' })
    }
    return badges
  },
})
