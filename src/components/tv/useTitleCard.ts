import { useEffect, useState } from 'react'
import { freshStage, TITLE_CARD_MS } from '@/components/tv/scene'
import type { TvScene } from '@/lib/stage'
import type { Session, SessionGame } from '@/lib/types'

/**
 * The game whose "Hurra presents" card is up, or null. Once per round of a game
 * on this TV: putting the same round back on the stage later shows no card, and
 * a TV that opens long after a game took the stage shows none either.
 */
export function useTitleCard(scene: TvScene, session: Session, now: number): SessionGame | null {
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set())
  const [card, setCard] = useState<{ key: string; game: SessionGame } | null>(null)

  const key = freshStage(scene, session, now)
  if (key !== null && scene.kind === 'live' && !shown.has(key)) {
    setShown(new Set(shown).add(key))
    setCard({ key, game: scene.game })
  }

  useEffect(() => {
    if (!card) return
    const timer = setTimeout(() => setCard(null), TITLE_CARD_MS)
    return () => clearTimeout(timer)
  }, [card])

  // A card whose game has left the stage meanwhile goes at once.
  return card && scene.kind === 'live' && scene.game.id === card.game.id ? card.game : null
}
