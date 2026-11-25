import type { TvViewProps } from '@/games/types'
import type { SoundtrackGame } from './logic'
import Final from './tv/Final'

/** The TV's final screen for Lydspor: the winner, with the payout on the night so far (tv/Final.tsx). */
export default function FinalTvView(props: TvViewProps<SoundtrackGame>) {
  return <Final {...props} />
}
