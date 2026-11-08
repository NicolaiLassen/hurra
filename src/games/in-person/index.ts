import HostView from '@/games/in-person/HostView'
import { InPersonGame } from '@/games/in-person/logic'
import PlayerView from '@/games/in-person/PlayerView'
import { defineGameModule } from '@/games/types'

// The simplest game: played in real life and scored by the host scanning QR
// codes. A good template for new games.
export const inPerson = defineGameModule({
  logic: new InPersonGame(),
  name: 'In-person round',
  description: 'Played in real life. The host scans QR codes to give points.',
  PlayerView,
  HostView,
})
