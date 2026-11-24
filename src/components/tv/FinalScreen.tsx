import { motion } from 'motion/react'
import WinnerMoment, { NightSoFar } from '@/components/tv/WinnerMoment'
import { wonDeck } from '@/components/tv/winnerLines'
import type { TvViewProps } from '@/games/types'
import { useElementSize } from '@/lib/useElementSize'

/**
 * The final screen of a game without one of its own (docs/engine-v2.md, 7.2):
 * the winner's screen (WinnerMoment) with the game's newest news at its
 * time, or, when nobody won, "{title} is over" over the night so far.
 */
export default function FinalScreen({ game, players, gamePoints, feed, scores }: TvViewProps) {
  const winners = game.winners.flatMap((id) => players.find((p) => p.id === id) ?? [])
  const last = feed[0]

  if (winners.length > 0) {
    return (
      <WinnerMoment
        title={game.title}
        winners={winners}
        deck={wonDeck(game.title, winners.map((p) => p.id), gamePoints)}
        last={last ? { at: last.created_at, text: last.message } : null}
        scores={scores}
        gamePoints={gamePoints}
      />
    )
  }
  return <Over title={game.title} scores={scores} gamePoints={gamePoints} />
}

/** A game that ended with no winner still here: its title, and the night so far. */
function Over({ title, scores, gamePoints }: { title: string; scores: TvViewProps['scores']; gamePoints: TvViewProps['gamePoints'] }) {
  const [ref, box] = useElementSize<HTMLDivElement>()
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6 }}
      className="flex min-h-0 flex-1 flex-col justify-center gap-16 short:gap-10"
    >
      <h2 className="wide text-tv-question text-balance short:text-tv-answer">{title} is over</h2>
      <div ref={ref} className="flex min-h-0 flex-1 items-end">
        <NightSoFar line={[]} scores={scores} gamePoints={gamePoints} winners={[]} height={box.height} />
      </div>
    </motion.div>
  )
}
