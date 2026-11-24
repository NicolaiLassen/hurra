import { UsersThreeIcon } from '@phosphor-icons/react'
import Faces from '@/games/in-person/Faces'
import type { InPersonGame } from '@/games/in-person/logic'
import { finishedLeaders, nameList, pointsLabel, pointsOf } from '@/games/in-person/summary'
import type { ResultViewProps } from '@/games/types'
import { formatPoints } from '@/lib/format'

/**
 * A finished round on a phone: "Top scorer: Ana (+7). You scored 3 points."
 * The phone draws the card, "Finished" and the title around it. The top
 * scorers are the winners the round crowned, as the TV showed them.
 */
export default function ResultView({ game, player, players, gamePoints }: ResultViewProps<InPersonGame>) {
  const leaders = finishedLeaders(game.winners, gamePoints, players)
  const mine = pointsOf(gamePoints, player.id)

  if (!leaders) {
    return (
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground">
          <UsersThreeIcon weight="duotone" className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold">Nobody scored this round.</p>
          {mine !== 0 && <p className="text-sm text-muted-foreground">{myPoints(mine)}</p>}
        </div>
      </div>
    )
  }

  const won = leaders.players.some((p) => p.id === player.id)
  const others = leaders.players.filter((p) => p.id !== player.id)
  const tied = leaders.players.length > 1
  // Mine first when I'm one of them, so my crowned face leads the stack.
  const faces = won ? [player.name, ...others.map((p) => p.name)] : leaders.players.map((p) => p.name)

  return (
    <div className="flex min-w-0 items-center gap-3">
      <Faces names={faces} crown />
      <div className="min-w-0">
        {won ? (
          <>
            <p className="font-semibold text-primary">{tied ? 'You share the top spot.' : "You're the top scorer."}</p>
            <p className="text-sm text-muted-foreground">
              {tied
                ? `${nameList(['You', ...others.map((p) => p.name)])} scored ${pointsLabel(leaders.points)} each.`
                : myPoints(mine)}
            </p>
          </>
        ) : (
          <>
            <p className="font-semibold">
              {tied ? 'Top scorers' : 'Top scorer'}: {nameList(leaders.players.map((p) => p.name))}{' '}
              <span className="whitespace-nowrap text-primary tabular-nums">
                ({formatPoints(leaders.points)}
                {tied && ' each'})
              </span>
            </p>
            <p className="text-sm text-muted-foreground">{myPoints(mine)}</p>
          </>
        )}
      </div>
    </div>
  )
}

function myPoints(points: number) {
  if (points > 0) return `You scored ${pointsLabel(points)}.`
  if (points < 0) return `You ended on ${pointsLabel(points)}.`
  return "You didn't score this time."
}
