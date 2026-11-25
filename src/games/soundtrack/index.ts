import { CassetteTapeIcon } from '@phosphor-icons/react'
import { clockTime } from '@/components/phone/text'
import ConfigEditor from '@/games/soundtrack/ConfigEditor'
import HostView from '@/games/soundtrack/HostView'
import { SoundtrackGame, type SoundtrackProfile } from '@/games/soundtrack/logic'
import PlayerCard from '@/games/soundtrack/PlayerCard'
import PlayerView from '@/games/soundtrack/PlayerView'
import { readPublic } from '@/games/soundtrack/read'
import ResultView from '@/games/soundtrack/ResultView'
import TvStatus from '@/games/soundtrack/TvStatus'
import { defineGameModule, lazyScreen, type ProfileBadge } from '@/games/types'

// Lydspor (.design/lydspor/spec.md; docs/engine-v2.md, 8.5): songs from
// someone's life, played from Spotify. Guests type each song's title and
// singer and tap its photo on the wall; everything locks at the last call,
// then the songs are revealed one by one while their stories are told.
export const soundtrack = defineGameModule({
  logic: new SoundtrackGame(),
  name: 'Lydspor',
  description: 'Songs from someone’s life. Type each song’s title and singer, then tap the photo it belongs to.',
  icon: CassetteTapeIcon,
  PlayerView,
  PlayerCard,
  ResultView,
  HostView,
  // Loaded lazily, so guests' phones never download the TV's screens.
  TvView: lazyScreen(() => import('@/games/soundtrack/TvView')),
  FinalTvView: lazyScreen(() => import('@/games/soundtrack/FinalTvView')),
  TvStatus,
  ConfigEditor,
  // The TV view shows each moment itself; Lydspor announces only its winner.
  stageBanners: 'sound-only',
  // The phone's strap over Lydspor: where the round is.
  phoneStrap: (publicState) => {
    const pub = readPublic(publicState)
    if (!pub) return null
    switch (pub.phase) {
      case 'lobby':
        return `${pub.total} ${pub.total === 1 ? 'song' : 'songs'}`
      case 'playing':
        return `Song ${pub.playedAt.length} of ${pub.total}`
      case 'lastCall':
        return 'Last call'
      case 'locked':
        return pub.lockedAt !== null ? `Locked at ${clockTime(pub.lockedAt)}` : 'Locked'
      case 'reveal':
      case 'standings':
        return `Reveal ${pub.revealed} of ${pub.playedAt.length}`
      default:
        return null
    }
  },
  profileBadges: (data) => {
    const { wins } = data as SoundtrackProfile
    const badges: ProfileBadge[] = []
    if (typeof wins === 'number' && wins > 0) {
      badges.push({ icon: CassetteTapeIcon, label: wins === 1 ? 'Lydspor champion' : `${wins}× Lydspor champion`, tone: 'gold' })
    }
    return badges
  },
})
