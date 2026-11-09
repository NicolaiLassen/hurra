import { HourglassIcon } from '@phosphor-icons/react'
import type { QuizGame } from '@/games/quiz/logic'
import type { PlayerViewProps } from '@/games/types'

/** A placeholder until the quiz lands. */
export default function PlayerView({ game }: PlayerViewProps<QuizGame>) {
  return (
    <div className="grid justify-items-center gap-3 py-4 text-center">
      <HourglassIcon weight="duotone" className="size-12 text-primary" />
      <p className="text-xl font-bold">{game.title}</p>
      <p className="text-muted-foreground">Coming soon</p>
    </div>
  )
}
