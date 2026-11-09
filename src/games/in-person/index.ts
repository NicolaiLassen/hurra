import { UsersThreeIcon } from '@phosphor-icons/react'
import HostView from '@/games/in-person/HostView'
import { InPersonGame } from '@/games/in-person/logic'
import PlayerCard from '@/games/in-person/PlayerCard'
import PlayerView from '@/games/in-person/PlayerView'
import ResultView from '@/games/in-person/ResultView'
import TvStatus from '@/games/in-person/TvStatus'
import { defineGameModule } from '@/games/types'

// The simplest game: played in real life and scored by the host scanning QR
// codes. A good template for new games. It has no TvView of its own: on the
// stage the TV shows the standings with "Now playing", and when it ends, the
// generic final screen with its top scorers (docs/engine-v2.md, 7.2 and 8.2).
export const inPerson = defineGameModule({
  logic: new InPersonGame(),
  name: 'In-person round',
  description: 'Played in real life. The host scans QR codes to give points.',
  icon: UsersThreeIcon,
  PlayerView,
  PlayerCard,
  ResultView,
  HostView,
  TvStatus,
})
