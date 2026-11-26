import FinalScreen from '@/components/tv/FinalScreen'
import WinnerMoment from '@/components/tv/WinnerMoment'
import type { FusionGame } from '@/games/fusion/logic'
import { bestDisguise, plural, readPublic, type FusionPublicPicture, type FusionReveal } from '@/games/fusion/shapes'
import type { TvViewProps } from '@/games/types'

/**
 * The TV's final screen for Participant fusion: the winner's screen
 * (WinnerMoment, docs/identity.md), as Last one standing has. "Hurra for
 * Ana!", "The sharpest eye, with 9 points.", and at its reveal's time the
 * best disguise ("Best disguise: #4. Only 2 of 21 saw Mads and Ida."), else
 * the last picture revealed. Nobody scored: the core's final screen, "{title}
 * is over".
 */
export default function FinalTvView(props: TvViewProps<FusionGame>) {
  const { game, players, publicState, gamePoints, scores } = props
  const pub = readPublic(publicState)
  const winners = game.winners.flatMap((id) => players.find((p) => p.id === id) ?? [])
  if (winners.length === 0) return <FinalScreen {...props} />

  const points = gamePoints[winners[0].id] ?? pub?.top.find((row) => row.playerId === winners[0].id)?.points ?? 0
  const deck =
    winners.length > 1 ? `The sharpest eyes, with ${plural(points, 'point')} each.` : `The sharpest eye, with ${plural(points, 'point')}.`
  return (
    <WinnerMoment
      title={game.title}
      winners={winners}
      deck={deck}
      last={pub ? lastLine(pub.pictures) : null}
      scores={scores}
      gamePoints={gamePoints}
    />
  )
}

type Revealed = FusionPublicPicture & { revealed: FusionReveal }

/**
 * The best disguise at its reveal's time, else the last picture revealed;
 * nothing for a round from before the update, whose reveals kept no time.
 */
function lastLine(pictures: readonly FusionPublicPicture[]) {
  const disguise = bestDisguise(pictures)
  const latest = pictures
    .filter((p): p is Revealed => p.revealed !== null)
    .sort((a, b) => b.revealed.step - a.revealed.step)[0]
  const picture = disguise ?? latest
  if (!picture || picture.revealed.at === null) return null
  const { names, both, voters } = picture.revealed
  const pair = (
    <>
      <strong>{names[0]}</strong> and <strong>{names[1]}</strong>
    </>
  )
  const text = disguise ? (
    <>
      Best disguise: <strong>{picture.label}</strong>. {both === 0 ? <>Nobody saw {pair}.</> : <>Only {both} of {voters} saw {pair}.</>}
    </>
  ) : (
    <>
      <strong>{picture.label}</strong> was {pair}.
    </>
  )
  return { at: picture.revealed.at, text }
}
