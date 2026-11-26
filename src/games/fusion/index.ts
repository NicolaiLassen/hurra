import { DetectiveIcon } from '@phosphor-icons/react'
import ConfigEditor from '@/games/fusion/ConfigEditor'
import HostView from '@/games/fusion/HostView'
import { FusionGame, type FusionProfile } from '@/games/fusion/logic'
import PlayerCard from '@/games/fusion/PlayerCard'
import PlayerView from '@/games/fusion/PlayerView'
import ResultView from '@/games/fusion/ResultView'
import { fusionSetup } from '@/games/fusion/setup'
import { readPublic, strapWords } from '@/games/fusion/shapes'
import TvStatus from '@/games/fusion/TvStatus'
import { defineGameModule, lazyScreen, type ProfileBadge } from '@/games/types'

// Participant fusion (docs/engine-v2.md, 8.4): portraits that fuse two guests,
// a stage game. Each picture shows on the TV, then all of them, then the host
// asks them one by one and every phone picks the two and locks in.
export const fusion = defineGameModule({
  logic: new FusionGame(),
  name: 'Participant fusion',
  description: 'Two guests fused into one portrait. Each picture shows on the TV, then you guess them one by one on your phone.',
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
  // "8 pictures, all with their people", or what is left: "6 of 8 pictures ready: 2 need both their people".
  setupStatus: fusionSetup,
  // The TV view plays each moment itself, so its announcements only bring their sound there.
  stageBanners: 'sound-only',
  // "Showing 12 pictures", "4 of 12 revealed", "Picture 4 of 12"; the phone's own words in the lobby and once done.
  phoneStrap: (publicState) => {
    const pub = readPublic(publicState)
    return pub && pub.phase !== 'lobby' && pub.phase !== 'done' ? strapWords(pub) : null
  },
  profileBadges: (data) => {
    const { detective } = data as FusionProfile
    const badges: ProfileBadge[] = []
    if (typeof detective === 'number' && detective > 0) {
      badges.push({ icon: DetectiveIcon, label: detective === 1 ? 'Face detective' : `${detective}× face detective`, tone: 'gold' })
    }
    return badges
  },
})
