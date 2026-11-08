import { CrownIcon, DetectiveIcon, SwordIcon } from '@phosphor-icons/react'
import { lazy } from 'react'
import ConfigEditor from '@/games/elimination/ConfigEditor'
import HostView from '@/games/elimination/HostView'
import { EliminationGame, type EliminationProfile } from '@/games/elimination/logic'
import PlayerView from '@/games/elimination/PlayerView'
import { defineGameModule, type ProfileBadge } from '@/games/types'

export const elimination = defineGameModule({
  logic: new EliminationGame(),
  name: 'Last one standing',
  description:
    "Everyone gets a secret task and one life. Get someone to do your task, or catch them trying theirs on you, then scan their code: they're out.",
  PlayerView,
  HostView,
  // Animated with motion; loading it lazily keeps that off guests' phones.
  TvView: lazy(() => import('@/games/elimination/TvView')),
  ConfigEditor,
  // Players scan each other's codes to knock them out, also with the camera app.
  acceptsScans: true,
  profileBadges: (data) => {
    const { tags = 0, catches = 0, wins = 0 } = data as EliminationProfile
    const badges: ProfileBadge[] = []
    if (tags) badges.push({ icon: SwordIcon, label: `${tags} tagged`, tone: 'pink' })
    if (catches) badges.push({ icon: DetectiveIcon, label: `${catches} caught`, tone: 'teal' })
    if (wins) badges.push({ icon: CrownIcon, label: wins === 1 ? 'Last one standing' : `${wins}× last one standing` })
    return badges
  },
})
