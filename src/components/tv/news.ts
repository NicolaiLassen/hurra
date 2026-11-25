// Where each new announcement goes on the TV (docs/engine-v2.md, 7.2). Pure,
// so the rules are unit-tested. The core decides from what holds the stage and
// the announcement's own `interrupt` flag, never from its icon or wording.
import type { SoundName } from '@/games/core/sounds'
import { strongestSound } from '@/lib/soundPolicy'
import type { FeedItem } from '@/lib/types'

/** How long an announcement stays on the banner. */
export const BANNER_MS = 8000
/** How long a line stays on the ticker (the band's event line). */
export const TICKER_MS = 20_000

/**
 * - banner: the news strap across the top of the TV, with its sound (or the default pop)
 * - sound: only its sound: the stage game's own view shows the moment
 * - ticker: the quiet event line in the band, without sound
 * - skip: nothing (the recap is playing)
 */
export type NewsRoute = 'banner' | 'sound' | 'ticker' | 'skip'

/** What the TV shows when an announcement arrives. */
export type NewsStage =
  /** The podium and standings: every announcement gets the banner. */
  | { kind: 'board' }
  /** A game's own screen holds the stage. */
  | { kind: 'stage'; gameId: string; banners: 'banner' | 'sound-only' }
  /** The recap's slides. */
  | { kind: 'recap' }

export function routeNews(item: FeedItem, stage: NewsStage): NewsRoute {
  switch (stage.kind) {
    case 'recap':
      // Only a result the whole room should hear (a winner) breaks into the recap.
      return item.interrupt ? 'banner' : 'skip'
    case 'board':
      return 'banner'
    case 'stage':
      // The stage game's own view may show the moment itself: then only its sound.
      if (item.game_id === stage.gameId) return stage.banners === 'sound-only' ? 'sound' : 'banner'
      // Not from any game (news for the whole party), or a winner from a game in
      // the background: the banner, even while another game holds the stage.
      if (item.game_id === null || item.interrupt) return 'banner'
      // Anything else from a background game: the quiet ticker.
      return 'ticker'
  }
}

export type News = {
  /** The newest announcement for the banner. */
  banner?: FeedItem
  /** The newest one for the ticker. */
  ticker?: FeedItem
  /** The one sound for the whole batch: the strongest of its banners and sound-only moments. */
  sound?: SoundName
}

/** Sorts a batch of new announcements (in any order) into what the TV shows and plays. */
export function takeNews(items: readonly FeedItem[], stage: NewsStage): News {
  const news: News = {}
  const sounds: unknown[] = []
  for (const item of [...items].sort((a, b) => a.id - b.id)) {
    switch (routeNews(item, stage)) {
      case 'banner':
        news.banner = item
        sounds.push(item.sound ?? 'pop')
        break
      case 'sound':
        if (item.sound) sounds.push(item.sound)
        break
      case 'ticker':
        news.ticker = item
        break
      case 'skip':
        break
    }
  }
  const sound = strongestSound(sounds)
  if (sound) news.sound = sound
  return news
}
