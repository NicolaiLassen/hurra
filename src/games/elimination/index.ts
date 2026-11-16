import { CrownIcon, DetectiveIcon, SwordIcon } from '@phosphor-icons/react'
import ConfigEditor from '@/games/elimination/ConfigEditor'
import HostView from '@/games/elimination/HostView'
import { EliminationGame, type EliminationProfile } from '@/games/elimination/logic'
import PlayerCard from '@/games/elimination/PlayerCard'
import PlayerView from '@/games/elimination/PlayerView'
import ResultView from '@/games/elimination/ResultView'
import TvStatus from '@/games/elimination/TvStatus'
import { defineGameModule, lazyScreen, type ProfileBadge } from '@/games/types'

// Runs in the background all evening (its logic's presentation): phones show
// PlayerCard while another game holds the main card, and the TV its TvStatus
// card beside the stage game. The last knockout finishes it by itself; the TV's
// final screen is TvView with `finished`, and phones get ResultView.
export const elimination = defineGameModule({
  logic: new EliminationGame(),
  name: 'Last one standing',
  description:
    "Everyone gets a secret task and one life. Get someone to do your task, or catch them trying theirs on you, then scan their code: they're out.",
  icon: SwordIcon,
  PlayerView,
  PlayerCard,
  ResultView,
  HostView,
  // Animated with motion; loading it lazily keeps that off guests' phones.
  TvView: lazyScreen(() => import('@/games/elimination/TvView')),
  // CSS only (no motion), so it can sit in the TV's rail without a lazy load.
  TvStatus,
  ConfigEditor,
  // Players scan each other's codes to knock them out, also with the camera app.
  acceptsScans: true,
  // Everyone dealt in who no longer stands: lists of the party mark them Out.
  knockedOut: (publicState) => (Array.isArray(publicState?.out) ? publicState.out.filter((id) => typeof id === 'string') : []),
  profileBadges: (data) => {
    const { tags = 0, catches = 0, wins = 0 } = data as EliminationProfile
    const badges: ProfileBadge[] = []
    if (tags) badges.push({ icon: SwordIcon, label: `${tags} tagged`, tone: 'pink' })
    if (catches) badges.push({ icon: DetectiveIcon, label: `${catches} caught`, tone: 'teal' })
    if (wins) badges.push({ icon: CrownIcon, label: wins === 1 ? 'Last one standing' : `${wins}× last one standing` })
    return badges
  },
})
