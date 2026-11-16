// How the TV reaches a game's TvStatus (docs/engine-v2.md, 6): the props for
// any variant, and whether the game draws that variant itself. A game opts in
// a variant by listing it in its TvStatus's `variants`; for any other the TV
// draws its own plain version, so the core never names a game.
import { getGameModule } from '@/games/registry'
import type { TvStatusProps, TvStatusVariant } from '@/games/types'
import { gamePointsOf, talliesOf } from '@/lib/stage'
import type { SessionGame } from '@/lib/types'
import { useLive } from '@/lib/useLive'

/** What a game's TvStatus gets, from the nearest live session. */
export function useStatusProps(game: SessionGame, variant: TvStatusVariant): TvStatusProps {
  const { snapshot, tallies, serverNow } = useLive()
  return {
    game,
    players: snapshot?.players ?? [],
    publicState: game.public_state,
    gamePoints: snapshot ? gamePointsOf(snapshot, game.id) : {},
    tallies: talliesOf(tallies, game.id),
    serverNow,
    variant,
  }
}

/** Whether the game draws its own TvStatus in `variant` (every one draws the card). */
export function drawsOwn(gameType: string, variant: TvStatusVariant): boolean {
  const Own = getGameModule(gameType)?.TvStatus
  return Own !== undefined && (variant === 'card' || Own.variants?.includes(variant) === true)
}
