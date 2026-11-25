import FinalScreen from '@/components/tv/FinalScreen'
import WinnerMoment from '@/components/tv/WinnerMoment'
import type { TvViewProps } from '@/games/types'
import type { SoundtrackGame } from '../logic'
import { readPublic } from '../read'
import { mostPoints, runnerUpLine, winnerDeck } from './words'

/**
 * Lydspor once crowned (spec section 9, The crown): the winner's screen every
 * game shares (docs/identity.md, The winner's screen), with Lydspor's own
 * deck, "Won Lydspor with 26 of 32 points.", and who came next at the time of
 * the crown. Under it the night so far, where the payout has just landed.
 * With nobody above 0, the generic "Lydspor is over".
 */
export default function Final(props: TvViewProps<SoundtrackGame>) {
  const { game, players, publicState, scores, gamePoints } = props
  const pub = readPublic(publicState)
  const winners = game.winners.flatMap((id) => players.find((p) => p.id === id) ?? [])
  if (winners.length === 0) return <FinalScreen {...(props as unknown as TvViewProps)} />

  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? 'A guest'
  const best = pub?.final?.find((row) => row.playerId === winners[0].id)?.points ?? 0
  const next = runnerUpLine(pub?.final ?? null, nameOf)
  const at = game.finished_at
  return (
    <WinnerMoment
      title={game.title}
      winners={winners}
      deck={winnerDeck(game.title, winners.length, best, pub ? mostPoints(pub) : 0)}
      last={
        next && at !== null
          ? {
              at,
              text: (
                <>
                  <strong>{next.names}</strong> {next.text}
                </>
              ),
            }
          : null
      }
      scores={scores}
      gamePoints={gamePoints}
    />
  )
}
