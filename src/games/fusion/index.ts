import { DetectiveIcon } from '@phosphor-icons/react'
import { FusionGame } from '@/games/fusion/logic'
import PlayerView from '@/games/fusion/PlayerView'
import { defineGameModule } from '@/games/types'

// A placeholder module until Participant fusion lands (docs/engine-v2.md, 8.4).
export const fusion = defineGameModule({
  logic: new FusionGame(),
  name: 'Participant fusion',
  description: 'Two guests fused into one portrait on the wall. Vote on your phone for who is in each picture.',
  icon: DetectiveIcon,
  PlayerView,
})
